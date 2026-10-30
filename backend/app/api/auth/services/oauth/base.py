"""Shared OAuth flow helpers."""

import secrets
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import jwt
from fastapi import Request, Response, status
from fastapi.responses import RedirectResponse
from fastapi_users.jwt import decode_jwt
from httpx_oauth.integrations.fastapi import OAuth2AuthorizeCallbackError
from httpx_oauth.oauth2 import (  # Used at runtime for FastAPI validation
    BaseOAuth2,
    GetAccessTokenError,
    OAuth2Token,
)

from app.api.auth.config import normalize_oauth_redirect_uri, settings
from app.api.auth.exceptions import (
    OAuthInvalidRedirectURIError,
    OAuthInvalidStateError,
    OAuthStateDecodeError,
    OAuthStateExpiredError,
)

from .utils import (
    ACCESS_TOKEN_KEY,
    CSRF_TOKEN_KEY,
    FRONTEND_REDIRECT_URI_KEY,
    OAUTH_FLOW_KEY,
    OAUTH_PROVIDER_KEY,
    OAUTH_STATE_JWT_ALGORITHM,
    SET_COOKIE_HEADER,
    STATE_TOKEN_AUDIENCE,
    OAuth2AuthorizeResponse,
    OAuthCookieSettings,
    generate_csrf_token,
    generate_state_token,
    set_csrf_cookie,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from fastapi_users.jwt import SecretType

OAuthRedirectStatus = Literal["success", "error", "mfa_required"]
OAUTH_STATUS_ERROR = "error"
OAUTH_STATUS_MFA_REQUIRED = "mfa_required"
OAUTH_CODE_REJECTED = "OAUTH_CODE_REJECTED"
OAUTH_PROVIDER_UNAVAILABLE = "OAUTH_PROVIDER_UNAVAILABLE"


@dataclass(frozen=True, slots=True)
class OAuthFlowConfig:
    """Runtime config shared by one OAuth route group."""

    oauth_client: BaseOAuth2
    state_secret: SecretType
    oauth_flow: str
    redirect_url: str | None = None
    cookie_settings: OAuthCookieSettings = field(default_factory=OAuthCookieSettings)


def authorize_callback_dependency(
    config: OAuthFlowConfig, callback_route_name: str
) -> Callable[..., Awaitable[tuple[OAuth2Token, str]]]:
    """Build the callback dependency: verify `state`, then trade `code` with the provider.

    httpx-oauth's own dependency trades the code first, so a made-up code reached the
    provider, and the provider's refusal came back as a 500.
    """

    async def authorize_callback(
        request: Request,
        code: str | None = None,
        code_verifier: str | None = None,
        state: str | None = None,
        error: str | None = None,
    ) -> tuple[OAuth2Token, str]:
        if code is None or error is not None:
            raise OAuth2AuthorizeCallbackError(status_code=status.HTTP_400_BAD_REQUEST, detail=error)
        if state is None:
            raise OAuthInvalidStateError
        verify_oauth_state(config, request, state)

        redirect_url = config.redirect_url or str(request.url_for(callback_route_name))
        try:
            token = await config.oauth_client.get_access_token(code, redirect_url, code_verifier)
        except GetAccessTokenError as err:
            # Only a 4xx from the provider means a bad code; a timeout or provider 5xx is not the caller's fault.
            if err.response is None or not err.response.is_client_error:
                raise OAuth2AuthorizeCallbackError(
                    status_code=status.HTTP_502_BAD_GATEWAY, detail=OAUTH_PROVIDER_UNAVAILABLE
                ) from err
            raise OAuth2AuthorizeCallbackError(
                status_code=status.HTTP_400_BAD_REQUEST, detail=OAUTH_CODE_REJECTED, response=err.response
            ) from err
        # GitHub refuses a code with a 200 and an `error` body.
        if ACCESS_TOKEN_KEY not in token:
            raise OAuth2AuthorizeCallbackError(status_code=status.HTTP_400_BAD_REQUEST, detail=OAUTH_CODE_REJECTED)
        return token, state

    return authorize_callback


def build_state_data(
    config: OAuthFlowConfig,
    csrf_token: str,
    extra: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build signed OAuth state claims for this transaction."""
    return {
        **(extra or {}),
        CSRF_TOKEN_KEY: csrf_token,
        OAUTH_PROVIDER_KEY: config.oauth_client.name,
        OAUTH_FLOW_KEY: config.oauth_flow,
    }


async def build_authorize_response(
    config: OAuthFlowConfig,
    request: Request,
    response: Response,
    *,
    callback_route_name: str,
    state_claims: dict[str, str] | None = None,
    extras_params: dict[str, Any] | None = None,
) -> OAuth2AuthorizeResponse:
    """Build an OAuth authorization response with R9lab state binding."""
    authorize_redirect_url = config.redirect_url or str(request.url_for(callback_route_name))

    csrf_token = generate_csrf_token()
    claims = dict(state_claims or {})
    redirect_uri = request.query_params.get("redirect_uri")
    if redirect_uri:
        if not is_allowed_frontend_redirect(redirect_uri):
            raise OAuthInvalidRedirectURIError
        claims[FRONTEND_REDIRECT_URI_KEY] = redirect_uri

    state = generate_state_token(build_state_data(config, csrf_token, claims), config.state_secret)
    authorization_url = await config.oauth_client.get_authorization_url(
        authorize_redirect_url,
        state,
        None,
        extras_params=extras_params,
    )

    set_csrf_cookie(response, config.cookie_settings, csrf_token)
    return OAuth2AuthorizeResponse(authorization_url=authorization_url)


def verify_oauth_state(config: OAuthFlowConfig, request: Request, state: str) -> dict[str, Any]:
    """Decode the state JWT and verify CSRF and transaction binding."""
    try:
        state_data = decode_jwt(
            state,
            config.state_secret,
            [STATE_TOKEN_AUDIENCE],
            algorithms=[OAUTH_STATE_JWT_ALGORITHM],
        )
    except jwt.ExpiredSignatureError as err:
        raise OAuthStateExpiredError from err
    except jwt.InvalidTokenError as err:
        raise OAuthStateDecodeError from err

    cookie_csrf_token = request.cookies.get(config.cookie_settings.name)
    state_csrf_token = state_data.get(CSRF_TOKEN_KEY)

    if not cookie_csrf_token or not state_csrf_token or not secrets.compare_digest(cookie_csrf_token, state_csrf_token):
        raise OAuthInvalidStateError

    if state_data.get(OAUTH_PROVIDER_KEY) != config.oauth_client.name:
        raise OAuthInvalidStateError
    if state_data.get(OAUTH_FLOW_KEY) != config.oauth_flow:
        raise OAuthInvalidStateError

    return state_data


def create_oauth_result_redirect(
    frontend_redirect: str,
    *,
    status: OAuthRedirectStatus,
    response: Response | None = None,
    error: str | None = None,
    mfa_handoff: str | None = None,
) -> Response:
    """Create a frontend redirect with the OAuth result carried in the fragment."""
    parts = list(urlparse(frontend_redirect))
    query = dict(parse_qsl(parts[4]))
    fragment = dict(parse_qsl(parts[5]))

    query.pop(ACCESS_TOKEN_KEY, None)
    for key in (ACCESS_TOKEN_KEY, "status", "error", "mfa_handoff"):
        fragment.pop(key, None)

    fragment["status"] = status
    if status == OAUTH_STATUS_ERROR and error:
        fragment["error"] = error
    if status == OAUTH_STATUS_MFA_REQUIRED and mfa_handoff:
        fragment["mfa_handoff"] = mfa_handoff

    parts[4] = urlencode(query)
    parts[5] = urlencode(fragment)
    redirect_response = RedirectResponse(urlunparse(parts))

    if response is not None:
        for raw_header in response.raw_headers:
            if raw_header[0].lower() == SET_COOKIE_HEADER:
                redirect_response.headers.append("set-cookie", raw_header[1].decode("latin-1"))
    return redirect_response


def is_allowed_frontend_redirect(redirect_uri: str) -> bool:
    """Validate whether a frontend redirect URI is exactly allowed."""
    try:
        normalized_redirect = normalize_oauth_redirect_uri(redirect_uri)
    except ValueError:
        return False

    return normalized_redirect in settings.oauth_allowed_redirect_uris
