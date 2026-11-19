"""Product edit history: revisions written by updates and the history read routes."""

from typing import TYPE_CHECKING

import pytest
from fastapi import status
from sqlalchemy import select

from app.api.data_collection.crud.product_commands import update_product
from app.api.data_collection.models.product import Product, ProductRevision
from app.api.data_collection.schemas import ProductUpdate
from scripts.seed.factories.models import UserFactory
from tests.constants import IF_MATCH_FRESH, UPDATED_PRODUCT_NAME
from tests.fixtures.client import override_authenticated_user

if TYPE_CHECKING:
    from fastapi import FastAPI
    from httpx import AsyncClient
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.auth.models import User
    from tests.fixtures.data import ProductGraph

pytestmark = pytest.mark.api


async def _revisions(session: AsyncSession, product_id: int) -> list[ProductRevision]:
    rows = await session.execute(
        select(ProductRevision).where(ProductRevision.product_id == product_id).order_by(ProductRevision.id)
    )
    return list(rows.scalars().all())


async def test_a_changing_update_records_a_revision(
    api_client_superuser: AsyncClient, db_session: AsyncSession, db_superuser: User, setup_product: Product
) -> None:
    """The revision names the editor, the new version, the changed fields, and the row it left."""
    response = await api_client_superuser.patch(
        f"/v1/products/{setup_product.id}",
        json={"name": UPDATED_PRODUCT_NAME, "description": None, "weight_g": 250.0},
        headers=IF_MATCH_FRESH,
    )

    assert response.status_code == status.HTTP_200_OK
    (revision,) = await _revisions(db_session, setup_product.id)
    assert revision.editor_id == db_superuser.id
    assert revision.version == 2
    assert revision.changed_fields == ["name", "weight_g"]
    assert revision.snapshot["name"] == UPDATED_PRODUCT_NAME
    assert revision.snapshot["weight_g"] == 250.0
    assert revision.snapshot["brand"] == setup_product.brand


async def test_an_update_that_changes_nothing_records_no_revision(
    api_client_superuser: AsyncClient, db_session: AsyncSession, setup_product: Product
) -> None:
    """A no-op save (a retry of one that landed) leaves the history alone."""
    response = await api_client_superuser.patch(
        f"/v1/products/{setup_product.id}", json={"name": setup_product.name}, headers=IF_MATCH_FRESH
    )

    assert response.status_code == status.HTTP_200_OK
    assert await _revisions(db_session, setup_product.id) == []


async def test_product_history_lists_edits_newest_first(
    api_client_light: AsyncClient, db_session: AsyncSession, db_superuser: User, setup_product: Product
) -> None:
    """Two edits come back newest first, paged, to an anonymous reader of a public product."""
    await update_product(
        db_session, setup_product.id, ProductUpdate(name="First edit"), if_match_version=1, user_id=db_superuser.id
    )
    await update_product(
        db_session, setup_product.id, ProductUpdate(weight_g=12.5), if_match_version=2, user_id=db_superuser.id
    )

    response = await api_client_light.get(f"/v1/products/{setup_product.id}/revisions")

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["total"] == 2
    assert [item["version"] for item in body["items"]] == [3, 2]
    assert [item["changed_fields"] for item in body["items"]] == [["weight_g"], ["name"]]
    assert body["items"][0]["editor_username"] == db_superuser.username
    assert body["items"][0]["by_moderator"] is False


async def test_component_history_has_its_own_route(
    api_client_light: AsyncClient, db_session: AsyncSession, db_superuser: User, setup_product_graph: ProductGraph
) -> None:
    """Components read their history under /components; each route refuses the other kind of id."""
    component = setup_product_graph.component
    await update_product(
        db_session, component.id, ProductUpdate(amount_in_parent=3), if_match_version=1, user_id=db_superuser.id
    )

    response = await api_client_light.get(f"/v1/components/{component.id}/revisions")
    wrong_kind = await api_client_light.get(f"/v1/products/{component.id}/revisions")
    wrong_kind_back = await api_client_light.get(f"/v1/components/{setup_product_graph.product.id}/revisions")

    assert response.status_code == status.HTTP_200_OK
    assert [item["changed_fields"] for item in response.json()["items"]] == [["amount_in_parent"]]
    assert wrong_kind.status_code == status.HTTP_404_NOT_FOUND
    assert wrong_kind_back.status_code == status.HTTP_404_NOT_FOUND


async def test_history_of_a_missing_product_is_a_404(api_client_light: AsyncClient) -> None:
    """An unknown id is a 404, as the product read is."""
    response = await api_client_light.get("/v1/products/999999/revisions")

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.fixture
async def private_owner_product(db_session: AsyncSession) -> Product:
    """A product whose owner keeps a private profile, edited once by that owner."""
    owner = await UserFactory.create_async(
        session=db_session, is_active=True, username="history_owner", preferences={"profile_visibility": "private"}
    )
    product = Product(owner_id=owner.id, name="Private kettle")
    db_session.add(product)
    await db_session.flush()
    await update_product(
        db_session, product.id, ProductUpdate(name="Private kettle v2"), if_match_version=1, user_id=owner.id
    )
    return product


async def test_owner_attribution_follows_profile_visibility(
    api_client_light: AsyncClient, test_app: FastAPI, private_owner_product: Product
) -> None:
    """A private owner's edits are unattributed to others and named to the owner."""
    url = f"/v1/products/{private_owner_product.id}/revisions"
    anonymous = (await api_client_light.get(url)).json()["items"][0]
    assert private_owner_product.owner is not None
    with override_authenticated_user(test_app, private_owner_product.owner):
        own = (await api_client_light.get(url)).json()["items"][0]

    assert anonymous["editor_username"] is None
    assert anonymous["by_moderator"] is False
    assert own["editor_username"] == "history_owner"


async def test_moderator_identity_is_shown_to_admins_only(
    api_client_light: AsyncClient,
    test_app: FastAPI,
    db_session: AsyncSession,
    db_superuser: User,
    db_user: User,
) -> None:
    """A moderator's correction is marked as one; only an admin sees who made it."""
    product = Product(owner_id=db_user.id, name="Moderated kettle")
    db_session.add(product)
    await db_session.flush()
    await update_product(
        db_session, product.id, ProductUpdate(name="Corrected kettle"), if_match_version=1, user_id=db_superuser.id
    )
    url = f"/v1/products/{product.id}/revisions"

    with override_authenticated_user(test_app, db_user):
        as_owner = (await api_client_light.get(url)).json()["items"][0]
    with override_authenticated_user(test_app, db_superuser):
        as_admin = (await api_client_light.get(url)).json()["items"][0]

    assert as_owner["by_moderator"] is True
    assert as_owner["editor_username"] is None
    assert as_admin["by_moderator"] is True
    assert as_admin["editor_username"] == db_superuser.username
