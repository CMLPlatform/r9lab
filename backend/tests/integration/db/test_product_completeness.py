"""The completeness score and recommended rank that database triggers keep on each product."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import delete, select, text, update

from app.api.data_collection.models.product import Product
from app.api.file_storage.models import Image, MediaParentType

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.auth.models import User

pytestmark = pytest.mark.db

THIRTY_DAYS_S = 30 * 24 * 3600


async def _score(session: AsyncSession, product_id: int) -> tuple[float, float, float]:
    """Return (completeness, recommended_rank, created_at epoch) as the database holds them."""
    # The image trigger is deferred to commit, which the test transaction never reaches.
    await session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    row = (
        await session.execute(
            select(
                Product.completeness,
                Product.recommended_rank,
                text("extract(epoch FROM created_at)::float8"),
            ).where(Product.id == product_id)
        )
    ).one()
    return row[0], row[1], row[2]


def _image(parent_id: int) -> Image:
    return Image(
        filename="i.png", file="i.png", upload_size_bytes=1, parent_type=MediaParentType.PRODUCT, parent_id=parent_id
    )


async def test_base_product_scores_its_filled_fields(db_session: AsyncSession, db_superuser: User) -> None:
    """Brand, weight and dimensions are 3 of 8 points; text the app's trim() empties counts as empty."""
    product = Product(
        owner_id=db_superuser.id,
        name="Kettle",
        brand="acme",
        weight_g=500.0,
        depth_cm=4.0,
        description=" \n\t\u00a0\u3000\ufeff",
    )
    db_session.add(product)
    await db_session.flush()

    completeness, rank, created = await _score(db_session, product.id)

    assert completeness == pytest.approx(3 / 8)
    assert rank == pytest.approx(created + 3 / 8 * THIRTY_DAYS_S)


async def test_photo_counts_three_points_and_follows_inserts_and_deletes(
    db_session: AsyncSession, db_superuser: User
) -> None:
    """Adding a product image re-scores its product, and deleting it takes the points back."""
    product = Product(owner_id=db_superuser.id, name="Toaster", brand="acme")
    db_session.add(product)
    await db_session.flush()
    image = _image(product.id)
    db_session.add(image)
    await db_session.flush()

    assert (await _score(db_session, product.id))[0] == pytest.approx(4 / 8)

    await db_session.execute(delete(Image).where(Image.id == image.id))
    assert (await _score(db_session, product.id))[0] == pytest.approx(1 / 8)


async def test_editing_a_field_re_scores_the_product(db_session: AsyncSession, db_superuser: User) -> None:
    """An UPDATE of a scored column recomputes the score and the rank."""
    product = Product(owner_id=db_superuser.id, name="Fan")
    db_session.add(product)
    await db_session.flush()
    assert (await _score(db_session, product.id))[0] == 0

    product.description = "A desk fan"
    await db_session.flush()

    completeness, rank, created = await _score(db_session, product.id)
    assert completeness == pytest.approx(1 / 8)
    assert rank == pytest.approx(created + 1 / 8 * THIRTY_DAYS_S)


async def test_component_counts_only_weight_and_a_photo(db_session: AsyncSession, db_superuser: User) -> None:
    """A component with weight and a photo is complete, whatever else it lacks."""
    base = Product(owner_id=db_superuser.id, name="Lamp")
    db_session.add(base)
    await db_session.flush()
    component = Product(owner_id=db_superuser.id, name="Bulb", parent_id=base.id, amount_in_parent=1, weight_g=20.0)
    db_session.add(component)
    await db_session.flush()
    db_session.add(_image(component.id))
    await db_session.flush()

    assert (await _score(db_session, component.id))[0] == pytest.approx(1.0)


async def test_the_image_trigger_waits_for_commit(db_session: AsyncSession, db_superuser: User) -> None:
    """A new photo re-scores its product at commit, after the upload has locked the owner's row."""
    product = Product(owner_id=db_superuser.id, name="Kettle")
    db_session.add(product)
    await db_session.flush()
    db_session.add(_image(product.id))
    await db_session.flush()

    before_commit = await db_session.scalar(select(Product.completeness).where(Product.id == product.id))

    assert before_commit == 0
    assert (await _score(db_session, product.id))[0] == pytest.approx(3 / 8)


async def test_moving_a_photo_re_scores_both_products(db_session: AsyncSession, db_superuser: User) -> None:
    """An image moved to another product, or to another kind of parent, leaves its old product."""
    first, second = Product(owner_id=db_superuser.id, name="Kettle"), Product(owner_id=db_superuser.id, name="Iron")
    db_session.add_all([first, second])
    await db_session.flush()
    image = _image(first.id)
    db_session.add(image)
    await db_session.flush()

    await db_session.execute(update(Image).where(Image.id == image.id).values(parent_id=second.id))
    assert (await _score(db_session, first.id))[0] == 0
    assert (await _score(db_session, second.id))[0] == pytest.approx(3 / 8)

    await db_session.execute(update(Image).where(Image.id == image.id).values(parent_type=MediaParentType.MATERIAL))
    assert (await _score(db_session, second.id))[0] == 0


async def test_rank_is_creation_time_plus_thirty_days_per_unit_of_completeness(
    db_session: AsyncSession, db_superuser: User
) -> None:
    """Pinned to a fixed instant, so a wrong constant in the trigger cannot hide behind the same formula."""
    base = Product(owner_id=db_superuser.id, name="Lamp")
    db_session.add(base)
    await db_session.flush()
    component = Product(
        owner_id=db_superuser.id,
        name="Bulb",
        parent_id=base.id,
        amount_in_parent=1,
        weight_g=20.0,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    db_session.add(component)
    await db_session.flush()
    db_session.add(_image(component.id))
    await db_session.flush()

    # 2026-01-01T00:00Z is 1767225600; a complete record gains 2,592,000 s.
    assert (await _score(db_session, component.id))[1] == 1_769_817_600

    component.created_at = datetime(2026, 2, 1, tzinfo=UTC)
    await db_session.flush()
    assert (await _score(db_session, component.id))[1] == 1_769_817_600 + 31 * 24 * 3600


async def test_editing_an_unscored_column_leaves_the_rank_alone(db_session: AsyncSession, db_superuser: User) -> None:
    """The trigger only fires on the columns the score reads; a rename does not touch the rank."""
    product = Product(owner_id=db_superuser.id, name="Fan", brand="acme")
    db_session.add(product)
    await db_session.flush()
    rank_before = (await _score(db_session, product.id))[1]
    # recommended_rank is not a scored column, so this write does not fire the trigger:
    # only a re-score would restore the rank.
    await db_session.execute(update(Product).where(Product.id == product.id).values(recommended_rank=0))

    await db_session.execute(update(Product).where(Product.id == product.id).values(name="Desk fan"))
    assert (await _score(db_session, product.id))[1] == 0

    await db_session.execute(update(Product).where(Product.id == product.id).values(brand="acme2"))
    assert (await _score(db_session, product.id))[1] == pytest.approx(rank_before)
