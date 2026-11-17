"""Index the recommended-list order of base products.

The list's default order is ``recommended_rank DESC`` with the primary key as the
pagination tie-breaker, over base products only, so this partial index serves a page
as an index scan that stops after the page instead of sorting every product.

Alone in its revision: CONCURRENTLY cannot run inside a transaction, and an autocommit
block commits whatever ran before it. A VALID index of this name is adopted, so a process
that died between the build and the revision stamp re-runs cleanly. A failed build leaves
an INVALID index, which a re-run does not adopt; drop it and re-run:
  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
  DROP INDEX CONCURRENTLY ix_product_recommended_rank;

Revision ID: d8b3a6f0e1c5
Revises: c4f1e8a2b7d3
Create Date: 2026-11-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d8b3a6f0e1c5"
down_revision: str | None = "c4f1e8a2b7d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The only dynamic SQL reads pg_index; downgrade() drops an index, so rolling back loses nothing.
ROLLBACK_SAFE = True

_INDEX = "ix_product_recommended_rank"


def upgrade() -> None:
    """Build the partial index without blocking writes, or adopt a finished one."""
    existing = (
        op.get_bind()
        .execute(sa.text("SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass(:name)"), {"name": _INDEX})
        .scalar()
    )
    if existing is True:
        return
    with op.get_context().autocommit_block():
        op.create_index(
            _INDEX,
            "product",
            [sa.text("recommended_rank DESC"), "id"],
            postgresql_where=sa.text("parent_id IS NULL"),
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    """Drop the index, including an INVALID one a failed build left behind."""
    with op.get_context().autocommit_block():
        op.drop_index(_INDEX, table_name="product", postgresql_concurrently=True, if_exists=True)
