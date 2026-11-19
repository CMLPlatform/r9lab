"""The erasure ledger file: append, read back, and unreadable lines."""

from typing import TYPE_CHECKING
from uuid import uuid4

from app.api.application.account_erasure import append_erasure, read_erasure_ledger

if TYPE_CHECKING:
    from pathlib import Path


def test_append_then_read_keeps_order_and_holds_no_more_than_the_record(tmp_path: Path) -> None:
    """Records come back in append order; the file is private and holds only id, policy and time."""
    path = tmp_path / "ledger" / "erasures.jsonl"
    first, second = uuid4(), uuid4()

    append_erasure(path, first, "anonymize")
    append_erasure(path, second, "delete")

    records, bad_lines = read_erasure_ledger(path)
    assert [(r.user_id, r.content) for r in records] == [(first, "anonymize"), (second, "delete")]
    assert bad_lines == []
    assert records[0].erased_at <= records[1].erased_at
    assert path.stat().st_mode & 0o777 == 0o600
    assert set(records[0].model_dump()) == {"user_id", "content", "erased_at"}


def test_missing_ledger_reads_as_empty(tmp_path: Path) -> None:
    """No file yet means no account was erased."""
    assert read_erasure_ledger(tmp_path / "erasures.jsonl") == ([], [])


def test_unreadable_lines_are_reported_by_number_and_the_rest_still_read(tmp_path: Path) -> None:
    """A torn write, garbage, or an unknown policy is reported; valid lines around it still count."""
    path = tmp_path / "erasures.jsonl"
    kept = uuid4()
    append_erasure(path, kept, "anonymize")
    with path.open("a", encoding="utf-8") as ledger:
        ledger.write('{"user_id": "' + str(uuid4()) + '", "content": "anonymi\n')  # torn
        ledger.write("\n")  # blank lines are skipped, not errors
        ledger.write(f'{{"user_id": "{uuid4()}", "content": "purge", "erased_at": "2026-11-19T10:00:00Z"}}\n')
        ledger.write(f'{{"user_id": "{uuid4()}", "content": "delete", "erased_at": "2026-11-19T10:00:00"}}\n')
        ledger.write("\xff\xfe not json\n")
    append_erasure(path, kept, "delete")

    records, bad_lines = read_erasure_ledger(path)

    assert [(r.user_id, r.content) for r in records] == [(kept, "anonymize"), (kept, "delete")]
    # Line 5 has no time zone: a naive time is refused rather than guessed.
    assert bad_lines == [2, 4, 5, 6]
