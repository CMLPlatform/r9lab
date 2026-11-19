"""Integration tests for the personal data archive, ``GET /users/me/export``."""

import io
import json
import zipfile
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from fastapi import status

from app.api.application.account_export import MISSING_FILES_NAME
from app.api.data_collection.crud import product_tree_queries
from app.api.data_collection.models.product import Product, ProductRevision
from app.api.file_storage.crud.support_paths import stored_file_path
from app.api.file_storage.models import Image
from app.api.plugins.r9cam.models import Camera
from tests.constants import IF_MATCH_FRESH
from tests.fixtures.client import override_authenticated_user

if TYPE_CHECKING:
    from fastapi import FastAPI
    from httpx import AsyncClient, Response
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.auth.models import User

pytestmark = pytest.mark.api

# 1x1 pixel GIF
GIF_BYTES = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04"
    b"\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;"
)


async def _upload_image(api_client: AsyncClient, route: str) -> str:
    response = await api_client.post(route, files={"file": ("photo.gif", GIF_BYTES, "image/gif")})
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()["id"]


@pytest.fixture
async def own_tree(db_session: AsyncSession, db_user: User) -> tuple[Product, Product]:
    """A base product owned by ``db_user`` with one component."""
    product = Product(owner_id=db_user.id, name="My kettle")
    component = Product(owner_id=db_user.id, name="My heating element", parent=product, amount_in_parent=1)
    db_session.add_all([product, component])
    await db_session.flush()
    return product, component


async def _fresh_session_state(db_session: AsyncSession, user: User) -> None:
    """Drop what earlier requests cached in the shared test session; a real request starts fresh."""
    db_session.expire_all()
    await db_session.refresh(user)


async def _export(api_client: AsyncClient) -> tuple[Response, zipfile.ZipFile]:
    response = await api_client.get("/v1/users/me/export")
    assert response.status_code == status.HTTP_200_OK, response.text
    assert response.headers["content-type"] == "application/zip"
    assert "no-store" in response.headers["cache-control"]
    return response, zipfile.ZipFile(io.BytesIO(response.content))


async def test_export_holds_the_account_its_products_and_their_photos(
    api_client: AsyncClient,
    test_app: FastAPI,
    db_session: AsyncSession,
    db_user: User,
    db_superuser: User,
    own_tree: tuple[Product, Product],
) -> None:
    """The archive has the account, every own product with components, and their photos; nothing of others."""
    product_id, component_id = own_tree[0].id, own_tree[1].id
    db_session.add(Product(owner_id=db_superuser.id, name="Someone else's kettle"))
    db_session.add(
        Camera(
            owner_id=db_user.id,
            name="Bench camera",
            relay_public_key_jwk={"kty": "EC"},
            relay_key_id="key-1",
        )
    )
    db_session.add(
        Camera(
            owner_id=db_superuser.id,
            name="Not my camera",
            relay_public_key_jwk={"kty": "EC"},
            relay_key_id="key-2",
        )
    )
    await db_session.flush()
    with override_authenticated_user(test_app, db_user):
        product_image = await _upload_image(api_client, f"/v1/products/{product_id}/images")
        component_image = await _upload_image(api_client, f"/v1/components/{component_id}/images")
        await _fresh_session_state(db_session, db_user)

        response, archive = await _export(api_client)

    today = f"{datetime.now(UTC):%Y-%m-%d}"
    assert response.headers["content-disposition"] == (
        f'attachment; filename="r9lab-export-{db_user.username}-{today}.zip"'
    )
    names = set(archive.namelist())
    assert {"account.json", "products.json", "products.csv"} <= names
    assert f"images/{product_id}/{product_image}.gif" in names
    assert f"images/{component_id}/{component_image}.gif" in names
    assert MISSING_FILES_NAME not in names
    assert archive.read(f"images/{product_id}/{product_image}.gif") == GIF_BYTES

    account = json.loads(archive.read("account.json"))
    assert account["id"] == str(db_user.id)
    assert account["email"] == db_user.email
    assert [camera["name"] for camera in account["cameras"]] == ["Bench camera"]
    # No secrets: no password hash, MFA material, camera keys or OAuth tokens.
    raw_account = archive.read("account.json").decode()
    for secret_field in ("hashed_password", "mfa_totp_secret", "mfa_recovery_codes", "relay_", "access_token"):
        assert secret_field not in raw_account

    [exported] = json.loads(archive.read("products.json"))
    assert exported["id"] == product_id
    assert [child["id"] for child in exported["components"]] == [component_id]
    csv_text = archive.read("products.csv").decode("utf-8-sig")
    assert "My heating element" in csv_text
    assert "Someone else" not in csv_text
    assert "Someone else" not in archive.read("products.json").decode()


async def test_export_stores_photos_uncompressed_and_lists_unreadable_files(
    api_client: AsyncClient,
    test_app: FastAPI,
    db_session: AsyncSession,
    db_user: User,
    own_tree: tuple[Product, Product],
) -> None:
    """Photos are stored as-is, data files deflated; a file gone from storage is listed, not fatal."""
    product_id = own_tree[0].id
    with override_authenticated_user(test_app, db_user):
        kept = await _upload_image(api_client, f"/v1/products/{product_id}/images")
        lost = await _upload_image(api_client, f"/v1/products/{product_id}/images")
        await _fresh_session_state(db_session, db_user)
        lost_path = stored_file_path(await db_session.get_one(Image, lost))
        assert lost_path is not None
        lost_path.unlink()

        _, archive = await _export(api_client)

    assert archive.getinfo(f"images/{product_id}/{kept}.gif").compress_type == zipfile.ZIP_STORED
    assert archive.getinfo("products.json").compress_type == zipfile.ZIP_DEFLATED
    assert f"images/{product_id}/{lost}.gif" not in archive.namelist()
    assert archive.read(MISSING_FILES_NAME).decode().splitlines() == [f"images/{product_id}/{lost}.gif"]
    assert archive.testzip() is None


async def test_export_requires_sign_in(api_client: AsyncClient) -> None:
    """Without a session there is no archive."""
    response = await api_client.get("/v1/users/me/export")

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


async def test_export_is_not_held_to_the_product_export_caps(
    api_client: AsyncClient,
    test_app: FastAPI,
    db_user: User,
    own_tree: tuple[Product, Product],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The upload quota bounds the archive, so the /products/export component cap does not apply."""
    monkeypatch.setattr(product_tree_queries, "EXPORT_MAX_COMPONENTS", 0)
    with override_authenticated_user(test_app, db_user):
        _, archive = await _export(api_client)

    [exported] = json.loads(archive.read("products.json"))
    assert [child["id"] for child in exported["components"]] == [own_tree[1].id]


async def test_export_holds_the_edit_history_without_other_editors(
    api_client: AsyncClient,
    test_app: FastAPI,
    db_session: AsyncSession,
    db_user: User,
    db_superuser: User,
    own_tree: tuple[Product, Product],
) -> None:
    """Edits of own products come with their values, own edits elsewhere without; no other editor is named."""
    product_id = own_tree[0].id
    others_product = Product(owner_id=db_superuser.id, name="Someone else's kettle")
    db_session.add(others_product)
    await db_session.flush()
    others_id, moderator_id, moderator_name = others_product.id, str(db_superuser.id), str(db_superuser.username)
    db_session.add_all(
        [
            # A moderator's correction of the user's product, and the user's edit of another's.
            ProductRevision(
                product_id=product_id,
                editor_id=db_superuser.id,
                version=1,
                changed_fields=["description"],
                snapshot={"description": "moderated"},
            ),
            ProductRevision(
                product_id=others_id,
                editor_id=db_user.id,
                version=1,
                changed_fields=["name"],
                snapshot={"name": "Someone else's kettle"},
            ),
        ]
    )
    await db_session.flush()
    with override_authenticated_user(test_app, db_user):
        edit = await api_client.patch(
            f"/v1/products/{product_id}", json={"name": "Renamed kettle"}, headers=IF_MATCH_FRESH
        )
        assert edit.status_code == status.HTTP_200_OK, edit.text
        await _fresh_session_state(db_session, db_user)

        _, archive = await _export(api_client)

    raw = archive.read("revisions.json").decode()
    by_product_and_editor = {(r["product_id"], r["edited_by_you"]): r for r in json.loads(raw)}
    own_edit = by_product_and_editor[product_id, True]
    assert own_edit["changed_fields"] == ["name"]
    assert own_edit["snapshot"]["name"] == "Renamed kettle"
    assert by_product_and_editor[product_id, False]["snapshot"] == {"description": "moderated"}
    elsewhere = by_product_and_editor[others_id, True]
    assert elsewhere["changed_fields"] == ["name"]
    assert elsewhere["snapshot"] is None
    assert len(by_product_and_editor) == 3
    assert moderator_id not in raw
    assert moderator_name not in raw
