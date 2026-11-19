"""Authorization + not-found behaviour for the admin user routes.

These go through the real app so the router-level ``Security(current_active_superuser)``
gate is actually exercised; the previous unit test called the handlers as plain
coroutines and never touched it.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any
from unittest.mock import ANY, patch
from uuid import uuid4

import pytest
from sqlalchemy import Select, select

from app.api.application.account_erasure import get_or_create_anonymous_user
from app.api.auth.account_guards import ANONYMOUS_USER_EMAIL, LEGACY_ANONYMOUS_USER_EMAIL
from app.api.auth.dependencies import current_active_superuser_account
from app.api.auth.models import OAuthAccount, User
from app.api.common.audit import AuditAction, AuditContext
from app.api.data_collection.models.product import Product
from app.api.plugins.r9cam.models import Camera
from scripts.seed.factories.models import CameraFactory, UserFactory

if TYPE_CHECKING:
    from uuid import UUID

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.reference_data.models import ProductType

pytestmark = pytest.mark.api

ADMIN_USERS = "/v1/admin/users"


class TestAdminUsersAuthorization:
    """The admin routes are reachable only by an active superuser."""

    async def test_superuser_lists_users(self, api_client_superuser) -> None:
        """A superuser can list users."""
        response = await api_client_superuser.get(ADMIN_USERS)
        assert response.status_code == 200

    # The router-level superuser gate is the ONLY authorization on
    # these routes. Delete it and a regular user reaches the handler (200);
    # requiring a denial here fails that mutation. The fixture overrides the
    # regular-user deps but not the superuser one, so the real superuser dep
    # denies with 401 rather than 403; either is a denial, 200 is the bug.
    @pytest.mark.parametrize(
        ("method", "path_suffix"),
        [
            ("get", ""),
            ("get", "/{uid}"),
            ("patch", "/{uid}"),
            ("delete", "/{uid}"),
            ("post", "/{uid}/mfa/reset"),
            ("put", "/{uid}/active"),
        ],
    )
    async def test_regular_user_is_denied(
        self, api_client_user, db_superuser: User, method: str, path_suffix: str
    ) -> None:
        """A non-superuser is denied every admin verb."""
        path = ADMIN_USERS + path_suffix.format(uid=db_superuser.id)
        kwargs = {"json": {"is_active": False}} if method == "put" else {"json": {}} if method == "patch" else {}
        response = await getattr(api_client_user, method)(path, **kwargs)
        assert response.status_code in (401, 403)

    # Overrides only the fastapi-users account dependency, so the MFA check inside
    # current_active_superuser runs for real.
    @pytest.mark.parametrize(("mfa_enabled", "expected"), [(False, 403), (True, 200)])
    async def test_superuser_needs_mfa_enrolled(
        self, api_client, test_app, db_session: AsyncSession, *, mfa_enabled: bool, expected: int
    ) -> None:
        """Admin routes refuse a superuser until TOTP MFA is enrolled."""
        admin = await UserFactory.create_async(
            session=db_session, is_superuser=True, is_active=True, mfa_enabled=mfa_enabled, refresh_instance=True
        )
        test_app.dependency_overrides[current_active_superuser_account] = lambda: admin
        try:
            response = await api_client.get(ADMIN_USERS)
        finally:
            test_app.dependency_overrides.pop(current_active_superuser_account, None)

        assert response.status_code == expected, response.text
        if not mfa_enabled:
            assert "two-factor" in response.json()["detail"]

    async def test_guest_is_unauthorized(self, api_client, db_user: User) -> None:
        """An unauthenticated client is rejected."""
        response = await api_client.get(f"{ADMIN_USERS}/{db_user.id}")
        assert response.status_code == 401


class TestAdminUsersNotFound:
    """A well-formed but absent user id returns 404, not a 500."""

    # A handler that calls user_manager.get directly lets a missing id raise
    # UserNotExists straight into the catch-all handler as a 500.
    @pytest.mark.parametrize(
        ("method", "path_suffix"),
        [
            ("get", "/{uid}"),
            ("patch", "/{uid}"),
            ("delete", "/{uid}"),
            ("post", "/{uid}/mfa/reset"),
            ("put", "/{uid}/active"),
        ],
    )
    async def test_missing_user_returns_404(self, api_client_superuser, method: str, path_suffix: str) -> None:
        """Each admin verb maps a missing id to 404."""
        path = ADMIN_USERS + path_suffix.format(uid=uuid4())
        kwargs = {"json": {"is_active": False}} if method == "put" else {"json": {}} if method == "patch" else {}
        response = await getattr(api_client_superuser, method)(path, **kwargs)
        assert response.status_code == 404

    async def test_malformed_id_is_rejected_before_the_handler(self, api_client_superuser) -> None:
        """A non-UUID path segment is a 422 (path validation), never a 500."""
        response = await api_client_superuser.get(f"{ADMIN_USERS}/not-a-uuid")
        assert response.status_code == 422


class TestAdminUsersActions:
    """Delete, update, and MFA-reset perform their action and audit the acting superuser."""

    async def test_superuser_deletes_a_user_and_audits_the_actor(
        self, api_client_superuser, db_superuser: User, db_user: User
    ) -> None:
        """Deletion returns 204 and records the actor in the audit log."""
        with patch("app.api.application.routers.account_erasure.audit_event") as log_audit:
            response = await api_client_superuser.delete(f"{ADMIN_USERS}/{db_user.id}")

        assert response.status_code == 204
        log_audit.assert_called_once_with(
            db_superuser.id,
            AuditAction.DELETE,
            User,
            db_user.id,
            context=AuditContext(operation="erase_anonymize"),
        )

    async def test_superuser_updates_a_user_and_audits_the_actor(
        self, api_client_superuser, db_superuser: User, db_user: User
    ) -> None:
        """Update returns the changed user without the target's password and audits the actor."""
        with patch("app.api.auth.routers.admin_users.audit_event") as log_audit:
            response = await api_client_superuser.patch(
                f"{ADMIN_USERS}/{db_user.id}",
                json={"username": "renamed_by_admin"},  # no current_password supplied; safe=False must not demand one
            )

        assert response.status_code == 200
        assert response.json()["username"] == "renamed_by_admin"
        log_audit.assert_called_once_with(db_superuser.id, AuditAction.UPDATE, User, db_user.id)

    async def test_superuser_resets_user_mfa(
        self, api_client_superuser, db_session: AsyncSession, db_user: User
    ) -> None:
        """MFA reset returns 204 and clears the target's TOTP enrolment against the real row."""
        db_user.mfa_enabled = True
        db_user.mfa_totp_secret = "totp-secret"  # test fixture value, not a real secret
        db_user.mfa_confirmed_at = datetime.now(UTC)
        db_user.mfa_recovery_codes = ["hash-of-a-recovery-code"]
        await db_session.commit()

        response = await api_client_superuser.post(f"{ADMIN_USERS}/{db_user.id}/mfa/reset")

        assert response.status_code == 204
        await db_session.refresh(db_user)
        assert db_user.mfa_enabled is False
        assert db_user.mfa_totp_secret is None
        assert db_user.mfa_confirmed_at is None
        assert db_user.mfa_recovery_codes == []


REVOKE = "app.api.auth.routers.admin_users.revoke_user_refresh_tokens"
AUDIT = "app.api.auth.routers.admin_users.audit_event"


class TestAdminUserSuspension:
    """`PUT /admin/users/{id}/active` suspends or reactivates an account without erasing it."""

    async def test_suspend_revokes_sessions_and_audits_the_actor(
        self, api_client_superuser, db_session: AsyncSession, db_superuser: User, db_user: User
    ) -> None:
        """Suspending flips is_active, ends the target's sessions and records the acting admin."""
        with patch(REVOKE) as revoke, patch(AUDIT) as log_audit:
            response = await api_client_superuser.put(f"{ADMIN_USERS}/{db_user.id}/active", json={"is_active": False})

        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False
        await db_session.refresh(db_user)
        assert db_user.is_active is False
        revoke.assert_awaited_once_with(db_user.id, ANY)
        log_audit.assert_called_once_with(db_superuser.id, AuditAction.DEACTIVATE, User, db_user.id)

    async def test_reactivate_keeps_sessions_untouched(
        self, api_client_superuser, db_session: AsyncSession, db_superuser: User, db_user: User
    ) -> None:
        """Reactivating needs no session revocation and is audited as its own action."""
        db_user.is_active = False
        await db_session.commit()

        with patch(REVOKE) as revoke, patch(AUDIT) as log_audit:
            response = await api_client_superuser.put(f"{ADMIN_USERS}/{db_user.id}/active", json={"is_active": True})

        assert response.status_code == 200, response.text
        await db_session.refresh(db_user)
        assert db_user.is_active is True
        revoke.assert_not_awaited()
        log_audit.assert_called_once_with(db_superuser.id, AuditAction.REACTIVATE, User, db_user.id)

    async def test_admin_cannot_suspend_themselves(
        self, api_client_superuser, db_session: AsyncSession, db_superuser: User
    ) -> None:
        """Self-suspension is refused before any session is revoked."""
        with patch(REVOKE) as revoke:
            response = await api_client_superuser.put(
                f"{ADMIN_USERS}/{db_superuser.id}/active", json={"is_active": False}
            )

        assert response.status_code == 400
        await db_session.refresh(db_superuser)
        assert db_superuser.is_active is True
        revoke.assert_not_awaited()

    async def test_last_active_superuser_cannot_be_suspended(
        self, api_client_superuser, db_session: AsyncSession, db_superuser: User
    ) -> None:
        """The guard holds even when the actor's own account went inactive meanwhile."""
        target = await UserFactory.create_async(
            session=db_session, is_active=True, is_superuser=True, mfa_enabled=True, refresh_instance=True
        )
        # Stands in for a concurrent suspension of the acting admin by the target.
        db_superuser.is_active = False
        await db_session.commit()

        with patch(REVOKE) as revoke:
            response = await api_client_superuser.put(f"{ADMIN_USERS}/{target.id}/active", json={"is_active": False})

        assert response.status_code == 409
        await db_session.refresh(target)
        assert target.is_active is True
        revoke.assert_not_awaited()

    async def test_superuser_can_be_suspended_while_another_one_is_active(
        self, api_client_superuser, db_session: AsyncSession
    ) -> None:
        """The guard blocks only the last admin; the actor still counts as one."""
        target = await UserFactory.create_async(
            session=db_session, is_active=True, is_superuser=True, mfa_enabled=True, refresh_instance=True
        )

        with patch(REVOKE):
            response = await api_client_superuser.put(f"{ADMIN_USERS}/{target.id}/active", json={"is_active": False})

        assert response.status_code == 200, response.text

    @pytest.mark.parametrize("body", [{}, {"is_active": False, "is_superuser": True}, {"is_active": "maybe"}])
    async def test_body_is_validated(self, api_client_superuser, db_user: User, body: dict[str, object]) -> None:
        """Only a boolean `is_active` is accepted; privileged extras never ride along."""
        response = await api_client_superuser.put(f"{ADMIN_USERS}/{db_user.id}/active", json=body)
        assert response.status_code == 422


@dataclass(slots=True)
class ErasureSubject:
    """A user together with the products, components and camera that must not block their deletion."""

    user: User
    product: Product
    component: Product
    camera: Camera


@pytest.fixture
async def erasure_subject(db_session: AsyncSession, db_product_type: ProductType) -> ErasureSubject:
    """Seed a user owning a product subtree, a camera, and a linked OAuth account."""
    user = await UserFactory.create_async(session=db_session, is_active=True, is_superuser=False)
    product = Product(owner_id=user.id, name="Owned product", product_type=db_product_type)
    component = Product(owner_id=user.id, name="Owned component", parent=product, amount_in_parent=1)
    oauth_account = OAuthAccount(
        user_id=user.id,
        oauth_name="google",
        access_token="access-token",  # test fixture value, not a credential
        account_id="oauth-account-1",
        account_email="owner@example.com",
    )
    db_session.add_all([product, component, oauth_account])
    camera = await CameraFactory.create_async(session=db_session, owner_id=user.id)
    await db_session.flush()
    return ErasureSubject(user=user, product=product, component=component, camera=camera)


async def _row_exists(session: AsyncSession, statement: Select[tuple[Any]]) -> bool:
    """Return whether a select matches a live row, bypassing the identity map."""
    return (await session.execute(statement)).first() is not None


class TestAdminUserErasure:
    """Deleting a user erases their personal data and applies the chosen content policy."""

    async def test_anonymize_reassigns_content_and_erases_the_account(
        self,
        api_client_superuser,
        db_session: AsyncSession,
        erasure_subject: ErasureSubject,
    ) -> None:
        """The default mode keeps the products, reassigned to the anonymous system account."""
        subject = erasure_subject

        response = await api_client_superuser.delete(f"{ADMIN_USERS}/{subject.user.id}")

        assert response.status_code == 204
        anonymous_id: UUID = (
            await db_session.execute(select(User.id).where(User.email == ANONYMOUS_USER_EMAIL))
        ).scalar_one()
        owners = (
            (
                await db_session.execute(
                    select(Product.owner_id).where(Product.id.in_([subject.product.id, subject.component.id]))
                )
            )
            .scalars()
            .all()
        )
        assert list(owners) == [anonymous_id, anonymous_id]
        assert not await _row_exists(db_session, select(User.id).where(User.id == subject.user.id))
        assert not await _row_exists(db_session, select(Camera.id).where(Camera.id == subject.camera.id))
        assert not await _row_exists(db_session, select(OAuthAccount.id).where(OAuthAccount.user_id == subject.user.id))

        readable = await api_client_superuser.get(f"/v1/products/{subject.product.id}")
        assert readable.status_code == 200

    async def test_delete_mode_removes_the_owned_product_subtree(
        self,
        api_client_superuser,
        db_superuser: User,
        db_session: AsyncSession,
        erasure_subject: ErasureSubject,
    ) -> None:
        """``content=delete`` erases the products as well as the account."""
        subject = erasure_subject

        with patch("app.api.application.account_erasure.audit_event") as log_audit:
            response = await api_client_superuser.delete(f"{ADMIN_USERS}/{subject.user.id}?content=delete")

        assert response.status_code == 204
        assert not await _row_exists(
            db_session, select(Product.id).where(Product.id.in_([subject.product.id, subject.component.id]))
        )
        assert not await _row_exists(db_session, select(User.id).where(User.id == subject.user.id))
        assert not await _row_exists(db_session, select(Camera.id).where(Camera.id == subject.camera.id))
        # Product-deletion audit rows must name the acting admin, not
        # the erased user whose data is being removed. Only base products are
        # audited individually; components are removed as part of the subtree.
        audited_ids = {call.args[3] for call in log_audit.call_args_list}
        assert audited_ids == {subject.product.id}
        for call in log_audit.call_args_list:
            assert call.args[0] == db_superuser.id
            assert call.args[1] == AuditAction.DELETE
            assert call.args[2] is Product

    async def test_unknown_content_mode_is_rejected(
        self, api_client_superuser, erasure_subject: ErasureSubject
    ) -> None:
        """Only the two documented content policies are accepted."""
        response = await api_client_superuser.delete(f"{ADMIN_USERS}/{erasure_subject.user.id}?content=purge")

        assert response.status_code == 422

    async def test_anonymous_account_is_not_listed(
        self, api_client_superuser, db_session: AsyncSession, db_user: User
    ) -> None:
        """The system account is not an account to manage, so the list leaves it out."""
        await get_or_create_anonymous_user(db_session)
        await db_session.flush()

        response = await api_client_superuser.get(ADMIN_USERS)

        assert response.status_code == 200
        emails = [item["email"] for item in response.json()["items"]]
        assert ANONYMOUS_USER_EMAIL not in emails
        assert db_user.email in emails

    async def test_anonymous_account_stays_readable(self, api_client_superuser, db_session: AsyncSession) -> None:
        """Its address must survive UserRead's EmailStr validation on the detail route."""
        anonymous = await get_or_create_anonymous_user(db_session)
        await db_session.flush()

        response = await api_client_superuser.get(f"{ADMIN_USERS}/{anonymous.id}")

        assert response.status_code == 200
        assert response.json()["email"] == ANONYMOUS_USER_EMAIL

    # Reactivated and given a password, it would sign in as the owner of all anonymized content.
    @pytest.mark.parametrize(
        ("method", "path_suffix", "body"),
        [
            ("put", "/active", {"is_active": True}),
            ("patch", "", {"password": "a-long-enough-password-1"}),
            ("put", "/role", {"role": "lab"}),
            ("post", "/mfa/reset", None),
        ],
    )
    async def test_anonymous_account_refuses_admin_writes(
        self,
        api_client_superuser,
        db_session: AsyncSession,
        method: str,
        path_suffix: str,
        body: dict[str, object] | None,
    ) -> None:
        """Every admin write to the system account is a 409, and it stays inactive."""
        anonymous = await get_or_create_anonymous_user(db_session)
        await db_session.flush()

        kwargs = {"json": body} if body is not None else {}
        response = await getattr(api_client_superuser, method)(f"{ADMIN_USERS}/{anonymous.id}{path_suffix}", **kwargs)

        assert response.status_code == 409, response.text
        await db_session.refresh(anonymous)
        assert anonymous.is_active is False
        assert anonymous.role == "contributor"

    async def test_last_active_superuser_cannot_be_deleted(
        self, api_client_superuser, db_session: AsyncSession, db_superuser: User
    ) -> None:
        """The only remaining admin keeps both their account and their sessions."""
        with patch("app.api.application.routers.account_erasure.revoke_user_refresh_tokens") as revoke:
            response = await api_client_superuser.delete(f"{ADMIN_USERS}/{db_superuser.id}")

        assert response.status_code == 409
        assert await _row_exists(db_session, select(User.id).where(User.id == db_superuser.id))
        # A refused erasure must have no side effects: the admin is not logged out.
        revoke.assert_not_called()

    async def test_superuser_can_be_deleted_while_another_one_is_active(
        self, api_client_superuser, db_session: AsyncSession, db_superuser: User
    ) -> None:
        """The guard blocks only the last admin, not admins in general."""
        await UserFactory.create_async(session=db_session, is_active=True, is_superuser=True)
        await db_session.flush()

        response = await api_client_superuser.delete(f"{ADMIN_USERS}/{db_superuser.id}")

        assert response.status_code == 204
        assert not await _row_exists(db_session, select(User.id).where(User.id == db_superuser.id))

    async def test_anonymous_system_account_cannot_be_deleted(
        self, api_client_superuser, db_session: AsyncSession
    ) -> None:
        """The account that owns anonymized content is not itself deletable."""
        anonymous = await get_or_create_anonymous_user(db_session)
        await db_session.flush()

        response = await api_client_superuser.delete(f"{ADMIN_USERS}/{anonymous.id}")

        assert response.status_code == 409
        assert await _row_exists(db_session, select(User.id).where(User.id == anonymous.id))

    async def test_legacy_anonymous_system_account_cannot_be_deleted(
        self, api_client_superuser, db_session: AsyncSession
    ) -> None:
        """The pre-rename system address stays protected while a rollback could still recreate it."""
        legacy = await UserFactory.create_async(
            session=db_session,
            email=LEGACY_ANONYMOUS_USER_EMAIL,
            is_active=False,
        )
        await db_session.flush()

        response = await api_client_superuser.delete(f"{ADMIN_USERS}/{legacy.id}")

        assert response.status_code == 409
        assert await _row_exists(db_session, select(User.id).where(User.id == legacy.id))
