"""Data-collection runtime lifecycle, wired into the app in the composition root (main.py)."""

import asyncio
import logging
from typing import TYPE_CHECKING, cast

from app.api.data_collection.crud.product_revisions import prune_expired_revisions
from app.core.background_tasks import PeriodicBackgroundTask
from app.core.database import async_sessionmaker_factory
from app.core.lifecycle import DomainLifecycle, ShutdownStep

if TYPE_CHECKING:
    from fastapi import FastAPI

    from app.core.runtime import AppServices

logger = logging.getLogger(__name__)

REVISION_PRUNER_KEY = "data_collection.revision_pruner"
# Hourly, not daily: the first run waits one interval, and a redeploy restarts the wait.
_PRUNE_INTERVAL_SECONDS = 3600


class RevisionPruner(PeriodicBackgroundTask):
    """Delete product revisions past their retention period. Every worker runs it; the delete is idempotent."""

    async def run_once(self) -> None:
        """Run one pruning pass."""
        async with async_sessionmaker_factory() as session:
            if pruned := await prune_expired_revisions(session):
                logger.info("Pruned %d expired product revisions.", pruned)


async def _startup(app: FastAPI, services: AppServices) -> None:  # noqa: ARG001
    pruner = RevisionPruner(interval_seconds=_PRUNE_INTERVAL_SECONDS)
    services.extras[REVISION_PRUNER_KEY] = pruner
    await pruner.initialize()


def _shutdown_steps(app: FastAPI, services: AppServices) -> tuple[ShutdownStep, ...]:  # noqa: ARG001
    pruner = cast("RevisionPruner | None", services.extras.get(REVISION_PRUNER_KEY))
    return (
        ShutdownStep(
            label="product revision pruner",
            close=pruner.close if pruner is not None else None,
            expected_errors=(asyncio.CancelledError,),
        ),
    )


DATA_COLLECTION_LIFECYCLE = DomainLifecycle(name="data_collection", startup=_startup, shutdown_steps=_shutdown_steps)
