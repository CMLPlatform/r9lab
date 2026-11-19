"""Product edit history under account erasure and the retention period."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import select, update

from app.api.application.account_erasure import erase_user
from app.api.data_collection.crud.product_commands import update_product
from app.api.data_collection.crud.product_revisions import REVISION_RETENTION, prune_expired_revisions
from app.api.data_collection.models.product import Product, ProductRevision
from app.api.data_collection.schemas import ProductUpdate
from scripts.seed.factories.models import UserFactory

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.application.account_erasure import ErasureContent
    from app.api.auth.models import User

pytestmark = pytest.mark.db


async def _edited_product(session: AsyncSession, owner: User, editor: User) -> int:
    product = Product(owner_id=owner.id, name="History kettle")
    session.add(product)
    await session.flush()
    await update_product(
        session, product.id, ProductUpdate(name="History kettle v2"), if_match_version=1, user_id=editor.id
    )
    return product.id


async def _editors(session: AsyncSession, product_id: int) -> list[object]:
    rows = await session.execute(select(ProductRevision.editor_id).where(ProductRevision.product_id == product_id))
    return list(rows.scalars().all())


@pytest.mark.parametrize("content", ["anonymize", "delete"])
async def test_erasure_clears_the_history_of_own_products_and_detaches_edits_to_others(
    db_session: AsyncSession, db_superuser: User, content: ErasureContent
) -> None:
    """The erased user's products keep no history; their edits elsewhere stay, unattributed."""
    leaving = await UserFactory.create_async(session=db_session, is_active=True)
    other = await UserFactory.create_async(session=db_session, is_active=True)
    own_product = await _edited_product(db_session, leaving, leaving)
    moderated_by_superuser = await _edited_product(db_session, leaving, db_superuser)
    # Stands in for a moderator's correction: update_product leaves authorization to the route.
    others_product = await _edited_product(db_session, other, leaving)

    with patch("app.api.application.account_erasure.audit_event"):
        await erase_user(db_session, leaving, actor_id=uuid4(), content=content)

    assert await _editors(db_session, own_product) == []
    assert await _editors(db_session, moderated_by_superuser) == []
    assert await _editors(db_session, others_product) == [None]


async def test_pruning_deletes_only_revisions_past_the_retention_period(
    db_session: AsyncSession, db_superuser: User
) -> None:
    """A revision older than the retention period goes; a recent one stays."""
    expired = await _edited_product(db_session, db_superuser, db_superuser)
    recent = await _edited_product(db_session, db_superuser, db_superuser)
    await db_session.execute(
        update(ProductRevision)
        .where(ProductRevision.product_id == expired)
        .values(created_at=datetime.now(UTC) - REVISION_RETENTION - REVISION_RETENTION / 100)
    )

    assert await prune_expired_revisions(db_session) == 1
    assert await _editors(db_session, expired) == []
    assert await _editors(db_session, recent) == [db_superuser.id]
