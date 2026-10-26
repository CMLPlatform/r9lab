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


ROUTES = {
    "forgot": ("/v1/auth/forgot-password", {"email": "someone@example.com"}, status.HTTP_202_ACCEPTED),
    "reset": ("/v1/auth/reset-password", {"token": "not-a-token", "password": "x"}, status.HTTP_400_BAD_REQUEST),
    "verify": ("/v1/auth/verify", {"token": "not-a-token"}, status.HTTP_400_BAD_REQUEST),
}


@pytest.mark.usefixtures("fresh_limiter")
@pytest.mark.parametrize("spent", list(ROUTES))
async def test_each_email_token_route_has_its_own_ip_budget(api_client: AsyncClient, spent: str) -> None:
    """Spending one route's per-IP budget leaves the other two untouched.

    Regression: all three keyed their per-IP limit on the IP alone, so after three
    forgot-password requests a reset retried after a password-policy rejection, or a
    verification, got a 429.
    """
    path, body, expected = ROUTES[spent]
    for _ in range(int(PASSWORD_RESET_RATE_LIMIT.split("/", 1)[0])):
        assert (await api_client.post(path, json=body)).status_code == expected
    assert (await api_client.post(path, json=body)).status_code == status.HTTP_429_TOO_MANY_REQUESTS

    for other, (other_path, other_body, other_expected) in ROUTES.items():
        if other != spent:
            assert (await api_client.post(other_path, json=other_body)).status_code == other_expected
