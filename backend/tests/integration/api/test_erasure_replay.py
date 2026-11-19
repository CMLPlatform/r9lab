"""Erasures hold across a database restore: the ledger outside the database replays them."""

import logging
from typing import TYPE_CHECKING, Any, cast
from unittest.mock import patch

import pytest
from sqlalchemy import Table, insert, select, update

from app.api.application.account_erasure import ANONYMOUS_USER_EMAIL, erase_user, replay_erasures
from app.api.auth.models import OAuthAccount, User
from app.api.data_collection.models.product import Product, ProductRevision
from app.api.plugins.r9cam.models import Camera
from scripts.seed.factories.models import CameraFactory
from tests.integration.api.auth.shared import create_password_user, link_google

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.reference_data.models import ProductType

pytestmark = pytest.mark.api

EMAIL = "leaving@example.com"
USERS = cast("Table", User.__table__)
OAUTH_ACCOUNTS = cast("Table", OAuthAccount.__table__)
CAMERAS = cast("Table", Camera.__table__)
REVISIONS = cast("Table", ProductRevision.__table__)


async def _rows(session: AsyncSession, table: Table, column: str, value: object) -> list[dict[str, Any]]:
    result = await session.execute(select(table).where(table.c[column] == value))
    return [dict(row) for row in result.mappings()]


async def _snapshot(session: AsyncSession, user_id: object) -> dict[Table, list[dict[str, Any]]]:
    """The account's personal rows as a dump taken before the erasure would hold them."""
    return {
        USERS: await _rows(session, USERS, "id", user_id),
        OAUTH_ACCOUNTS: await _rows(session, OAUTH_ACCOUNTS, "user_id", user_id),
        CAMERAS: await _rows(session, CAMERAS, "owner_id", user_id),
        # The owner's edits of their own products; a dump holds the text those edits left.
        REVISIONS: await _rows(session, REVISIONS, "editor_id", user_id),
    }


def _ledger_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _move(source: Path, target: Path) -> None:
    source.rename(target)


async def _personal_rows(session: AsyncSession, user_id: object) -> int:
    return sum(len(rows) for rows in (await _snapshot(session, user_id)).values())


async def test_replay_erases_an_account_a_restore_brought_back(
    db_session: AsyncSession, db_product_type: ProductType, erasure_ledger_path: Path
) -> None:
    """Erase, restore the pre-erasure rows, replay: the account and its personal data stay gone."""
    user = await create_password_user(db_session, email=EMAIL, username="leaving_user")
    product = Product(owner_id=user.id, name="Owned product", product_type=db_product_type)
    db_session.add(product)
    await link_google(db_session, user)
    await CameraFactory.create_async(session=db_session, owner_id=user.id)
    await db_session.flush()
    db_session.add(
        ProductRevision(
            product_id=product.id, editor_id=user.id, version=1, changed_fields=["name"], snapshot={"name": "Old"}
        )
    )
    await db_session.flush()
    user_id, product_id = user.id, product.id
    before = await _snapshot(db_session, user_id)
    assert all(before.values())

    await erase_user(db_session, user, actor_id=user_id)
    assert await _personal_rows(db_session, user_id) == 0
    # The ledger outlives the restore and must not carry what the erasure removed.
    assert EMAIL not in _ledger_text(erasure_ledger_path)

    # The restore: the dump predates the erasure, so every row comes back as it was.
    for table, rows in before.items():
        await db_session.execute(insert(table), rows)
    await db_session.execute(update(Product).where(Product.id == product_id).values(owner_id=user_id))
    await db_session.commit()
    assert await _personal_rows(db_session, user_id) == 4

    assert await replay_erasures(db_session, [erasure_ledger_path]) is True

    assert await _personal_rows(db_session, user_id) == 0
    owner = (await db_session.execute(select(Product.owner_id).where(Product.id == product_id))).scalar_one()
    anonymous_id = (await db_session.execute(select(User.id).where(User.email == ANONYMOUS_USER_EMAIL))).scalar_one()
    assert owner == anonymous_id
    # Replay reads the ledger without adding to it, and a second run is harmless.
    assert len(_ledger_text(erasure_ledger_path).split()) == 1
    assert await replay_erasures(db_session, [erasure_ledger_path]) is True
    assert await _personal_rows(db_session, user_id) == 0


async def test_replay_reports_unreadable_lines_but_still_erases_the_rest(
    db_session: AsyncSession, erasure_ledger_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """A corrupt line fails the replay so the API stays stopped, after the valid lines ran."""
    user = await create_password_user(db_session, email=EMAIL, username="leaving_user")
    user_id = user.id
    before = await _snapshot(db_session, user_id)
    await erase_user(db_session, user, actor_id=user_id)
    with erasure_ledger_path.open("a", encoding="utf-8") as ledger:
        ledger.write("not a record\n")
    await db_session.execute(insert(USERS), before[USERS])
    await db_session.commit()

    with caplog.at_level(logging.ERROR):
        assert await replay_erasures(db_session, [erasure_ledger_path]) is False

    assert await _personal_rows(db_session, user_id) == 0
    assert "line 3 is not a valid record" in caplog.text


async def test_erasure_is_not_committed_when_the_ledger_cannot_be_written(
    db_session: AsyncSession, erasure_ledger_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """No ledger entry, no erasure: the failure is logged and raised before the commit."""
    user = await create_password_user(db_session, email=EMAIL, username="leaving_user")
    # A file where the ledger's directory should be makes every append fail.
    erasure_ledger_path.parent.write_text("")

    with (
        patch.object(db_session, "commit") as commit,
        caplog.at_level(logging.ERROR),
        pytest.raises(OSError, match="erasure-ledger"),
    ):
        await erase_user(db_session, user, actor_id=user.id)

    commit.assert_not_called()
    assert "Could not write the erasure ledger" in caplog.text


async def test_replay_takes_the_union_with_the_backup_copy_of_the_ledger(
    db_session: AsyncSession, erasure_ledger_path: Path
) -> None:
    """With the live ledger lost along with the backup disk, the offsite copy still replays."""
    user = await create_password_user(db_session, email=EMAIL, username="leaving_user")
    user_id = user.id
    before = await _snapshot(db_session, user_id)
    await erase_user(db_session, user, actor_id=user_id)
    backup_copy = erasure_ledger_path.with_name("from-backup.jsonl")
    _move(erasure_ledger_path, backup_copy)
    await db_session.execute(insert(USERS), before[USERS])
    await db_session.commit()

    assert await replay_erasures(db_session, [erasure_ledger_path, backup_copy]) is True

    assert await _personal_rows(db_session, user_id) == 0


async def test_replay_fails_without_any_ledger_unless_told_none_is_expected(
    db_session: AsyncSession, erasure_ledger_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """A missing ledger may be a wrong mount, so it fails unless the host never erased anyone."""
    with caplog.at_level(logging.ERROR):
        assert await replay_erasures(db_session, [erasure_ledger_path]) is False
    assert "No erasure ledger" in caplog.text

    assert await replay_erasures(db_session, [erasure_ledger_path], empty_ok=True) is True
