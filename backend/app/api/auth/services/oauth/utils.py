"""OAuth helper DTOs and token utilities."""

import base64
import hashlib
import secrets
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Response
from fastapi_users.jwt import SecretType, generate_jwt
from pydantic import BaseModel

from app.api.auth.config import settings as auth_settings

if TYPE_CHECKING:
    from typing import Literal

STATE_TOKEN_AUDIENCE = "fastapi-users:oauth-state"  # noqa: S105 # This value is not a secret
OAUTH_STATE_JWT_ALGORITHM = "HS256"
CSRF_TOKEN_KEY = "csrftoken"  # noqa: S105 # This value is not a secret
OAUTH_PROVIDER_KEY = "oauth_provider"
OAUTH_FLOW_KEY = "oauth_flow"
FRONTEND_REDIRECT_URI_KEY = "frontend_redirect_uri"
CSRF_TOKEN_COOKIE_NAME = "__Host-r9lab-oauth-csrf"  # noqa: S105 # This value is not a secret
PKCE_VERIFIER_COOKIE_NAME = "__Host-r9lab-oauth-pkce"
SET_COOKIE_HEADER = b"set-cookie"
ACCESS_TOKEN_KEY = "access_token"  # noqa: S105 # This value is not a secret


class OAuth2AuthorizeResponse(BaseModel):
    """Response model for OAuth2 authorization endpoint."""

    authorization_url: str


def generate_state_token(data: dict[str, str], secret: SecretType, lifetime_seconds: int | None = None) -> str:
    """Generate a JWT state token for OAuth flows."""
    payload = data.copy()
    payload["aud"] = STATE_TOKEN_AUDIENCE
    return generate_jwt(
        payload,
        secret,
        lifetime_seconds or auth_settings.oauth_state_token_ttl_seconds,
        algorithm=OAUTH_STATE_JWT_ALGORITHM,
    )


def generate_csrf_token() -> str:
    """Generate a CSRF token for OAuth flows."""
    return secrets.token_urlsafe(32)


def generate_pkce_pair() -> tuple[str, str]:
    """Return a PKCE code verifier and its S256 challenge (RFC 7636).

    The verifier is random, never derived from the state: the state JWT is readable by
    anyone who sees the authorization URL, so a derived verifier would be public.
    """
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


@dataclass
class OAuthCookieSettings:
    """Configuration for OAuth CSRF cookies."""

    name: str = CSRF_TOKEN_COOKIE_NAME
    path: str = "/"
    domain: str | None = None
    httponly: bool = True
    samesite: Literal["lax", "strict", "none"] = "lax"


def set_csrf_cookie(response: Response, cookie_settings: OAuthCookieSettings, csrf_token: str) -> None:
    """Set the CSRF cookie on the response."""
    _set_flow_cookie(response, cookie_settings, cookie_settings.name, csrf_token)


def set_pkce_cookie(response: Response, cookie_settings: OAuthCookieSettings, code_verifier: str) -> None:
    """Set the PKCE code verifier cookie on the response, beside the CSRF cookie."""
    _set_flow_cookie(response, cookie_settings, PKCE_VERIFIER_COOKIE_NAME, code_verifier)


def _set_flow_cookie(response: Response, cookie_settings: OAuthCookieSettings, name: str, value: str) -> None:
    response.set_cookie(
        name,
        value,
        max_age=auth_settings.oauth_state_token_ttl_seconds,
        path=cookie_settings.path,
        domain=cookie_settings.domain,
        secure=True,
        httponly=cookie_settings.httponly,
        samesite=cookie_settings.samesite,
    )
