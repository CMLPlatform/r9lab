"""The last-superuser guard locks every active superuser in id order, so admins acting on each other queue.

Two admins suspending (or erasing) each other at once used to lock different rows first and
deadlock on the writes. These tests commit for real on separate connections, like the product
lock-order tests.
"""

import asyncio
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import delete, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth.account_guards import require_other_active_superuser
from app.api.auth.models import User
from app.api.common.exceptions import ConflictError
from scripts.seed.factories.models import UserFactory

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.db

STEP_TIMEOUT_S = 30


@pytest.fixture
async def two_admins(_setup_test_database: None, async_engine: AsyncEngine) -> AsyncGenerator[tuple[User, User]]:
    """Two committed active superusers, removed again afterwards."""
    async with AsyncSession(async_engine, expire_on_commit=False) as session:
        first = await UserFactory.create_async(session=session, is_superuser=True, is_active=True, mfa_enabled=True)
        second = await UserFactory.create_async(session=session, is_superuser=True, is_active=True, mfa_enabled=True)
        await session.commit()
    yield first, second
    async with AsyncSession(async_engine) as session:
        await session.execute(delete(User).where(User.id.in_([first.id, second.id])))
        await session.commit()


async def _wait_until_a_writer_waits_on_a_lock(engine: AsyncEngine) -> None:
    async with engine.connect() as connection:
        for _ in range(200):
            waiting = await connection.scalar(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE wait_event_type = 'Lock' AND datname = current_database()"
                )
            )
            if waiting:
                return
            await asyncio.sleep(0.05)
    pytest.fail("the second guard never waited on a lock")


async def test_admins_suspending_each_other_queue_and_the_second_is_refused(
    async_engine: AsyncEngine, two_admins: tuple[User, User]
) -> None:
    """The second guard waits for the first suspension to commit, then sees itself as the last admin."""
    first, second = two_admins
    async with AsyncSession(async_engine) as suspend_second, AsyncSession(async_engine) as suspend_first:
        await require_other_active_superuser(suspend_second, second, action="suspended")

        # Blocks on the rows the first guard holds, rather than locking another row first.
        racing = asyncio.create_task(require_other_active_superuser(suspend_first, first, action="suspended"))
        await _wait_until_a_writer_waits_on_a_lock(async_engine)
        await suspend_second.execute(update(User).where(User.id == second.id).values(is_active=False))
        await asyncio.wait_for(suspend_second.commit(), STEP_TIMEOUT_S)

        with pytest.raises(ConflictError):
            await asyncio.wait_for(racing, STEP_TIMEOUT_S)
