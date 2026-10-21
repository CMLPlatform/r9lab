"""Benchmarks for product tree validation, serialization and CSV export."""

from typing import TYPE_CHECKING, Any

import pytest

from app.api.data_collection.presentation.product_export import render_products_csv
from app.api.data_collection.schemas import ProductCreateWithComponents, ProductExportRead
from app.core.pseudonyms import keyed_digest

if TYPE_CHECKING:
    from pytest_codspeed import BenchmarkFixture


@pytest.mark.benchmark
def test_validate_product_create_tree(benchmark: BenchmarkFixture, product_create_payload: dict[str, Any]) -> None:
    """Validate a nested product create request (84 components across 3 levels)."""
    product = benchmark(ProductCreateWithComponents.model_validate, product_create_payload)
    assert len(product.components) == 4


@pytest.mark.benchmark
def test_validate_product_export_trees(
    benchmark: BenchmarkFixture, product_export_payloads: list[dict[str, Any]]
) -> None:
    """Validate product export read models, including image URLs and thumbnails."""

    def run() -> list[ProductExportRead]:
        return [ProductExportRead.model_validate(payload) for payload in product_export_payloads]

    exports = benchmark(run)
    assert len(exports) == len(product_export_payloads)


@pytest.mark.benchmark
def test_dump_product_export_json(benchmark: BenchmarkFixture, product_export_payloads: list[dict[str, Any]]) -> None:
    """Serialize product export trees to JSON, as the export endpoint does."""
    exports = [ProductExportRead.model_validate(payload) for payload in product_export_payloads]

    def run() -> list[str]:
        return [export.model_dump_json() for export in exports]

    assert all(benchmark(run))


@pytest.mark.benchmark
def test_render_products_csv(benchmark: BenchmarkFixture, product_export_payloads: list[dict[str, Any]]) -> None:
    """Flatten product export trees into the CSV download."""
    exports = [ProductExportRead.model_validate(payload) for payload in product_export_payloads]

    csv_text = benchmark(render_products_csv, exports)
    # One header line plus one row per product or component.
    assert csv_text.count("\r\n") == 1 + 40 * len(exports)


@pytest.mark.benchmark
def test_keyed_digest(benchmark: BenchmarkFixture) -> None:
    """Pseudonymise a batch of emails, as rate limiting and logging do per request."""
    emails = [f"User.{i}@Example.org " for i in range(500)]

    def run() -> list[str]:
        return [keyed_digest("rate-limit", email, length=16) for email in emails]

    assert len(set(benchmark(run))) == len(emails)
