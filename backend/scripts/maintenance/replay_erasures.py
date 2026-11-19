"""Erase again the accounts in the erasure ledger after a database restore.

`just restore` runs this in the migrator image before the API starts, with the live
ledger and the copy from the newest backup snapshot. Exits 1 when a ledger line is
unreadable, an account could not be erased, or no ledger file exists, so the restore
leaves the API stopped.

Run with: python -m scripts.maintenance.replay_erasures [--also PATH] [--empty-ok]
"""

import argparse
import asyncio
import logging
from pathlib import Path

from app.api.application.account_erasure import replay_erasures
from app.core.config.core import settings
from app.core.database import async_session_context, close_async_engine
from app.core.logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse the command line."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--also",
        type=Path,
        action="append",
        default=[],
        metavar="PATH",
        help="another ledger copy to replay with the live one, such as the one from a backup",
    )
    parser.add_argument(
        "--empty-ok",
        action="store_true",
        help="succeed when no ledger file exists; only for a host where no account was ever erased",
    )
    return parser.parse_args(argv)


async def run(args: argparse.Namespace) -> int:
    """Replay the live ledger, plus any extra copies, against the configured database."""
    try:
        async with async_session_context() as session:
            ok = await replay_erasures(session, [settings.erasure_ledger_path, *args.also], empty_ok=args.empty_ok)
    finally:
        await close_async_engine()
    return 0 if ok else 1


def main() -> None:
    """Run the replay script."""
    raise SystemExit(asyncio.run(run(parse_args())))


if __name__ == "__main__":
    main()
