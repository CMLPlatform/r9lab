"""Device cookies keep a known client's login budget apart from the account-wide one."""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import Response
from fastapi.security import OAuth2PasswordRequestForm

from app.api.auth.services.device_cookie import device_id_for, issue_device_token, set_device_cookie
from app.api.auth.services.rate_limiter import ACCOUNT_GUESS_DAILY_RATE_LIMIT, LOGIN_RATE_LIMIT
from app.api.auth.services.user_manager import UserManager
from app.api.common.rate_limiting import Limiter, RateLimitExceededError
from app.core.http_headers import DEVICE_COOKIE_NAME

OWNER = "owner@example.com"
PER_MINUTE = int(LOGIN_RATE_LIMIT.split("/", 1)[0])
PER_DAY = int(ACCOUNT_GUESS_DAILY_RATE_LIMIT.split("/", 1)[0])


def _credentials(password: str) -> OAuth2PasswordRequestForm:
    form = MagicMock(spec=OAuth2PasswordRequestForm)
    form.username = OWNER
    form.password = password
    return form


def test_device_token_is_bound_to_its_account() -> None:
    """A token answers only for the account it was issued for, and a tampered one for none."""
    token = issue_device_token(OWNER)

    assert device_id_for(token, " Owner@Example.COM ")
    assert device_id_for(token, "someone-else@example.com") is None
    assert device_id_for(token[:-2] + "xx", OWNER) is None
    assert device_id_for(None, OWNER) is None


def test_device_cookie_is_host_only_and_hidden_from_scripts() -> None:
    """The cookie follows the auth cookies' rules and never names the account."""
    response = Response()
    set_device_cookie(response, OWNER)

    header = response.headers["set-cookie"]
    assert header.startswith(f"{DEVICE_COOKIE_NAME}=")
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "Domain" not in header
    assert "owner" not in header.lower()


@pytest.fixture
def locked_out_account() -> tuple[UserManager, Limiter, list[float]]:
    """An account whose unknown-client budget a stranger has spent on wrong passwords."""
    limiter = Limiter(storage_uri="memory://")
    clock = [1_000_000.0]
    manager = UserManager.__new__(UserManager)
    manager.user_db = MagicMock()
    return manager, limiter, clock


async def test_a_stranger_cannot_lock_the_owner_out_of_a_known_device(
    locked_out_account: tuple[UserManager, Limiter, list[float]],
) -> None:
    """100 wrong passwords from unknown clients block unknown clients, not the owner's device."""
    manager, limiter, clock = locked_out_account
    owner = MagicMock()

    async def check(credentials: OAuth2PasswordRequestForm) -> MagicMock | None:
        return owner if credentials.password == "right" else None

    with (
        patch("limits.storage.memory.time.time", side_effect=lambda: clock[0]),
        patch("app.api.auth.services.user_manager.limiter", new=limiter),
        patch.object(UserManager, "_authenticate_offloading_hashes", side_effect=check),
    ):
        for n in range(PER_DAY):
            if n % PER_MINUTE == 0:
                clock[0] += 61
            assert await manager.authenticate(_credentials("wrong")) is None
        clock[0] += 61
        with pytest.raises(RateLimitExceededError):
            await manager.authenticate(_credentials("right"))
        with pytest.raises(RateLimitExceededError):
            await manager.authenticate(_credentials("right"), device_token=issue_device_token("other@example.com"))

        assert await manager.authenticate(_credentials("right"), device_token=issue_device_token(OWNER)) is owner


async def test_a_known_device_still_has_its_own_guess_limit(
    locked_out_account: tuple[UserManager, Limiter, list[float]],
) -> None:
    """A stolen device cookie buys no unlimited guessing: the device gets the same per-minute limit."""
    manager, limiter, clock = locked_out_account
    device_token = issue_device_token(OWNER)

    with (
        patch("limits.storage.memory.time.time", side_effect=lambda: clock[0]),
        patch("app.api.auth.services.user_manager.limiter", new=limiter),
        patch.object(UserManager, "_authenticate_offloading_hashes", return_value=None),
    ):
        for _ in range(PER_MINUTE):
            assert await manager.authenticate(_credentials("wrong"), device_token=device_token) is None
        with pytest.raises(RateLimitExceededError):
            await manager.authenticate(_credentials("wrong"), device_token=device_token)
