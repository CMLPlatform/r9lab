"""Per-IP budgets of the email-token routes: forgot password, reset password, verify."""

from typing import TYPE_CHECKING

import pytest
from fastapi import status
from limits.storage import storage_from_string
from limits.strategies import FixedWindowRateLimiter

from app.api.auth.services.rate_limiter import PASSWORD_RESET_RATE_LIMIT
from app.api.common.rate_limiting import limiter

if TYPE_CHECKING:
    from httpx import AsyncClient

pytestmark = pytest.mark.api


@pytest.fixture
def fresh_limiter(api_client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Enable the app limiter on an empty in-memory store; api_client turns it off, so run after it."""
    del api_client
    monkeypatch.setattr(limiter, "enabled", True)
    monkeypatch.setattr(limiter, "_limiter", FixedWindowRateLimiter(storage_from_string("memory://")))


@pytest.mark.usefixtures("fresh_limiter")
async def test_forgot_password_does_not_spend_the_reset_or_verify_budget(api_client: AsyncClient) -> None:
    """Each email-token route has its own per-IP bucket.

    Regression: all three keyed their per-IP limit on the IP alone, so after three
    forgot-password requests a reset retried after a password-policy rejection, or a
    verification, got a 429.
    """
    for n in range(int(PASSWORD_RESET_RATE_LIMIT.split("/", 1)[0])):
        forgot = await api_client.post("/v1/auth/forgot-password", json={"email": f"someone{n}@example.com"})
        assert forgot.status_code == status.HTTP_202_ACCEPTED

    reset = await api_client.post("/v1/auth/reset-password", json={"token": "not-a-token", "password": "x"})
    verify = await api_client.post("/v1/auth/verify", json={"token": "not-a-token"})

    assert reset.status_code == status.HTTP_400_BAD_REQUEST
    assert verify.status_code == status.HTTP_400_BAD_REQUEST
