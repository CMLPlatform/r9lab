"""Unit tests for the OAuth callback dependency."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from httpx_oauth.integrations.fastapi import OAuth2AuthorizeCallbackError
from httpx_oauth.oauth2 import GetAccessTokenError

from app.api.auth.exceptions import OAuthInvalidStateError, OAuthStateDecodeError
from app.api.auth.services.oauth.base import OAuthFlowConfig, authorize_callback_dependency
from app.api.auth.services.oauth.utils import (
    CSRF_TOKEN_KEY,
    OAUTH_FLOW_KEY,
    OAUTH_PROVIDER_KEY,
    generate_csrf_token,
    generate_state_token,
)

STATE_SECRET = "test-state-secret-at-least-32-bytes-long-for-hmac-sha256"
REDIRECT_URL = "https://api.example.com/v1/oauth/github/session/callback"


def _config() -> tuple[OAuthFlowConfig, MagicMock]:
    client = MagicMock()
    client.name = "github"
    client.get_access_token = AsyncMock(return_value={"access_token": "provider-token"})
    config = OAuthFlowConfig(
        oauth_client=client, state_secret=STATE_SECRET, oauth_flow="github:session", redirect_url=REDIRECT_URL
    )
    return config, client


def _request_with_state(config: OAuthFlowConfig) -> tuple[MagicMock, str]:
    csrf_token = generate_csrf_token()
    state = generate_state_token(
        {CSRF_TOKEN_KEY: csrf_token, OAUTH_PROVIDER_KEY: "github", OAUTH_FLOW_KEY: config.oauth_flow}, STATE_SECRET
    )
    request = MagicMock()
    request.cookies = {config.cookie_settings.name: csrf_token}
    return request, state


async def test_trades_code_after_state_verifies() -> None:
    """A verified state lets the code through to the provider."""
    config, client = _config()
    request, state = _request_with_state(config)

    token, returned_state = await authorize_callback_dependency(config, "unused")(request, code="c", state=state)

    assert token == {"access_token": "provider-token"}
    assert returned_state == state
    client.get_access_token.assert_awaited_once_with("c", REDIRECT_URL, None)


@pytest.mark.parametrize(
    ("state", "error"),
    [(None, OAuthInvalidStateError), ("not-a-jwt", OAuthStateDecodeError)],
)
async def test_bad_state_never_reaches_provider(state: str | None, error: type[Exception]) -> None:
    """A missing or forged state answers 400 without trading the code."""
    config, client = _config()
    request, _ = _request_with_state(config)

    with pytest.raises(error):
        await authorize_callback_dependency(config, "unused")(request, code="c", state=state)
    client.get_access_token.assert_not_awaited()


async def test_state_without_csrf_cookie_never_reaches_provider() -> None:
    """A valid state from another browser answers 400 without trading the code."""
    config, client = _config()
    request, state = _request_with_state(config)
    request.cookies = {}

    with pytest.raises(OAuthInvalidStateError):
        await authorize_callback_dependency(config, "unused")(request, code="c", state=state)
    client.get_access_token.assert_not_awaited()


@pytest.mark.parametrize(
    ("exchange", "status_code"),
    [
        # Google refuses with a 400, GitHub with a 200 and an `error` body.
        ({"side_effect": GetAccessTokenError("bad code", httpx.Response(400))}, 400),
        ({"return_value": {"error": "bad_verification_code"}}, 400),
        ({"side_effect": GetAccessTokenError("timed out")}, 502),
        ({"side_effect": GetAccessTokenError("down", httpx.Response(503))}, 502),
    ],
)
async def test_failed_exchange_is_no_500(exchange: dict[str, object], status_code: int) -> None:
    """A refused code is the caller's fault (400); an unreachable provider is a 502."""
    config, client = _config()
    request, state = _request_with_state(config)
    client.get_access_token.configure_mock(**exchange)

    with pytest.raises(OAuth2AuthorizeCallbackError) as exc_info:
        await authorize_callback_dependency(config, "unused")(request, code="c", state=state)
    assert exc_info.value.status_code == status_code


@pytest.mark.parametrize(("code", "error"), [(None, None), ("c", "access_denied")])
async def test_missing_code_or_provider_error_answers_400(code: str | None, error: str | None) -> None:
    """No code, or an error from the provider's consent screen, answers 400."""
    config, client = _config()
    request, state = _request_with_state(config)

    with pytest.raises(OAuth2AuthorizeCallbackError) as exc_info:
        await authorize_callback_dependency(config, "unused")(request, code=code, state=state, error=error)
    assert exc_info.value.status_code == 400
    client.get_access_token.assert_not_awaited()
