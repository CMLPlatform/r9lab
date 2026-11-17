"""Integration tests for public profile statistics."""

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth.models import User
from app.api.data_collection.crud.profile_stats import compute_profile_stats
from app.api.data_collection.models.product import Product
from app.api.reference_data.models import ProductType

if TYPE_CHECKING:
    from httpx import AsyncClient


async def create_root_with_component(db_session: AsyncSession, user: User) -> None:
    """Create one base product and one component with separate weights."""
    product_type = ProductType(name="Profile Stats Tool", description="Profile stats test product type")
    root = Product(
        owner_id=user.id,
        name="Root product",
        product_type=product_type,
        weight_g=35_000,
    )
    component = Product(
        owner_id=user.id,
        name="Child component",
        product_type=product_type,
        parent=root,
        amount_in_parent=1,
        weight_g=37_000,
    )
    db_session.add_all([product_type, root, component])
    await db_session.flush()


async def test_compute_profile_stats_counts_base_product_weight_only(
    db_session: AsyncSession,
    db_superuser: User,
) -> None:
    """Profile weight should not count component rows on top of the base product."""
    await create_root_with_component(db_session, db_superuser)

    stats = await compute_profile_stats(db_session, db_superuser.id)

    assert stats.product_count == 1
    assert stats.total_weight_g == 35_000


async def test_public_profile_counts_on_read(
    db_session: AsyncSession,
    api_client: AsyncClient,
    db_superuser: User,
) -> None:
    """The profile returns stats counted from the owner's products."""
    await create_root_with_component(db_session, db_superuser)

    response = await api_client.get(f"/v1/profiles/{db_superuser.username}")

    assert response.status_code == 200
    assert response.json()["total_weight_kg"] == 35.0


async def test_public_profile_does_not_resolve_uuid_identifiers(
    api_client: AsyncClient,
    db_superuser: User,
) -> None:
    """Profile URLs are username-only; UUID-looking identifiers are not user IDs."""
    response = await api_client.get(f"/v1/profiles/{db_superuser.id}")

    assert response.status_code == 404


async def test_public_profile_does_not_resolve_users_without_username(
    api_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Incomplete users are not addressable by public profile URL."""
    user = User(
        email="incomplete-profile@example.com",
        hashed_password="hashed",
        username=None,
        is_active=True,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()

    response = await api_client.get("/v1/profiles/incomplete-profile")

    assert response.status_code == 404


async def test_public_profile_shows_the_label_of_a_cpv_top_category(
    db_session: AsyncSession,
    api_client: AsyncClient,
    db_superuser: User,
) -> None:
    """A top category stored as a CPV code reads back as the type's label."""
    db_session.add(
        Product(owner_id=db_superuser.id, name="Pan", product_type=ProductType(name="CPV: 14622", description="Steel"))
    )
    await db_session.flush()

    response = await api_client.get(f"/v1/profiles/{db_superuser.username}")
    assert response.status_code == 200
    assert response.json()["top_category"] == "Steel"


async def test_public_profile_counts_products_written_outside_the_product_routes(
    db_session: AsyncSession,
    api_client_superuser: AsyncClient,
    db_superuser: User,
) -> None:
    """A product added by any writer (an import, a restore) shows on the profile at once."""
    created = await api_client_superuser.post("/v1/products", json={"name": "Kettle", "weight_g": 35_000})
    assert created.status_code == 201

    db_session.add(Product(owner_id=db_superuser.id, name="Imported kettle", weight_g=1_000))
    await db_session.flush()

    response = await api_client_superuser.get(f"/v1/profiles/{db_superuser.username}")
    assert response.json()["product_count"] == 2
    assert response.json()["total_weight_kg"] == 36.0


async def test_public_profile_follows_a_renamed_top_category(
    db_session: AsyncSession,
    api_client_superuser: AsyncClient,
    db_superuser: User,
) -> None:
    """Renaming a product type changes the top category every owner's profile shows."""
    product_type = ProductType(name="Profile Stats Tool")
    db_session.add(product_type)
    await db_session.flush()
    created = await api_client_superuser.post(
        "/v1/products", json={"name": "Kettle", "product_type_id": product_type.id}
    )
    assert created.status_code == 201

    product_type.name = "Hand Tool"
    await db_session.flush()

    response = await api_client_superuser.get(f"/v1/profiles/{db_superuser.username}")
    assert response.json()["top_category"] == "Hand Tool"
