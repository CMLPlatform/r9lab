"""Accounts the platform cannot run without, and the guards that protect them from admin writes.

Owned by auth so both the admin user routes and account erasure (application layer) use one rule.
"""

from typing import TYPE_CHECKING

from sqlalchemy import select

from app.api.auth.models import User
from app.api.auth.services.email_identity import canonicalize_email
from app.api.common.exceptions import ConflictError

if TYPE_CHECKING:
    from pydantic import UUID4
    from sqlalchemy.ext.asyncio import AsyncSession

# Owner of anonymized content, so products keep a NOT NULL owner_id. NOTE: `.internal`,
# not `.invalid`: email-validator rejects `.invalid`, which would make `UserRead.email`
# unserializable and break the admin user list.
ANONYMOUS_USER_EMAIL = "anonymous@system.r9lab.internal"
SYSTEM_ACCOUNT_EMAILS_CANONICAL = frozenset({canonicalize_email(ANONYMOUS_USER_EMAIL)})


def is_system_account(user: User) -> bool:
    """Whether this is the anonymous account that owns anonymized content."""
    return user.email_canonical in SYSTEM_ACCOUNT_EMAILS_CANONICAL


def require_not_system_account(user: User) -> None:
    """Refuse an admin write to the anonymous account.

    Reactivated and given a password, it would sign in as the owner of every anonymized product.

    Raises:
        ConflictError: when the target is the anonymous system account.
    """
    if is_system_account(user):
        msg = "The anonymous system account cannot be changed."
        raise ConflictError(msg)


async def lock_active_superuser_ids(session: AsyncSession) -> list[UUID4]:
    """Lock every active superuser row, in id order, and return their ids.

    One fixed order for every caller, so two admins acting on each other at once queue
    instead of deadlocking. Postgres re-checks the WHERE after a lock wait, so a row a
    concurrent transaction just deactivated drops out of the result.
    """
    statement = (
        select(User.id).where(User.is_superuser.is_(True), User.is_active.is_(True)).order_by(User.id).with_for_update()
    )
    return list((await session.execute(statement)).scalars())


async def require_other_active_superuser(session: AsyncSession, user: User, *, action: str) -> None:
    """Refuse an action that would leave no active superuser. Call before any side effect.

    Raises:
        ConflictError: when ``user`` is the last active superuser.
    """
    if not user.is_superuser:
        return
    active = await lock_active_superuser_ids(session)
    if user.id in active and len(active) == 1:
        msg = f"The last active superuser cannot be {action}."
        raise ConflictError(msg)
