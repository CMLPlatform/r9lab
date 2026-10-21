"""Device cookies: a client that has signed in to an account keeps its own login budget.

Following OWASP's "Slow Down Online Guessing Attacks with Device Cookies": failed logins
from clients the account has never signed in on can lock out only those clients. A
stranger guessing at an account therefore cannot lock its owner out of their own devices.
"""

import secrets

import jwt
from fastapi import Response
from fastapi_users.jwt import decode_jwt, generate_jwt

from app.api.auth.config import settings as auth_settings
from app.api.auth.services.auth_backends import set_browser_auth_cookie
from app.api.auth.services.email_identity import account_rate_limit_identity
from app.core.http_headers import DEVICE_COOKIE_NAME, DEVICE_TOKEN_HEADER
from app.core.pseudonyms import keyed_digest

DEVICE_TOKEN_AUDIENCE = "r9lab:login-device"  # noqa: S105 - JWT audience, not a secret.
DEVICE_COOKIE_TTL_SECONDS = 365 * 86_400
_DIGEST_NAMESPACE = "auth:login:device-owner"


def _owner_digest(identifier: str) -> str:
    # A keyed digest, so the cookie never carries the address it is bound to.
    return keyed_digest(_DIGEST_NAMESPACE, account_rate_limit_identity(identifier))


def issue_device_token(identifier: str) -> str:
    """Return a signed device token bound to the account ``identifier`` signs in to."""
    return generate_jwt(
        {"sub": _owner_digest(identifier), "nonce": secrets.token_urlsafe(16), "aud": DEVICE_TOKEN_AUDIENCE},
        auth_settings.auth_token_secret.get_secret_value(),
        DEVICE_COOKIE_TTL_SECONDS,
    )


def device_id_for(token: str | None, identifier: str) -> str | None:
    """Return the device id of a valid token bound to ``identifier``, or None.

    A token for another account, an expired or tampered one, or none at all makes the
    request an unknown client, which spends the account-wide budget.
    """
    if not token:
        return None
    try:
        claims = decode_jwt(token, auth_settings.auth_token_secret.get_secret_value(), [DEVICE_TOKEN_AUDIENCE])
    except jwt.PyJWTError:
        return None
    if claims.get("sub") != _owner_digest(identifier):
        return None
    nonce = claims.get("nonce")
    return nonce if isinstance(nonce, str) and nonce else None


def set_device_cookie(response: Response, identifier: str, *, in_header: bool = False) -> None:
    """Remember this client for the account it just proved the password of.

    It outlives logout on purpose: the point is that this client stays known.
    ``in_header`` also returns the token in DEVICE_TOKEN_HEADER, for native apps that may
    not keep cookies and send it back in that header instead.
    """
    token = issue_device_token(identifier)
    set_browser_auth_cookie(response, key=DEVICE_COOKIE_NAME, value=token, max_age=DEVICE_COOKIE_TTL_SECONDS)
    if in_header:
        response.headers[DEVICE_TOKEN_HEADER] = token
