"""The personal data archive: an account, its products and their uploads as one ZIP.

Data portability (GDPR article 20) for the signed-in user. The archive holds:

- ``account.json``: profile, preferences, linked sign-in providers (names and account ids,
  never tokens), contributor-terms acceptance and camera registrations (never keys).
- ``products.json`` and ``products.csv``: every base product the user owns with its whole
  component tree, built by the same code as ``/products/export`` but without its caps; the
  user's upload quota bounds the archive instead.
- ``images/<product id>/<image id><ext>`` and ``files/<product id>/<file id><ext>``: the
  stored uploads, uncompressed, since photos are compressed already.
- ``missing-files.txt``: uploads the active storage could not read (any remote backend,
  or a file gone from disk), so one lost file does not fail the whole download.

The ZIP is written to the response as it is built, with no temporary file.
"""

import logging
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from pydantic import TypeAdapter
from sqlalchemy import select

from app.api.auth.schemas import UserRead
from app.api.data_collection.crud.product_tree_queries import (
    PRODUCT_EXPORT_RELATIONSHIPS,
    apply_product_detail_loaders,
    load_all_descendants,
)
from app.api.data_collection.models.product import Product
from app.api.data_collection.presentation.product_export import build_product_exports, render_products_csv
from app.api.data_collection.schemas import ProductExportRead
from app.api.file_storage.crud.support_paths import stored_file_path
from app.api.plugins.r9cam.models import Camera

if TYPE_CHECKING:
    from collections.abc import Iterable, Iterator

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.auth.models import User
    from app.api.file_storage.models import File, Image

logger = logging.getLogger(__name__)

MISSING_FILES_NAME = "missing-files.txt"
_CHUNK_SIZE = 256 * 1024


@dataclass(frozen=True, slots=True)
class ArchiveUpload:
    """One stored upload to copy into the archive; ``path`` is None when storage has no local copy."""

    arcname: str
    path: Path | None


@dataclass(frozen=True, slots=True)
class AccountArchive:
    """Everything the archive holds, loaded before the response starts streaming."""

    data_files: dict[str, bytes]
    uploads: list[ArchiveUpload]


def archive_filename(user: User, today: datetime | None = None) -> str:
    """Return the download name, ``r9lab-export-<username>-<YYYY-MM-DD>.zip``."""
    # Usernames are limited to [a-z0-9_], so the name is safe in a Content-Disposition header.
    return f"r9lab-export-{user.username or 'account'}-{(today or datetime.now(UTC)):%Y-%m-%d}.zip"


def _account_record(user: User, cameras: Iterable[Camera]) -> dict[str, Any]:
    # UserRead is what GET /users/me returns: no password hash, MFA secret or OAuth tokens.
    return UserRead.model_validate(user).model_dump(mode="json") | {
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "cameras": [
            {
                "id": str(camera.id),
                "name": camera.name,
                "description": camera.description,
                "created_at": camera.created_at.isoformat() if camera.created_at else None,
            }
            for camera in cameras
        ],
    }


def _upload(folder: str, product_id: int, item: File | Image) -> ArchiveUpload:
    path = stored_file_path(item)
    suffix = path.suffix.lower() if path else Path(item.filename).suffix.lower()
    return ArchiveUpload(arcname=f"{folder}/{product_id}/{item.id}{suffix}", path=path)


async def load_account_archive(session: AsyncSession, user: User) -> AccountArchive:
    """Load the user's account record, product trees and upload paths."""
    statement = apply_product_detail_loaders(
        select(Product).where(Product.owner_id == user.id, Product.parent_id.is_(None)).order_by(Product.id),
        PRODUCT_EXPORT_RELATIONSHIPS,
    )
    roots = list((await session.execute(statement)).scalars().unique().all())
    children_by_parent_id = await load_all_descendants(session, [root.id for root in roots], capped=False)
    products = build_product_exports(roots, children_by_parent_id, user)
    cameras = (
        (await session.execute(select(Camera).where(Camera.owner_id == user.id).order_by(Camera.created_at)))
        .scalars()
        .all()
    )

    uploads: list[ArchiveUpload] = []
    for node in [*roots, *(child for children in children_by_parent_id.values() for child in children)]:
        uploads.extend(_upload("images", node.id, image) for image in node.images or [])
        uploads.extend(_upload("files", node.id, file) for file in node.files or [])

    data_files = {
        "account.json": TypeAdapter(dict[str, Any]).dump_json(_account_record(user, cameras), indent=2),
        "products.json": TypeAdapter(list[ProductExportRead]).dump_json(products, indent=2),
        "products.csv": render_products_csv(products).encode(),
    }
    return AccountArchive(data_files=data_files, uploads=uploads)


class _ChunkSink:
    """Write-only target for ``zipfile``: collects bytes until the stream drains them.

    It has no ``tell`` or ``seek``, so ``zipfile`` writes each entry's sizes after its data
    (a data descriptor) instead of seeking back, which is what lets the archive stream.
    """

    def __init__(self) -> None:
        self._chunks: list[bytes] = []

    def write(self, data: bytes) -> int:
        self._chunks.append(bytes(data))
        return len(data)

    def flush(self) -> None:
        """Nothing is buffered below this object."""

    def close(self) -> None:
        """Nothing to release: the chunks are handed out by ``drain``."""

    def drain(self) -> bytes:
        data = b"".join(self._chunks)
        self._chunks.clear()
        return data


def stream_account_archive(archive: AccountArchive) -> Iterator[bytes]:
    """Yield the ZIP archive in chunks, reading each upload from disk as it goes.

    A blocking generator: Starlette runs it in a worker thread, so the file reads do not
    hold up the event loop.
    """
    sink = _ChunkSink()
    missing: list[str] = []
    with zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, payload in archive.data_files.items():
            zf.writestr(name, payload)
            yield sink.drain()
        for upload in archive.uploads:
            if upload.path is None:
                missing.append(upload.arcname)
                continue
            try:
                # from_file records the size, so entries over 4 GiB get ZIP64 headers.
                info = zipfile.ZipInfo.from_file(upload.path, upload.arcname)
                source = upload.path.open("rb")
            except OSError:
                missing.append(upload.arcname)
                continue
            info.compress_type = zipfile.ZIP_STORED
            try:
                with source, zf.open(info, "w") as target:
                    while chunk := source.read(_CHUNK_SIZE):
                        target.write(chunk)
                        yield sink.drain()
            except OSError:
                # Part of the entry is already sent, so it cannot move to missing-files.txt.
                # Re-raising aborts the response, so the browser marks the download failed
                # rather than saving an archive that looks complete.
                logger.exception("Account archive stopped: could not read %s", upload.arcname)
                raise
        if missing:
            zf.writestr(MISSING_FILES_NAME, "".join(f"{name}\n" for name in missing))
    yield sink.drain()
