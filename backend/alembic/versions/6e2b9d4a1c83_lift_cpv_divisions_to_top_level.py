"""lift CPV divisions to the top level of their taxonomy

The CPV seed once hung divisions 31-38 under division 30. A division is a category whose
external_id is two digits and six zeros, and none has a parent.

Revision ID: 6e2b9d4a1c83
Revises: d7fb0e59e51f
Create Date: 2026-11-19

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6e2b9d4a1c83"
down_revision: str | None = "d7fb0e59e51f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The UPDATE only clears wrong parent links, and the previous release renders a top-level
# division as it renders any root, so a code-only rollback needs nothing.
ROLLBACK_SAFE = True


def upgrade() -> None:
    """Clear the parent of every division that sits under another division.

    Idempotent: a second run matches no row. Subcategories keep their parents, and product
    type links point at categories by id, so none of them moves.
    """
    op.execute(
        r"""
        UPDATE category AS c SET supercategory_id = NULL
        FROM category AS p
        WHERE c.supercategory_id = p.id
          AND c.external_id ~ '^[0-9]{2}0{6}$'
          AND p.external_id ~ '^[0-9]{2}0{6}$'
          AND c.taxonomy_id = p.taxonomy_id
          -- Only the CPV taxonomy: another one may nest codes of this shape on purpose.
          AND c.taxonomy_id IN (
              SELECT id FROM taxonomy WHERE name = 'Common Procurement Vocabulary (CPV)'
          )
        """
    )


def downgrade() -> None:
    """One-way: which divisions had the wrong parent is not recorded, and the old links were a seed bug."""
