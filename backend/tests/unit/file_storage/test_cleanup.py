"""Unit tests for the file cleanup logic."""

import os
import time
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock, MagicMock, patch

from app.api.file_storage.services.cleanup import (
    cleanup_unreferenced_files,
    cleanup_unreferenced_objects,
    get_files_on_disk,
    get_referenced_files,
    get_unreferenced_files,
)
from app.core.config.core import settings
from app.core.config.models import StorageBackend

if TYPE_CHECKING:
    import pytest

# ---------------------------------------------------------------------------
# get_referenced_files
# ---------------------------------------------------------------------------


async def test_get_referenced_files_empty() -> None:
    """Returns empty set when no files or images exist in DB."""
    session = AsyncMock()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    session.execute.return_value = mock_result

    result = await get_referenced_files(session)

    assert result == set()


async def test_get_referenced_files_with_paths(tmp_path: Path) -> None:
    """Returns resolved paths for all files and images with a path attribute."""
    session = AsyncMock()

    fake_file = MagicMock()
    fake_file.file.path = str(tmp_path / "upload.txt")
    fake_image = MagicMock()
    fake_image.file.path = str(tmp_path / "image.jpg")

    mock_files_scalars = MagicMock()
    mock_files_scalars.all.return_value = [fake_file]
    mock_files_result = MagicMock()
    mock_files_result.scalars.return_value = mock_files_scalars
    mock_images_scalars = MagicMock()
    mock_images_scalars.all.return_value = [fake_image]
    mock_images_result = MagicMock()
    mock_images_result.scalars.return_value = mock_images_scalars
    session.execute.side_effect = [mock_files_result, mock_images_result]

    result = await get_referenced_files(session)

    assert (tmp_path / "upload.txt").resolve() in result
    assert (tmp_path / "image.jpg").resolve() in result


async def test_get_referenced_files_skips_none_entries() -> None:
    """None entries (no file attached) are silently skipped."""
    session = AsyncMock()
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = [None]
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    session.execute.return_value = mock_result

    result = await get_referenced_files(session)

    assert result == set()


# ---------------------------------------------------------------------------
# get_files_on_disk
# ---------------------------------------------------------------------------


async def test_get_files_on_disk_returns_old_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Files old enough to exceed the grace period are included."""
    file_storage = tmp_path / "files"
    image_storage = tmp_path / "images"
    file_storage.mkdir()
    image_storage.mkdir()

    old_file = file_storage / "old.txt"
    old_file.write_text("old")
    old_mtime = time.time() - 7200  # 2 hours ago
    os.utime(old_file, (old_mtime, old_mtime))

    monkeypatch.setattr(settings, "file_storage_path", file_storage)
    monkeypatch.setattr(settings, "image_storage_path", image_storage)
    monkeypatch.setattr(settings, "file_cleanup_min_file_age_minutes", 30)

    result = await get_files_on_disk()

    assert old_file.resolve() in result


async def test_get_files_on_disk_excludes_recent_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Files newer than the grace period are excluded (Time-of-Check to Time-of-Use protection)."""
    file_storage = tmp_path / "files"
    image_storage = tmp_path / "images"
    file_storage.mkdir()
    image_storage.mkdir()

    new_file = file_storage / "new.txt"
    new_file.write_text("new")
    # mtime defaults to now; well within any grace period

    monkeypatch.setattr(settings, "file_storage_path", file_storage)
    monkeypatch.setattr(settings, "image_storage_path", image_storage)
    monkeypatch.setattr(settings, "file_cleanup_min_file_age_minutes", 30)

    result = await get_files_on_disk()

    assert new_file.resolve() not in result


async def test_get_files_on_disk_missing_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-existent storage directories are silently skipped."""
    monkeypatch.setattr(settings, "file_storage_path", tmp_path / "does_not_exist")
    monkeypatch.setattr(settings, "image_storage_path", tmp_path / "also_missing")

    result = await get_files_on_disk()

    assert result == set()


# ---------------------------------------------------------------------------
# get_unreferenced_files / cleanup_unreferenced_files (mocked helpers)
# ---------------------------------------------------------------------------

_REF_PATH = Path("/uploads/files/referenced.txt").resolve()
_UNREF_PATH = Path("/uploads/files/unreferenced.txt").resolve()
_REF_IMAGE_PATH = Path("/uploads/images/referenced.jpg").resolve()
_REF_IMAGE_THUMB_PATH = Path("/uploads/images/referenced_thumb_200.webp").resolve()


async def test_get_unreferenced_files_returns_delta() -> None:
    """get_unreferenced_files returns disk files that are not referenced in DB."""
    session = MagicMock()

    with (
        patch("app.api.file_storage.services.cleanup.get_referenced_files", new=AsyncMock(return_value={_REF_PATH})),
        patch(
            "app.api.file_storage.services.cleanup.get_files_on_disk",
            new=AsyncMock(return_value={_REF_PATH, _UNREF_PATH}),
        ),
    ):
        result = await get_unreferenced_files(session)

    assert result == [_UNREF_PATH]


async def test_get_unreferenced_files_preserves_generated_thumbnails() -> None:
    """Derived thumbnails for referenced images are not treated as unreferenced."""
    session = MagicMock()

    with (
        patch(
            "app.api.file_storage.services.cleanup.get_referenced_files",
            new=AsyncMock(return_value={_REF_IMAGE_PATH, _REF_IMAGE_THUMB_PATH}),
        ),
        patch(
            "app.api.file_storage.services.cleanup.get_files_on_disk",
            new=AsyncMock(return_value={_REF_IMAGE_PATH, _REF_IMAGE_THUMB_PATH}),
        ),
    ):
        result = await get_unreferenced_files(session)

    assert result == []


async def test_cleanup_dry_run_does_not_delete(tmp_path: Path) -> None:
    """dry_run=True logs but does not delete anything."""
    target = tmp_path / "stale.txt"
    target.write_text("stale")
    session = MagicMock()

    with patch(
        "app.api.file_storage.services.cleanup.get_unreferenced_files",
        new=AsyncMock(return_value=[target]),
    ):
        deleted = await cleanup_unreferenced_files(session, dry_run=True)

    assert deleted == [target]
    assert target.exists(), "dry_run must not delete the file"


async def test_cleanup_force_deletes_files(tmp_path: Path) -> None:
    """dry_run=False deletes each unreferenced file."""
    target = tmp_path / "stale.txt"
    target.write_text("stale")
    session = MagicMock()

    with patch(
        "app.api.file_storage.services.cleanup.get_unreferenced_files",
        new=AsyncMock(return_value=[target]),
    ):
        deleted = await cleanup_unreferenced_files(session, dry_run=False)

    assert deleted == [target]
    assert not target.exists(), "file should have been deleted"


async def test_cleanup_continues_after_delete_error(tmp_path: Path) -> None:
    """A failed deletion is logged and does not abort remaining files."""
    good = tmp_path / "good.txt"
    good.write_text("good")
    missing = tmp_path / "missing.txt"  # does not exist; unlink will raise OSError
    session = MagicMock()

    with patch(
        "app.api.file_storage.services.cleanup.get_unreferenced_files",
        new=AsyncMock(return_value=[missing, good]),
    ):
        deleted = await cleanup_unreferenced_files(session, dry_run=False)

    assert missing in deleted
    assert good in deleted
    assert not good.exists(), "the successful deletion should still happen"


# ---------------------------------------------------------------------------
# the S3 sweep
# ---------------------------------------------------------------------------


class _FakeObjectStorage:
    def __init__(self, names: list[str]) -> None:
        self.names = names
        self.deleted: list[str] = []

    async def list_names(self, *, min_age_seconds: float) -> list[str]:
        assert min_age_seconds == settings.file_cleanup_min_file_age_minutes * 60
        return self.names

    def get_path(self, name: str) -> str:
        return f"s3://bucket/{name}"

    async def delete(self, name: str) -> None:
        self.deleted.append(name)


def _session_referencing(file_names: list[str], image_names: list[str]) -> MagicMock:
    def result(names: list[str]) -> MagicMock:
        rows = [SimpleNamespace(file=SimpleNamespace(name=name)) for name in names]
        return MagicMock(scalars=MagicMock(return_value=rows))

    session = MagicMock()
    session.execute = AsyncMock(side_effect=[result(file_names), result(image_names)])
    return session


async def _sweep(*, dry_run: bool, monkeypatch: pytest.MonkeyPatch) -> tuple[list[str], _FakeObjectStorage]:
    storage = _FakeObjectStorage(["kept.pdf", "kept.jpg", "orphan.jpg"])
    monkeypatch.setattr(settings, "storage_backend", StorageBackend.S3)
    with (
        patch("app.api.file_storage.services.cleanup._get_file_storage", return_value=storage),
        patch("app.api.file_storage.services.cleanup._get_image_storage", return_value=storage),
    ):
        deleted = await cleanup_unreferenced_objects(_session_referencing(["kept.pdf"], ["kept.jpg"]), dry_run=dry_run)
    return deleted, storage


async def test_s3_cleanup_deletes_only_unreferenced_objects(monkeypatch: pytest.MonkeyPatch) -> None:
    """An object no File or Image row names is deleted; referenced ones stay."""
    deleted, storage = await _sweep(dry_run=False, monkeypatch=monkeypatch)

    assert deleted == ["orphan.jpg"]
    assert storage.deleted == ["orphan.jpg"]


async def test_s3_cleanup_dry_run_does_not_delete(monkeypatch: pytest.MonkeyPatch) -> None:
    """dry_run reports the orphan but leaves it in the bucket."""
    deleted, storage = await _sweep(dry_run=True, monkeypatch=monkeypatch)

    assert deleted == ["orphan.jpg"]
    assert storage.deleted == []


async def test_s3_cleanup_is_a_no_op_on_the_filesystem_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    """The local sweep covers the filesystem backend; no query or listing happens here."""
    monkeypatch.setattr(settings, "storage_backend", StorageBackend.FILESYSTEM)
    session = MagicMock()

    assert await cleanup_unreferenced_objects(session, dry_run=False) == []
    session.execute.assert_not_called()


async def test_s3_cleanup_stops_when_most_of_the_bucket_looks_unreferenced(monkeypatch: pytest.MonkeyPatch) -> None:
    """A database that names few of the bucket's objects is the wrong one; nothing is deleted."""
    storage = _FakeObjectStorage([f"object-{i}.jpg" for i in range(20)])
    monkeypatch.setattr(settings, "storage_backend", StorageBackend.S3)
    with (
        patch("app.api.file_storage.services.cleanup._get_file_storage", return_value=storage),
        patch("app.api.file_storage.services.cleanup._get_image_storage", return_value=storage),
    ):
        deleted = await cleanup_unreferenced_objects(_session_referencing(["object-0.jpg"], []), dry_run=False)

    assert deleted == []
    assert storage.deleted == []
