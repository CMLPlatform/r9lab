"""Benchmarks for the image upload pipeline, which runs on every image upload before the response."""

import io
from typing import TYPE_CHECKING

import pytest
from PIL import Image as PILImage

from app.core.images import THUMBNAIL_WIDTHS, generate_thumbnails, process_image_for_storage
from tests.benchmarks.conftest import PHOTO_SIZE

if TYPE_CHECKING:
    from pathlib import Path

    from pytest_codspeed import BenchmarkFixture


@pytest.mark.benchmark
def test_process_image_for_storage(benchmark: BenchmarkFixture, phone_jpeg: bytes) -> None:
    """Strip identifying metadata from a phone photo and bake in its rotation."""

    # The upload is rewritten in place, so each round gets a fresh copy, made outside the measurement.
    def fresh_upload() -> tuple[tuple[io.BytesIO], dict[str, object]]:
        return (io.BytesIO(phone_jpeg),), {}

    width, height = benchmark.pedantic(process_image_for_storage, setup=fresh_upload)
    assert (height, width) == PHOTO_SIZE


@pytest.mark.benchmark
def test_generate_thumbnails(benchmark: BenchmarkFixture, phone_jpeg: bytes, tmp_path: Path) -> None:
    """Write every thumbnail width for a stored phone photo."""
    image_path = tmp_path / "original.jpg"
    image_path.write_bytes(phone_jpeg)

    paths = benchmark(generate_thumbnails, image_path)

    widths = []
    for path in paths:
        with PILImage.open(path) as thumbnail:
            widths.append(thumbnail.width)
    assert sorted(widths) == sorted(THUMBNAIL_WIDTHS)
