"""Fails a month before security.txt expires, so renewing it is a CI-visible chore (RFC 9116)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

SECURITY_TXT = Path(__file__).resolve().parents[1] / "www" / "public" / ".well-known" / "security.txt"


def test_security_txt_expires_within_a_year_but_not_this_month() -> None:
    lines = [line for line in SECURITY_TXT.read_text().splitlines() if line and not line.startswith("#")]
    fields = dict(line.split(": ", 1) for line in lines)
    expires = datetime.fromisoformat(fields["Expires"])
    now = datetime.now(UTC)
    assert now + timedelta(days=30) < expires < now + timedelta(days=366)
