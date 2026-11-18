"""Store each product's completeness score and its recommended-list rank key.

* ``product.completeness`` (0 to 1) is the weighted share of the app's missing-data
  checklist (``app/src/features/products/missingFields.ts``) a product has filled in. Base
  products count type, brand, weight, dimensions, a photo and a description; components
  count weight and a photo. A photo weighs 3, every other field 1. Text that is only
  whitespace counts as empty, with the Unicode spaces JavaScript's ``trim()`` strips.
* ``product.recommended_rank`` is ``created_at`` in epoch seconds plus 30 days per unit of
  completeness: a complete record ranks level with an empty one created 30 days later. It
  depends only on the row, so it is stored and indexed (next revision), and the list's
  default order reads an index instead of scoring every product per request.
* Postgres keeps both current, so every writer is covered, including camera uploads,
  imports and restores, with no call sites in the app:
  - ``product_set_rank`` (BEFORE INSERT or UPDATE of a scored column) recomputes the row.
  - ``image_touch_product`` re-scores the parent product when a product image is added,
    deleted or moved. It is a constraint trigger deferred to commit, so an upload takes the
    product row lock after its quota update has locked the owner's row. Every other
    writer that locks both rows takes the owner's first too (``lock_product_owner``); a
    writer that took the two in the other order would deadlock against an upload.
* The functions pin ``search_path`` so a same-named object in another schema on the
  caller's path cannot stand in for a built-in operator.
* The backfill re-scores every row in one UPDATE, which locks the product table's rows
  until commit. That is fine at the current table size; ``lock_timeout`` stops it queueing.

Revision ID: c4f1e8a2b7d3
Revises: 0b5e7c3a9d21
Create Date: 2026-11-17

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4f1e8a2b7d3"
down_revision: str | None = "0b5e7c3a9d21"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# downgrade() drops two columns that are derived from other columns and recomputed on
# upgrade, so rolling back loses nothing.
ROLLBACK_SAFE = True

_SCORED_COLUMNS = (
    "brand, description, weight_g, width_cm, height_cm, depth_cm, product_type_id, parent_id, created_at, completeness"
)

# The bracket class matches any character other than whitespace or the Unicode spaces
# JavaScript's trim() strips, so text counts as filled exactly when the app's check says so.
_COMPLETENESS_FUNCTION = r"""
CREATE FUNCTION public.r9lab_product_completeness(p public.product) RETURNS real
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    SELECT CASE WHEN p.parent_id IS NULL THEN (
            CASE WHEN p.product_type_id IS NOT NULL THEN 1 ELSE 0 END
          + CASE WHEN coalesce(p.brand, '')
                   ~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' THEN 1 ELSE 0 END
          + CASE WHEN coalesce(p.weight_g, 0) > 0 THEN 1 ELSE 0 END
          + CASE WHEN coalesce(p.width_cm, 0) > 0 OR coalesce(p.height_cm, 0) > 0
                   OR coalesce(p.depth_cm, 0) > 0 THEN 1 ELSE 0 END
          + CASE WHEN has_photo THEN 3 ELSE 0 END
          + CASE WHEN coalesce(p.description, '')
                   ~ '[^[:space:]\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]' THEN 1 ELSE 0 END
        ) / 8.0
    ELSE (
            CASE WHEN coalesce(p.weight_g, 0) > 0 THEN 1 ELSE 0 END
          + CASE WHEN has_photo THEN 3 ELSE 0 END
        ) / 4.0
    END
    FROM (
        SELECT EXISTS (
            SELECT 1 FROM public.image i WHERE i.parent_type = 'PRODUCT' AND i.parent_id = p.id
        ) AS has_photo
    ) photo
$$
"""

_SET_RANK_FUNCTION = """
CREATE FUNCTION public.r9lab_product_set_rank() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    NEW.completeness := public.r9lab_product_completeness(NEW);
    -- 2592000 s = 30 days: full completeness is worth a month of recency.
    NEW.recommended_rank := extract(epoch FROM coalesce(NEW.created_at, now())) + NEW.completeness * 2592000;
    RETURN NEW;
END
$$
"""

_TOUCH_PRODUCT_FUNCTION = """
CREATE FUNCTION public.r9lab_image_touch_product() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
    -- A no-op assignment to completeness is the re-score signal: product_set_rank owns the score.
    IF TG_OP <> 'DELETE' AND NEW.parent_type = 'PRODUCT' THEN
        UPDATE public.product SET completeness = completeness WHERE id = NEW.parent_id;
    END IF;
    IF TG_OP <> 'INSERT' AND OLD.parent_type = 'PRODUCT' THEN
        UPDATE public.product SET completeness = completeness WHERE id = OLD.parent_id;
    END IF;
    RETURN NULL;
END
$$
"""


def upgrade() -> None:
    """Add the columns, the functions and triggers that maintain them, and backfill."""
    op.add_column("product", sa.Column("completeness", sa.REAL(), server_default="0", nullable=False))
    op.add_column("product", sa.Column("recommended_rank", sa.Double(), server_default="0", nullable=False))
    op.execute(_COMPLETENESS_FUNCTION)
    op.execute(_SET_RANK_FUNCTION)
    op.execute(_TOUCH_PRODUCT_FUNCTION)
    op.execute(
        f"CREATE TRIGGER product_set_rank BEFORE INSERT OR UPDATE OF {_SCORED_COLUMNS} ON public.product "
        "FOR EACH ROW EXECUTE FUNCTION public.r9lab_product_set_rank()"
    )
    op.execute(
        "CREATE CONSTRAINT TRIGGER image_touch_product "
        "AFTER INSERT OR DELETE OR UPDATE OF parent_id, parent_type ON public.image "
        "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.r9lab_image_touch_product()"
    )
    op.execute("UPDATE public.product SET completeness = completeness")


def downgrade() -> None:
    """Drop the triggers, functions and columns."""
    op.execute("DROP TRIGGER image_touch_product ON public.image")
    op.execute("DROP TRIGGER product_set_rank ON public.product")
    op.execute("DROP FUNCTION public.r9lab_image_touch_product()")
    op.execute("DROP FUNCTION public.r9lab_product_set_rank()")
    op.execute("DROP FUNCTION public.r9lab_product_completeness(public.product)")
    op.drop_column("product", "recommended_rank")
    op.drop_column("product", "completeness")
