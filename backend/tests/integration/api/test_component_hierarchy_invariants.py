"""Integration tests for invariants that hold across a whole component tree."""

from typing import TYPE_CHECKING

import pytest
from fastapi import status
from sqlalchemy import func, select, update

from app.api.data_collection.crud.product_tree_queries import MAX_COMPONENT_DEPTH, component_depth
from app.api.data_collection.models.product import Product
from app.api.stats.queries import compute_totals
from tests.constants import IF_MATCH_FRESH

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.auth.models import User

pytestmark = pytest.mark.api


def _nested_payload(levels: int) -> dict[str, object]:
    """A base product with a chain of ``levels`` components below it, built in one request."""
    payload: dict[str, object] = {"name": f"Level {levels}", "amount_in_parent": 1}
    for level in range(levels - 1, 0, -1):
        payload = {"name": f"Level {level}", "amount_in_parent": 1, "components": [payload]}
    return {"name": "Nested root", "components": [payload]}


async def _product_count(db_session: AsyncSession) -> int:
    return (await db_session.execute(select(func.count(Product.id)))).scalar_one()


async def test_nested_create_gives_every_level_the_owner(
    api_client_user: AsyncClient, db_session: AsyncSession, db_user: User
) -> None:
    """A tree created in one payload stores the owner on every row, not only the root."""
    response = await api_client_user.post("/v1/products", json=_nested_payload(3))

    assert response.status_code == status.HTTP_201_CREATED, response.text
    rows = (await db_session.execute(select(Product.parent_id, Product.owner_id))).all()
    assert len(rows) == 4
    assert {owner_id for _, owner_id in rows} == {db_user.id}
    assert sum(parent_id is None for parent_id, _ in rows) == 1


async def test_nested_create_takes_a_tree_exactly_at_the_depth_limit(api_client_user: AsyncClient) -> None:
    """One payload may nest components as deep as the limit."""
    response = await api_client_user.post("/v1/products", json=_nested_payload(MAX_COMPONENT_DEPTH))

    assert response.status_code == status.HTTP_201_CREATED, response.text


async def test_nested_create_past_the_depth_limit_writes_nothing(
    api_client_user: AsyncClient, db_session: AsyncSession
) -> None:
    """One payload one level too deep is refused before any row is written."""
    before = await _product_count(db_session)

    response = await api_client_user.post("/v1/products", json=_nested_payload(MAX_COMPONENT_DEPTH + 1))

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert f"at most {MAX_COMPONENT_DEPTH} levels" in response.text
    assert await _product_count(db_session) == before


async def test_deleting_a_middle_component_removes_its_subtree_only(
    api_client_superuser: AsyncClient, db_session: AsyncSession, db_superuser: User
) -> None:
    """Deleting a component takes its own components with it and leaves the rest of the tree."""
    root = Product(owner_id=db_superuser.id, name="Root")
    middle = Product(owner_id=db_superuser.id, name="Middle", parent=root, amount_in_parent=1)
    sibling = Product(owner_id=db_superuser.id, name="Sibling", parent=root, amount_in_parent=1)
    leaf = Product(owner_id=db_superuser.id, name="Leaf", parent=middle, amount_in_parent=2)
    db_session.add_all([root, middle, sibling, leaf])
    await db_session.flush()
    ids = {"root": root.id, "middle": middle.id, "sibling": sibling.id, "leaf": leaf.id}

    response = await api_client_superuser.delete(f"/v1/components/{ids['middle']}")

    assert response.status_code == status.HTTP_204_NO_CONTENT
    db_session.expunge_all()
    left = set((await db_session.execute(select(Product.id).where(Product.id.in_(ids.values())))).scalars())
    assert left == {ids["root"], ids["sibling"]}


async def test_a_component_cannot_be_moved_to_another_parent(
    api_client_superuser: AsyncClient, db_session: AsyncSession, db_superuser: User
) -> None:
    """The update schema has no `parent_id`, so the API cannot re-parent a node into a cycle."""
    root = Product(owner_id=db_superuser.id, name="Root")
    parent = Product(owner_id=db_superuser.id, name="Parent", parent=root, amount_in_parent=1)
    child = Product(owner_id=db_superuser.id, name="Child", parent=parent, amount_in_parent=1)
    db_session.add_all([root, parent, child])
    await db_session.flush()

    response = await api_client_superuser.patch(
        f"/v1/components/{parent.id}", json={"parent_id": child.id}, headers=IF_MATCH_FRESH
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    await db_session.refresh(parent)
    assert parent.parent_id == root.id


async def test_depth_walk_stops_on_a_parent_cycle(
    api_client_superuser: AsyncClient, db_session: AsyncSession, db_superuser: User
) -> None:
    """A cycle written past the API (a bad import) ends the depth walk and refuses new components."""
    root = Product(owner_id=db_superuser.id, name="Root")
    first = Product(owner_id=db_superuser.id, name="First", parent=root, amount_in_parent=1)
    second = Product(owner_id=db_superuser.id, name="Second", parent=first, amount_in_parent=1)
    db_session.add_all([root, first, second])
    await db_session.flush()
    await db_session.execute(update(Product).where(Product.id == first.id).values(parent_id=second.id))

    depth = await component_depth(db_session, first.id)
    response = await api_client_superuser.post(
        f"/v1/components/{first.id}/components", json={"name": "Into the loop", "amount_in_parent": 1}
    )

    assert depth == MAX_COMPONENT_DEPTH + 1
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert f"at most {MAX_COMPONENT_DEPTH} levels" in response.text


async def test_site_totals_count_base_product_weight_only(db_session: AsyncSession, db_superuser: User) -> None:
    """A base product's weight already includes its components, so they do not add to the total."""
    root = Product(owner_id=db_superuser.id, name="Root", weight_g=1_000)
    component = Product(owner_id=db_superuser.id, name="Part", parent=root, amount_in_parent=2, weight_g=400)
    db_session.add_all([root, component])
    await db_session.flush()

    totals, _ = await compute_totals(db_session)

    assert (totals.teardowns, totals.parts, totals.mass_kg) == (1, 1, 1.0)
