"""Unit tests for the account archive stream and route."""

import logging
from pathlib import Path
from typing import TYPE_CHECKING
from unittest.mock import MagicMock

import pytest

from app.api.application import account_export
from app.api.application.account_export import AccountArchive, ArchiveUpload, stream_account_archive
from app.api.application.routers import account_export as account_export_router

if TYPE_CHECKING:
    from typing import Any, Self


async def test_route_closes_the_session_before_streaming(mock_session: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    """The session is released before the body streams, so no connection idles for a whole download."""

    async def load(*_: object) -> AccountArchive:
        return AccountArchive(data_files={"account.json": b"{}"}, uploads=[])

    monkeypatch.setattr(account_export_router, "load_account_archive", load)
    user = MagicMock(username="ada")

    response = await account_export_router.export_own_account(user, mock_session)

    mock_session.close.assert_awaited_once()
    assert response.headers["content-disposition"].startswith('attachment; filename="r9lab-export-ada-')


class _FailingRead:
    """A file that opens fine and then fails on the second read, like a disk error mid-copy."""

    def __init__(self) -> None:
        self._reads = 0

    def read(self, _size: int) -> bytes:
        self._reads += 1
        if self._reads > 1:
            msg = "I/O error"
            raise OSError(msg)
        return b"x" * 10

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        return None


def test_a_read_error_mid_copy_is_logged_with_the_file_and_stops_the_stream(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A file failing part-way is logged by name and aborts the stream instead of ending it cleanly."""
    photo = tmp_path / "photo.gif"
    photo.write_bytes(b"x" * 20)
    monkeypatch.setattr(Path, "open", lambda *_args, **_kwargs: _FailingRead())
    archive = AccountArchive(data_files={}, uploads=[ArchiveUpload(arcname="images/7/abc.gif", path=photo)])
    caplog.set_level(logging.ERROR, logger=account_export.__name__)

    with pytest.raises(OSError, match="I/O error"):
        list(stream_account_archive(archive))

    assert "images/7/abc.gif" in caplog.text
