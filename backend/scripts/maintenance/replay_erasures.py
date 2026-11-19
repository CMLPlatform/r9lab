"""Erase again the accounts in the erasure ledger after a database restore.

`just restore` runs this in the migrator image before the API starts. Exits 1 when a
ledger line is unreadable or an account could not be erased, so the restore leaves the
API stopped.

Run with: python -m scripts.maintenance.replay_erasures
"""

import asyncio
import logging

from app.api.application.account_erasure import replay_erasures
from app.core.config.core import settings
from app.core.database import async_session_context, close_async_engine
from app.core.logging import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


async def run() -> int:
    """Replay the configured ledger against the configured database."""
    try:
        async with async_session_context() as session:
            ok = await replay_erasures(session, settings.erasure_ledger_path)
    finally:
        await close_async_engine()
    return 0 if ok else 1


def main() -> None:
    """Run the replay script."""
    raise SystemExit(asyncio.run(run()))


if __name__ == "__main__":
    main()
