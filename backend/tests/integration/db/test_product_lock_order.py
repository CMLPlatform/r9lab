"""Product writers lock the owner's row before the product's, so concurrent writers cannot deadlock.

These tests commit for real on separate connections: the image trigger that re-scores a
product is deferred to commit, which the usual rolled-back test transaction never reaches.
"""

import asyncio
from typing import TYPE_CHECKING
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.application.account_erasure import ANONYMOUS_USER_EMAIL, erase_user
from app.api.auth.models import User
from app.api.data_collection.crud.product_commands import delete_product, update_product
from app.api.data_collection.exceptions import ProductVersionMismatchError
from app.api.data_collection.models.product import Product, ProductRevision
from app.api.data_collection.schemas import ProductUpdate
from app.api.file_storage.models import Image, MediaParentType
from app.api.file_storage.upload_quota import reserve_product_upload_quota
from scripts.seed.factories.models import UserFactory

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.db

STEP_TIMEOUT_S = 30


def _image(product_id: int) -> Image:
    return Image(
        filename="i.png", file="i.png", upload_size_bytes=1, parent_type=MediaParentType.PRODUCT, parent_id=product_id
    )


@pytest.fixture
async def committed_product(_setup_test_database: None, async_engine: AsyncEngine) -> AsyncGenerator[tuple[User, int]]:
    """A user's product with one photo, committed, and removed again afterwards."""
    async with AsyncSession(async_engine, expire_on_commit=False) as session:
        owner = await UserFactory.create_async(session=session)
        product = Product(owner_id=owner.id, name="Lock order kettle")
        session.add(product)
        await session.flush()
        session.add(_image(product.id))
        await session.commit()
        product_id = product.id
    yield owner, product_id
    async with AsyncSession(async_engine) as session:
        await session.execute(
            delete(Image).where(Image.parent_type == MediaParentType.PRODUCT, Image.parent_id == product_id)
        )
        await session.execute(delete(Product).where(Product.id == product_id))
        await session.execute(delete(User).where(User.id == owner.id))
        # The erasure test hands the product to the system account, created on first use.
        await session.execute(
            delete(User).where(
                User.email == ANONYMOUS_USER_EMAIL, ~select(Product.id).where(Product.owner_id == User.id).exists()
            )
        )
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
    pytest.fail("the product delete never waited on a lock")


async def test_upload_racing_a_product_delete_does_not_deadlock(
    async_engine: AsyncEngine, committed_product: tuple[User, int]
) -> None:
    """An upload holds the owner's quota row and re-scores the product at commit; the delete waits its turn."""
    _owner, product_id = committed_product
    async with AsyncSession(async_engine) as upload, AsyncSession(async_engine) as deleter:
        await reserve_product_upload_quota(upload, parent_id=product_id, upload_size_bytes=1)
        upload.add(_image(product_id))
        await upload.flush()

        deleting = asyncio.create_task(delete_product(deleter, product_id))
        await _wait_until_a_writer_waits_on_a_lock(async_engine)
        await asyncio.wait_for(upload.commit(), STEP_TIMEOUT_S)
        await asyncio.wait_for(deleting, STEP_TIMEOUT_S)

    async with AsyncSession(async_engine) as session:
        assert await session.scalar(select(func.count()).where(Product.id == product_id)) == 0
        assert (
            await session.scalar(
                select(func.count()).where(Image.parent_type == MediaParentType.PRODUCT, Image.parent_id == product_id)
            )
            == 0
        )


async def _revision_versions(engine: AsyncEngine, product_id: int) -> list[int]:
    async with AsyncSession(engine) as session:
        rows = await session.execute(select(ProductRevision.version).where(ProductRevision.product_id == product_id))
        return sorted(rows.scalars().all())


async def test_concurrent_updates_of_one_version_record_one_revision(
    async_engine: AsyncEngine, committed_product: tuple[User, int]
) -> None:
    """Two saves made from the same read: one lands as version 2, the other is refused."""
    owner, product_id = committed_product
    async with AsyncSession(async_engine) as first, AsyncSession(async_engine) as second:
        results = await asyncio.wait_for(
            asyncio.gather(
                update_product(
                    first, product_id, ProductUpdate(name="First save"), if_match_version=1, user_id=owner.id
                ),
                update_product(
                    second, product_id, ProductUpdate(name="Second save"), if_match_version=1, user_id=owner.id
                ),
                return_exceptions=True,
            ),
            STEP_TIMEOUT_S,
        )

    assert sorted(type(result).__name__ for result in results) == ["Product", ProductVersionMismatchError.__name__]
    assert await _revision_versions(async_engine, product_id) == [2]


async def test_owner_erasure_racing_their_update_does_not_deadlock(
    async_engine: AsyncEngine, committed_product: tuple[User, int]
) -> None:
    """The erasure holds the owner's row and then rewrites the product; the update waits behind both.

    Taking the product row before the owner's, as the revision's editor foreign key would,
    deadlocks against the erasure. The edit then fails on that foreign key instead, since its
    editor is gone, and the erasure completes.
    """
    owner, product_id = committed_product
    async with AsyncSession(async_engine) as eraser, AsyncSession(async_engine) as editor:
        await eraser.execute(select(User.id).where(User.id == owner.id).with_for_update())
        editing = asyncio.create_task(
            update_product(editor, product_id, ProductUpdate(name="Late edit"), if_match_version=1, user_id=owner.id)
        )
        await _wait_until_a_writer_waits_on_a_lock(async_engine)
        erased_owner = await eraser.get_one(User, owner.id)
        with patch("app.api.application.account_erasure.audit_event"):
            await asyncio.wait_for(erase_user(eraser, erased_owner, actor_id=uuid4()), STEP_TIMEOUT_S)
        (edit_result,) = await asyncio.wait_for(asyncio.gather(editing, return_exceptions=True), STEP_TIMEOUT_S)

    assert isinstance(edit_result, IntegrityError), edit_result
    assert "deadlock" not in str(edit_result)
    async with AsyncSession(async_engine) as session:
        anonymous_id = await session.scalar(select(User.id).where(User.email == ANONYMOUS_USER_EMAIL))
        assert await session.scalar(select(Product.owner_id).where(Product.id == product_id)) == anonymous_id
    assert await _revision_versions(async_engine, product_id) == []
