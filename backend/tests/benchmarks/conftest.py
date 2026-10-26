"""Shared inputs for the benchmark suite: built once per session, with no database or network.

Every input is deterministic, so CodSpeed's instruction counts change only when the code does.
"""

import io
import random
import uuid
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from PIL import Image as PILImage
from PIL.ExifTags import IFD

from app.api.auth.models import User
from app.api.common.models.enums import Unit
from app.api.data_collection.crud.product_tree_queries import COMPONENT_TREE_MAX_COMPONENTS
from app.api.data_collection.models.product import MaterialProductLink, Product
from app.api.reference_data.models import Material, ProductType

if TYPE_CHECKING:
    from typing import Any

_TIMESTAMP = datetime(2025, 1, 1, tzinfo=UTC)

# A 12 MP phone photo, the most common upload. At this size thumbnail generation takes
# the JPEG draft path (decoding at half scale for the 1600 px width).
PHOTO_SIZE = (4032, 3024)


def make_phone_jpeg(width: int, height: int) -> bytes:
    """Encode a JPEG shaped like a phone upload: camera EXIF, GPS, a serial number and a rotation.

    A smooth gradient compresses to a fraction of a real photo and decodes much faster, so
    seeded noise is blended in to bring the file to a photo's size (about 4 MB at 12 MP).
    """
    base = PILImage.effect_mandelbrot((width // 8, height // 8), (-2.0, -1.2, 1.0, 1.2), 100).resize(
        (width, height), PILImage.Resampling.BICUBIC
    )
    noise = PILImage.frombytes("L", (width, height), random.Random(0).randbytes(width * height))  # noqa: S311 -- seeded on purpose, not a secret
    img = PILImage.merge(
        "RGB", (base, PILImage.blend(base, noise, 0.2), PILImage.linear_gradient("L").resize((width, height)))
    )
    exif = img.getexif()
    exif[0x010F] = "Test Camera"  # Make (kept)
    exif[0x0110] = "Model X"  # Model (kept)
    exif[0x0131] = "Firmware 1.0"  # Software (dropped)
    exif[0x0112] = 6  # Orientation: rotate 90 degrees, so the rotation is baked in
    sub_ifd = exif.get_ifd(IFD.Exif)
    sub_ifd[0x920A] = 4.2  # FocalLength (kept)
    sub_ifd[0x8827] = 400  # ISOSpeedRatings (kept)
    sub_ifd[0xA431] = "SERIAL123"  # BodySerialNumber (dropped)
    gps = exif.get_ifd(IFD.GPSInfo)
    gps[1] = "N"  # GPSLatitudeRef (dropped with the whole GPS block)
    gps[2] = (52.0, 9.0, 36.0)  # GPSLatitude
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", exif=exif, quality=90)
    return buffer.getvalue()


@pytest.fixture(scope="session")
def phone_jpeg() -> bytes:
    """A 12 MP JPEG with identifying EXIF and a 90 degree rotation tag."""
    return make_phone_jpeg(*PHOTO_SIZE)


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
    """A product create request body with 84 components over 3 levels (4 x 4 x 4 + 4 x 4 + 4)."""
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


@dataclass(frozen=True, slots=True)
class ProductTree:
    """A base product and its components as unsaved ORM rows, shaped like the tree loaders' output."""

    root: Product
    children_by_parent_id: dict[int, list[Product]]

    @property
    def size(self) -> int:
        """Number of components below the base product, every level counted."""
        return sum(len(children) for children in self.children_by_parent_id.values())


def _owner(index: int, visibility: str) -> User:
    return User(
        id=uuid.UUID(int=index, version=4),
        email=f"owner{index}@example.org",
        username=f"owner{index}",
        hashed_password="not-a-hash",
        preferences={"profile_visibility": visibility},
    )


@pytest.fixture(scope="session")
def product_tree() -> ProductTree:
    """A base product with as many components as one tree read returns (1,000), eight levels deep.

    Four top-level components, each with two children, filled breadth first until the cap.
    Rows alternate between a public and a private owner, so owner redaction runs on half of
    them. They carry no images: image URLs are derived from a stat of the stored file, which
    is I/O and outside what an instruction count can say anything about.
    """
    owners = (_owner(1, "public"), _owner(2, "private"))
    product_type = ProductType(id=1, name="Office chair", description="Swivel chair with armrests")
    materials = (
        Material(id=1, name="Steel", density_kg_m3=7850.0, is_crm=False),
        Material(id=2, name="Polypropylene", density_kg_m3=905.0, is_crm=False),
    )
    next_id = iter(range(1, COMPONENT_TREE_MAX_COMPONENTS + 2))

    def row(parent_id: int | None) -> Product:
        product_id = next(next_id)
        owner = owners[product_id % 2]
        return Product(
            id=product_id,
            name=f"=Part {product_id}" if product_id % 7 == 0 else f"Part {product_id}",
            description='Removed with a T10 screwdriver; held by "glue" at two points.',
            brand="brand",
            model=f"Model {product_id}",
            product_type_id=product_type.id,
            product_type=product_type,
            weight_g=120.5,
            height_cm=10.0,
            width_cm=5.0,
            depth_cm=3.0,
            circularity_properties={"recyclability": "Separable", "remanufacturability": "Standard screws"},
            owner_id=owner.id,
            owner=owner,
            parent_id=parent_id,
            amount_in_parent=None if parent_id is None else 2,
            version=1,
            created_at=_TIMESTAMP,
            updated_at=_TIMESTAMP,
            bill_of_materials=[
                MaterialProductLink(
                    material_id=material.id,
                    material=material,
                    product_id=product_id,
                    quantity=0.25,
                    unit=Unit.KILOGRAM,
                    created_at=_TIMESTAMP,
                    updated_at=_TIMESTAMP,
                )
                for material in materials
            ],
        )

    root = row(None)
    children_by_parent_id: dict[int, list[Product]] = {}
    queue = deque([root])
    made = 0
    while queue and made < COMPONENT_TREE_MAX_COMPONENTS:
        parent = queue.popleft()
        for _ in range(4 if parent is root else 2):
            if made == COMPONENT_TREE_MAX_COMPONENTS:
                break
            child = row(parent.id)
            children_by_parent_id.setdefault(parent.id, []).append(child)
            queue.append(child)
            made += 1
    return ProductTree(root=root, children_by_parent_id=children_by_parent_id)
