"""Benchmarks for product tree requests: create validation, the component tree read, and the export.

Each runs the same functions as its route, from the point the rows are loaded, so the
database round trips stay out and the per-row Python work is what gets counted.
"""

from typing import TYPE_CHECKING, Any

import pytest
from pydantic import TypeAdapter

from app.api.data_collection.presentation.product_export import build_product_exports, render_products_csv
from app.api.data_collection.presentation.product_reads import render_component_tree
from app.api.data_collection.schemas import ProductCreateWithComponents, ProductExportRead

if TYPE_CHECKING:
    from pytest_codspeed import BenchmarkFixture

    from tests.benchmarks.conftest import ProductTree

# The deepest tree the route serves: recursion_depth=10 renders nine levels below the roots.
MAX_TREE_RENDER_DEPTH = 9


@pytest.mark.benchmark
def test_validate_product_create_tree(benchmark: BenchmarkFixture, product_create_payload: dict[str, Any]) -> None:
    """Validate a nested product create request (84 components over 3 levels)."""
    product = benchmark(ProductCreateWithComponents.model_validate, product_create_payload)
    assert len(product.components) == 4


@pytest.mark.benchmark
def test_render_component_tree(benchmark: BenchmarkFixture, product_tree: ProductTree) -> None:
    """Render the component tree read at its 1,000-component cap, as an anonymous viewer."""
    roots = product_tree.children_by_parent_id[product_tree.root.id]

    tree = benchmark(
        render_component_tree,
        roots,
        children_by_parent_id=product_tree.children_by_parent_id,
        max_depth=MAX_TREE_RENDER_DEPTH,
        viewer=None,
        visited=frozenset({product_tree.root.id}),
    )

    # Owner attribution alternates per row; the private owner's rows are redacted.
    assert {tree[0].owner_username, tree[1].owner_username} == {"owner1", None}


@pytest.mark.benchmark
def test_build_product_exports(benchmark: BenchmarkFixture, product_tree: ProductTree) -> None:
    """Build the export read models for one product and its 1,000 components."""
    exports = benchmark(build_product_exports, [product_tree.root], product_tree.children_by_parent_id, None)
    assert len(exports[0].components) == 4


@pytest.mark.benchmark
def test_dump_product_exports_json(benchmark: BenchmarkFixture, product_tree: ProductTree) -> None:
    """Serialize the export to JSON the way the export route does."""
    exports = build_product_exports([product_tree.root], product_tree.children_by_parent_id, None)

    def dump() -> bytes:
        return TypeAdapter(list[ProductExportRead]).dump_json(exports)

    assert benchmark(dump).count(b'"amount_in_parent":2') == product_tree.size


@pytest.mark.benchmark
def test_render_products_csv(benchmark: BenchmarkFixture, product_tree: ProductTree) -> None:
    """Flatten the export into the CSV download, one row per product or component."""
    exports = build_product_exports([product_tree.root], product_tree.children_by_parent_id, None)

    csv_text = benchmark(render_products_csv, exports)

    # The header plus the base product plus every component.
    assert csv_text.count("\r\n") == 2 + product_tree.size
