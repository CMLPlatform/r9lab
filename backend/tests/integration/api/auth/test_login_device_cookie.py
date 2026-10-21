"""The login routes remember a client that proved the password, and only such a client."""

from typing import TYPE_CHECKING

import pytest
from fastapi import status

from app.core.http_headers import DEVICE_COOKIE_NAME

from .shared import TEST_PASSWORD, create_password_user

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.api


@pytest.mark.parametrize("transport", ["bearer", "session"])
async def test_login_sets_the_device_cookie_only_after_the_right_password(
    api_client: AsyncClient, db_session: AsyncSession, transport: str
) -> None:
    """A wrong password earns no device cookie; the right one does, on either transport."""
    user = await create_password_user(db_session, email=f"device-{transport}@example.com", username=f"dev_{transport}")
    path = f"/v1/auth/{transport}/login"

    wrong = await api_client.post(path, data={"username": user.email, "password": "not-the-password-42"})
    right = await api_client.post(path, data={"username": user.email, "password": TEST_PASSWORD})

    assert wrong.status_code == status.HTTP_400_BAD_REQUEST
    assert DEVICE_COOKIE_NAME not in wrong.cookies
    assert right.status_code in {status.HTTP_200_OK, status.HTTP_204_NO_CONTENT}
    assert DEVICE_COOKIE_NAME in right.cookies
