"""Reads and retention of the product edit history (``ProductRevision``)."""

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload

from app.api.auth.services.privacy import should_redact_owner_identity
from app.api.common.crud.pagination import paginate_select
from app.api.data_collection.models.product import ProductRevision
from app.api.data_collection.schemas import ProductRevisionRead

if TYPE_CHECKING:
    from fastapi_pagination.links import Page
    from sqlalchemy import CursorResult
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.auth.models import User
    from app.api.data_collection.models.product import Product

# Revisions keep text an owner later removed, so they are not kept for ever.
REVISION_RETENTION = timedelta(days=2 * 365)


def _editor_username(revision: ProductRevision, product: Product, viewer: User | None) -> str | None:
    """Return the editor's name as this viewer may see it.

    An owner's edit follows the product's own owner redaction; a moderator's edit names
    the moderator to admins only.
    """
    editor = revision.editor
    if editor is None:
        return None
    if revision.editor_id != product.owner_id:
        return editor.username if viewer is not None and viewer.has_admin_access else None
    if product.owner is not None and should_redact_owner_identity(product.owner, viewer):
        return None
    return editor.username


def _may_see_snapshot(product: Product, viewer: User | None) -> bool:
    return viewer is not None and (viewer.id == product.owner_id or viewer.has_admin_access)


def to_revision_read(revision: ProductRevision, product: Product, viewer: User | None) -> ProductRevisionRead:
    """Build the read model of one revision of ``product``, with viewer-aware attribution."""
    return ProductRevisionRead(
        id=revision.id,
        version=revision.version,
        created_at=revision.created_at,
        changed_fields=revision.changed_fields,
        snapshot=revision.snapshot if _may_see_snapshot(product, viewer) else None,
        # An erased editor's id is NULL; only a non-owner's edit survives that (see the model).
        by_moderator=revision.editor_id != product.owner_id,
        editor_username=_editor_username(revision, product, viewer),
    )


async def page_product_revisions(
    session: AsyncSession, product: Product, viewer: User | None
) -> Page[ProductRevisionRead]:
    """Page ``product``'s revisions, newest first."""
    statement = (
        select(ProductRevision)
        .where(ProductRevision.product_id == product.id)
        .options(selectinload(ProductRevision.editor))
        # id breaks ties within one transaction, where now() does not move.
        .order_by(ProductRevision.created_at.desc(), ProductRevision.id.desc())
    )
    page = await paginate_select(
        session,
        statement,
        model=ProductRevision,
        transform=lambda rows: [to_revision_read(row, product, viewer) for row in rows],
    )
    return cast("Page[ProductRevisionRead]", page)


async def prune_expired_revisions(session: AsyncSession) -> int:
    """Delete revisions older than ``REVISION_RETENTION`` and commit; return how many went."""
    # NOTE: a sequential scan of the table, run hourly; add an index on created_at
    # if the table grows into the millions of rows.
    result = cast(
        "CursorResult[Any]",
        await session.execute(
            delete(ProductRevision).where(ProductRevision.created_at < datetime.now(UTC) - REVISION_RETENTION)
        ),
    )
    await session.commit()
    return result.rowcount
