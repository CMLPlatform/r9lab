"""The public profile route.

Joins an account to the contribution stats computed over its products, so it spans
`auth` and `data_collection` and belongs in the application layer rather than inside
either. The path and tag are unchanged.
"""

from typing import Annotated, cast

from fastapi import HTTPException, Response, Security
from pydantic import UUID4
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth.dependencies import optional_current_active_user
from app.api.auth.models import User
from app.api.auth.profile_stats import ProfileStatsData
from app.api.auth.schemas import PublicProfileView, normalize_username
from app.api.auth.services.privacy import can_view_profile
from app.api.common.audiences import PublicAPIRouter
from app.api.common.routers.dependencies import AsyncSessionDep
from app.api.data_collection.crud.profile_stats import compute_profile_stats, top_category_label
from app.core.cache import cache
from app.core.config.core import settings
from app.core.config.models import CacheNamespace


async def _profile_stats(session: AsyncSession, user_id: UUID4) -> ProfileStatsData:
    stats = await compute_profile_stats(session, user_id)
    return stats.model_copy(update={"top_category": await top_category_label(session, stats.top_category)})


# Keyed by user id only, so the visibility check in the route stays live on every request.
_cached_profile_stats = cache(
    expire=settings.cache.ttls[CacheNamespace.PROFILE_STATS], namespace=CacheNamespace.PROFILE_STATS
)(_profile_stats)

router = PublicAPIRouter(prefix="/profiles", tags=["profiles"])


@router.get(
    "/{username}",
    response_model=PublicProfileView,
    summary="Get public profile of a user",
)
async def get_public_profile(
    username: str,
    response: Response,
    session: AsyncSessionDep,
    current_user: Annotated[User | None, Security(optional_current_active_user)],
) -> PublicProfileView:
    """Get public profile statistics for a specified user by username.

    Returns 404 if the user is not found or if the profile is marked as private (and you are not the user).
    """
    # Viewer-dependent response: visibility changes with auth state.
    response.headers["Cache-Control"] = "private, no-store"

    lookup_username = cast("str", normalize_username(username))
    stmt = select(User).where(User.username == lookup_username)
    result = await session.execute(stmt)
    user = result.unique().scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="Profile not found")

    if not can_view_profile(user, current_user):
        raise HTTPException(status_code=404, detail="Profile not found")

    # The owner sees their own edits at once; everyone else may read a few minutes behind.
    is_owner = current_user is not None and current_user.id == user.id
    stats = await (_profile_stats if is_owner else _cached_profile_stats)(session, user.id)

    return PublicProfileView.from_profile_stats(
        username=lookup_username,
        created_at=user.created_at,
        stats=stats,
    )
