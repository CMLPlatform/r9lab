"""add the product edit history table

One row per changing update of a product's own fields, written in the update's
transaction. The table is new and empty, so its foreign keys and indexes are built
without scanning anything; env.py's lock_timeout bounds the brief locks the foreign keys
take on ``product`` and ``user``.

Revision ID: d7fb0e59e51f
Revises: d8b3a6f0e1c5
Create Date: 2026-11-19

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d7fb0e59e51f"
down_revision: str | None = "d8b3a6f0e1c5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_REFUSE_WHILE_HISTORY_EXISTS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM product_revision) THEN
        RAISE EXCEPTION 'product_revision holds edit history that this downgrade would delete. '
            'Roll back the code only, or restore the pre-release backup.';
    END IF;
END
$$
"""


def upgrade() -> None:
    """Create ``product_revision`` and its indexes."""
    op.create_table(
        "product_revision",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("editor_id", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("changed_fields", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["editor_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["product_id"], ["product.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_product_revision_product_id_created_at",
        "product_revision",
        ["product_id", sa.text("created_at DESC")],
        unique=False,
    )
    op.create_index("ix_product_revision_editor_id", "product_revision", ["editor_id"], unique=False)


def downgrade() -> None:
    """Drop the table, refusing while it holds history: a rollback would destroy it."""
    # In SQL, not Python, so a script rendered with --sql carries the check too.
    op.execute(_REFUSE_WHILE_HISTORY_EXISTS)
    op.drop_table("product_revision")
