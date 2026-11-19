"""Fails once security.txt expires, so renewing it is a CI-visible chore (RFC 9116)."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

SECURITY_TXT = Path(__file__).resolve().parents[1] / "www" / "public" / ".well-known" / "security.txt"


def test_security_txt_is_not_expired() -> None:
    fields = dict(line.split(": ", 1) for line in SECURITY_TXT.read_text().splitlines())
    expires = datetime.fromisoformat(fields["Expires"])
    assert expires > datetime.now(UTC)
