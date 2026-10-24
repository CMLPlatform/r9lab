"""Benchmarks for the image upload pipeline: metadata stripping, rotation and thumbnails."""

import io
from typing import TYPE_CHECKING

import pytest
from PIL import Image as PILImage

from app.core.images import filter_exif, generate_thumbnails, process_image_for_storage

if TYPE_CHECKING:
    from pathlib import Path

    from pytest_codspeed import BenchmarkFixture


@pytest.mark.benchmark
def test_process_image_for_storage(benchmark: BenchmarkFixture, jpeg_with_exif: bytes) -> None:
    """Strip identifying EXIF and bake in the rotation of an uploaded JPEG."""

    def run() -> tuple[int, int]:
        return process_image_for_storage(io.BytesIO(jpeg_with_exif))

    assert benchmark(run) == (960, 1280)


@pytest.mark.benchmark
def test_filter_exif(benchmark: BenchmarkFixture, jpeg_with_exif: bytes) -> None:
    """Build the allowlisted EXIF block from an image's tags."""
    with PILImage.open(io.BytesIO(jpeg_with_exif)) as img:
        filtered = benchmark(filter_exif, img)
    assert 0x0131 not in filtered


@pytest.mark.benchmark
def test_generate_thumbnails(benchmark: BenchmarkFixture, jpeg_with_exif: bytes, tmp_path: Path) -> None:
    """Decode a stored JPEG once and write every standard WebP thumbnail width."""
    image_path = tmp_path / "original.jpg"
    image_path.write_bytes(jpeg_with_exif)

    paths = benchmark(generate_thumbnails, image_path)
    assert paths
