"""Shared fixtures for the benchmark suite (no database, no network)."""

import io
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from PIL import Image as PILImage
from PIL.ExifTags import IFD

if TYPE_CHECKING:
    from typing import Any

_TIMESTAMP = datetime(2025, 1, 1, tzinfo=UTC)


def make_jpeg_with_exif(width: int, height: int, *, orientation: int = 6) -> bytes:
    """Encode a JPEG carrying both preserved and identifying EXIF tags plus a rotation."""
    img = PILImage.linear_gradient("L").resize((width, height)).convert("RGB")
    exif = img.getexif()
    exif[0x010F] = "Test Camera"  # Make (preserved)
    exif[0x0110] = "Model X"  # Model (preserved)
    exif[0x0131] = "SecretSoftware"  # Software (dropped)
    exif[0x0112] = orientation
    sub_ifd = exif.get_ifd(IFD.Exif)
    sub_ifd[0x920A] = 35.0  # FocalLength (preserved)
    sub_ifd[0x8827] = 400  # ISOSpeedRatings (preserved)
    sub_ifd[0xA431] = "SERIAL123"  # BodySerialNumber (dropped)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", exif=exif, quality=90)
    return buffer.getvalue()


@pytest.fixture(scope="session")
def jpeg_with_exif() -> bytes:
    """A 1280x960 JPEG with EXIF metadata and a 90 degree rotation tag."""
    return make_jpeg_with_exif(1280, 960)


def _component_create(depth: int, breadth: int, prefix: str) -> dict[str, Any]:
    node: dict[str, Any] = {
        "name": f"Component {prefix}",
        "description": "Sub-assembly removed with basic hand tools.",
        "brand": "Brand",
        "model": f"Model {prefix}",
        "amount_in_parent": 2,
        "weight_g": 120.5,
        "height_cm": 10,
        "width_cm": 5,
        "depth_cm": 3,
        "bill_of_materials": [
            {"quantity": 0.3, "unit": "g", "material_id": 1},
            {"quantity": 0.1, "unit": "g", "material_id": 2},
        ],
        "components": [],
    }
    if depth > 0:
        node["components"] = [_component_create(depth - 1, breadth, f"{prefix}.{i}") for i in range(breadth)]
    return node


@pytest.fixture(scope="session")
def product_create_payload() -> dict[str, Any]:
    """A product create payload with a 3-level component tree (4 x 4 x 4 components)."""
    return {
        "name": "Office Chair",
        "description": "Complete chair assembly",
        "brand": "Brand 1",
        "model": "Model 1",
        "product_type_id": 1,
        "weight_g": 20000,
        "height_cm": 150,
        "width_cm": 70,
        "depth_cm": 50,
        "circularity_properties": {
            "recyclability": "Metal frame and plastic shell can be separated with basic tools.",
            "disassemblability": "Most fasteners are visible and non-destructive to remove.",
        },
        "videos": [{"url": "https://www.youtube.com/watch?v=123456789", "description": "Disassembly video"}],
        "bill_of_materials": [{"quantity": 0.3, "unit": "g", "material_id": 1}],
        "components": [_component_create(2, 4, str(i)) for i in range(4)],
    }


def _image(parent_id: int, index: int) -> dict[str, Any]:
    return {
        "id": uuid.UUID(int=parent_id * 100 + index, version=4),
        "filename": f"image_{parent_id}_{index}.jpg",
        "parent_id": parent_id,
        "parent_type": "product",
        "image_url": f"/uploads/images/{parent_id}/{index}.jpg",
        "thumbnail_url": f"/uploads/images/{parent_id}/{index}_thumb_200.webp",
        "created_at": _TIMESTAMP,
        "updated_at": _TIMESTAMP,
    }


def _export_node(node_id: list[int], depth: int, breadth: int, parent_id: int | None) -> dict[str, Any]:
    node_id[0] += 1
    current = node_id[0]
    node: dict[str, Any] = {
        "id": current,
        "name": f"=Product {current}" if current % 5 == 0 else f"Product {current}",
        "description": 'Sub-assembly, removed with a screwdriver; contains "glue".',
        "brand": "Brand",
        "model": f"Model {current}",
        "product_type_id": 1,
        "product_type": {"id": 1, "name": "Chair", "created_at": _TIMESTAMP, "updated_at": _TIMESTAMP},
        "weight_g": 120.5,
        "height_cm": 10,
        "width_cm": 5,
        "depth_cm": 3,
        "circularity_properties": {"recyclability": "Separable", "remanufacturability": "Standard screws"},
        "owner_username": "repairer",
        "created_at": _TIMESTAMP,
        "updated_at": _TIMESTAMP,
        "images": [_image(current, i) for i in range(2)],
    }
    if parent_id is not None:
        node["parent_id"] = parent_id
        node["amount_in_parent"] = 2
    node["components"] = (
        [_export_node(node_id, depth - 1, breadth, current) for _ in range(breadth)] if depth > 0 else []
    )
    return node


@pytest.fixture(scope="session")
def product_export_payloads() -> list[dict[str, Any]]:
    """Ten product export trees, each with 3 levels of 3 components (40 nodes per tree)."""
    counter = [0]
    return [_export_node(counter, 3, 3, None) for _ in range(10)]
