"""The replay script's command line."""

from pathlib import Path

from scripts.maintenance.replay_erasures import parse_args


def test_defaults_require_a_ledger_and_add_no_copies() -> None:
    """Without flags a missing ledger fails the replay, and only the live ledger is read."""
    args = parse_args([])
    assert args.empty_ok is False
    assert args.also == []


def test_also_repeats_and_empty_ok_is_opt_in() -> None:
    """Each --also adds a copy; --empty-ok is for a host that never erased an account."""
    args = parse_args(["--also", "a.jsonl", "--also", "b.jsonl", "--empty-ok"])
    assert args.also == [Path("a.jsonl"), Path("b.jsonl")]
    assert args.empty_ok is True
