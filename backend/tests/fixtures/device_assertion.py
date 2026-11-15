"""Signed RPi camera device assertions for tests."""

import base64
import secrets
import time
from typing import TYPE_CHECKING

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519

from app.api.plugins.r9cam.device_assertion import ASSERTION_AUDIENCE

if TYPE_CHECKING:
    from uuid import UUID


def make_eddsa_keypair() -> tuple[ed25519.Ed25519PrivateKey, dict]:
    """Generate an Ed25519 key pair and return (private_key, public_jwk), as r9cam's EdDSA pairing sends it."""
    private_key = ed25519.Ed25519PrivateKey.generate()
    raw = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    x = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    return private_key, {"kty": "OKP", "crv": "Ed25519", "x": x, "alg": "EdDSA"}


def make_keypair() -> tuple[ec.EllipticCurvePrivateKey, dict]:
    """Generate an EC P-256 key pair and return (private_key, public_jwk)."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    pub = private_key.public_key().public_numbers()

    def _b64(n: int) -> str:
        return base64.urlsafe_b64encode(n.to_bytes(32, "big")).rstrip(b"=").decode()

    return private_key, {"kty": "EC", "crv": "P-256", "x": _b64(pub.x), "y": _b64(pub.y)}


def sign_assertion(
    private_key: ec.EllipticCurvePrivateKey | ed25519.Ed25519PrivateKey,
    camera_id: UUID | str,
    key_id: str,
    *,
    aud: str = ASSERTION_AUDIENCE,
    exp_offset: int = 120,
    iss: str | None = None,
    sub: str | None = None,
    jti: str | None = None,
    omit_claims: set[str] | None = None,
    headers: dict[str, object] | None = None,
) -> str:
    """Sign a device assertion for ``camera_id``; ``jti=""`` is kept as given.

    The algorithm follows the key type: ES256 for P-256, EdDSA for Ed25519.
    """
    now = int(time.time())
    payload = {
        "iss": iss or f"camera:{camera_id}",
        "sub": sub or f"camera:{camera_id}",
        "aud": aud,
        "iat": now,
        "nbf": now,
        "exp": now + exp_offset,
        "jti": jti if jti is not None else secrets.token_urlsafe(24),
    }
    for claim in omit_claims or set():
        payload.pop(claim, None)
    algorithm = "EdDSA" if isinstance(private_key, ed25519.Ed25519PrivateKey) else "ES256"
    return jwt.encode(payload, private_key, algorithm=algorithm, headers=headers or {"kid": key_id})
