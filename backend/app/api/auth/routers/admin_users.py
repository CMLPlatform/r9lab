"""Admin routes for managing users."""

from typing import Annotated, Any, cast

from fastapi import Depends, HTTPException, Request, Security
from fastapi_pagination import Page
from fastapi_users.exceptions import InvalidPasswordException, UserAlreadyExists
from sqlalchemy import select

from app.api.auth.account_guards import (
    SYSTEM_ACCOUNT_EMAILS_CANONICAL,
    require_not_system_account,
    require_other_active_superuser,
)
from app.api.auth.dependencies import (
    CurrentActiveSuperUserDep,
    UserByIDDep,
    UserManagerDep,
    current_active_superuser,
)
from app.api.auth.examples import ADMIN_USERS_RESPONSE_EXAMPLES
from app.api.auth.filters import UserFilter
from app.api.auth.models import User
from app.api.auth.roles import UserRole
from app.api.auth.schemas import UserActiveUpdate, UserRead, UserRoleUpdate, UserUpdate
from app.api.auth.services import mfa_service
from app.api.auth.services.account_security import revoke_user_refresh_tokens
from app.api.common.audiences import AdminAPIRouter
from app.api.common.audit import AuditAction, AuditContext, audit_event
from app.api.common.crud.filtering import create_filter_dependency
from app.api.common.crud.query import page_models
from app.api.common.exceptions import BadRequestError
from app.api.common.routers.dependencies import AsyncSessionDep

router = AdminAPIRouter(prefix="/admin/users", tags=["admin"], dependencies=[Security(current_active_superuser)])

MANAGEABLE_USER_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"description": "The target is the acting administrator's own account."},
    409: {"description": "The target is the anonymous system account."},
}


async def get_manageable_user(user: UserByIDDep, actor: CurrentActiveSuperUserDep) -> User:
    """Load a user an admin may write to: any account but their own and the anonymous system account.

    Admin writes skip the re-authentication the self-service flows ask for, so an
    administrator changes their own account through those flows instead.

    Raises:
        BadRequestError: when the target is the acting administrator.
    """
    if user.id == actor.id:
        msg = "Change your own account from your account settings."
        raise BadRequestError(msg)
    require_not_system_account(user)
    return user


ManageableUserDep = Annotated[User, Depends(get_manageable_user)]


## GET ##
@router.get(
    "",
    summary="View all users",
    response_model=Page[UserRead],
    responses={
        200: {
            "description": "List of users",
            "content": {
                "application/json": {"examples": ADMIN_USERS_RESPONSE_EXAMPLES},
            },
        },
    },
)
async def get_users(
    user_filter: Annotated[UserFilter, Depends(create_filter_dependency(UserFilter))],
    session: AsyncSessionDep,
) -> Page[UserRead]:
    """Get a list of all users with optional filtering, without the anonymous system account."""
    statement = select(User).where(User.email_canonical.not_in(SYSTEM_ACCOUNT_EMAILS_CANONICAL))
    return cast(
        "Page[UserRead]",
        await page_models(session, User, filters=user_filter, statement=statement, read_schema=UserRead),
    )


@router.get(
    "/{user_id}",  # user_id is bound by the get_user_or_404 dependency
    summary="View a single user by ID",
    response_model=UserRead,
)
async def get_user(user: UserByIDDep) -> User:
    """Get a user by ID."""
    return user


## PATCH ##
@router.patch(
    "/{user_id}",  # user_id is bound by the get_user_or_404 dependency
    summary="Update a user by ID",
    response_model=UserRead,
    responses=MANAGEABLE_USER_RESPONSES,
)
async def update_user(
    user_update: UserUpdate,
    user: ManageableUserDep,
    user_manager: UserManagerDep,
    actor: CurrentActiveSuperUserDep,
    request: Request,
) -> User:
    """Update a user by ID without requiring the target account's password.

    `safe=False` lets an administrator change fields the self-service route
    reauthenticates for; UserManager skips the current-password gate on this path.
    """
    try:
        updated = await user_manager.update(user_update, user, safe=False, request=request)
    except UserAlreadyExists as e:
        # Unlike registration, nothing to hide from an admin.
        raise HTTPException(status_code=409, detail="A user with this email already exists") from e
    except InvalidPasswordException as e:
        raise HTTPException(status_code=400, detail=str(e.reason)) from e
    audit_event(actor.id, AuditAction.UPDATE, User, user.id)
    return updated


## DELETE ##
@router.post(
    "/{user_id}/mfa/reset",  # user_id is bound by the get_user_or_404 dependency
    summary="Reset a user's two-step verification",
    status_code=204,
    responses=MANAGEABLE_USER_RESPONSES,
)
async def reset_user_mfa(
    user: ManageableUserDep,
    user_manager: UserManagerDep,
    actor: CurrentActiveSuperUserDep,
) -> None:
    """Turn off a user's two-step verification after an administrator has confirmed who they are."""
    await mfa_service.clear_totp(user_manager, user)
    audit_event(actor.id, AuditAction.SUPERUSER_ACCESS, User, user.id, context=AuditContext(operation="mfa_reset"))


@router.put(
    "/{user_id}/role",  # user_id is bound by the get_user_or_404 dependency
    summary="Set a user's contributor tier",
    response_model=UserRead,
    responses=MANAGEABLE_USER_RESPONSES,
)
async def set_user_role(
    role_update: UserRoleUpdate,
    user: ManageableUserDep,
    user_manager: UserManagerDep,
    actor: CurrentActiveSuperUserDep,
) -> User:
    """Set a user's role.

    A dedicated route rather than a field on `UserUpdate`: fastapi-users' safe
    update path excludes a fixed set of privileged fields, so anything new added
    to that schema would flow straight through self-service `PATCH /users/me`.
    Keeping role off the schema entirely makes that escalation unrepresentable.

    Writes through the user database rather than `AsyncSessionDep`: the target
    user is loaded by the auth session, which is a separate dependency, so a
    commit on the common session would persist nothing.
    """
    if user.is_superuser and role_update.role != UserRole.LAB:
        msg = "Superusers always hold the lab tier."
        raise BadRequestError(msg)
    updated = await user_manager.user_db.update(user, {"role": role_update.role})
    audit_event(
        actor.id,
        AuditAction.UPDATE,
        User,
        user.id,
        context=AuditContext(operation=f"set_role_{role_update.role.value}"),
    )
    return updated


@router.put(
    "/{user_id}/active",  # user_id is bound by the get_user_or_404 dependency
    summary="Suspend or reactivate a user",
    response_model=UserRead,
    responses={
        **MANAGEABLE_USER_RESPONSES,
        409: {"description": "The target is the anonymous system account or the last active superuser."},
    },
)
async def set_user_active(
    active_update: UserActiveUpdate,
    user: ManageableUserDep,
    user_manager: UserManagerDep,
    actor: CurrentActiveSuperUserDep,
    request: Request,
) -> User:
    """Suspend (`is_active: false`) or reactivate a user without erasing anything.

    A suspended account cannot sign in, and its refresh sessions are revoked; its
    products stay. A dedicated route for the same reason as the role route: the
    self-service `UserUpdate` schema must never carry `is_active`. A request that
    matches the current state changes nothing and is not audited.
    """
    if user.is_active == active_update.is_active:
        return user
    if not active_update.is_active:
        await require_other_active_superuser(user_manager.user_db.session, user, action="suspended")
        # Before the write, so a Redis failure aborts rather than leaving a suspended user with live sessions.
        await revoke_user_refresh_tokens(user.id, request)
    updated = await user_manager.user_db.update(user, {"is_active": active_update.is_active})
    action = AuditAction.REACTIVATE if active_update.is_active else AuditAction.DEACTIVATE
    audit_event(actor.id, action, User, user.id)
    return updated
