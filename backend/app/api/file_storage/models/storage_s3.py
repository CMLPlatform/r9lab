"""S3-compatible storage backend."""

import logging
from datetime import UTC, datetime, timedelta
from importlib import import_module
from pathlib import Path
from typing import TYPE_CHECKING, Any

from anyio import to_thread

from app.api.file_storage.exceptions import StorageBackendError
from app.api.file_storage.models.storage_core import BaseStorage, secure_filename

if TYPE_CHECKING:
    from typing import BinaryIO

    from fastapi import UploadFile

logger = logging.getLogger(__name__)


# boto3 is an optional dep; its stubs live in boto3-stubs (heavy, not installed).
# We expose the client as Any so the dynamic boto3 API doesn't require per-call casts.
def _import_boto3() -> Any:  # noqa: ANN401
    """Import boto3 lazily so the optional dependency stays optional."""
    return import_module("boto3")


def _client_error_type() -> type[Exception]:
    """Return botocore's ClientError type, or a local fallback when unavailable."""
    try:
        return import_module("botocore.exceptions").ClientError
    except ImportError:

        class ClientError(Exception):
            """Fallback exception used when botocore is not installed."""

        return ClientError


def _s3_delete_error_types() -> tuple[type[Exception], ...]:
    """Return botocore's ClientError/BotoCoreError, or a local fallback when unavailable."""
    try:
        botocore_exceptions = import_module("botocore.exceptions")
    except ImportError:
        return (_client_error_type(),)
    return (botocore_exceptions.ClientError, botocore_exceptions.BotoCoreError)


class S3Storage(BaseStorage):
    """S3-compatible storage backend."""

    def __init__(
        self,
        bucket: str,
        prefix: str,
        *,
        region: str = "us-east-1",
        access_key_id: str | None = None,
        secret_access_key: str | None = None,
        endpoint_url: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self._bucket = bucket
        self._prefix = prefix.strip("/")
        self._region = region
        self._access_key_id = access_key_id or None
        self._secret_access_key = secret_access_key or None
        self._endpoint_url = endpoint_url
        self._base_url = base_url.rstrip("/") if base_url else None
        self._client: Any = None

    def _get_client(self) -> Any:  # noqa: ANN401
        """Return a cached boto3 S3 client, importing boto3 lazily."""
        if self._client is None:
            try:
                boto3 = _import_boto3()
            except ImportError:
                msg = "boto3 is required for S3 storage. Install it with: uv sync --group s3"
                raise ImportError(msg) from None
            kwargs: dict[str, object] = {"region_name": self._region}
            if self._access_key_id:
                kwargs["aws_access_key_id"] = self._access_key_id
            if self._secret_access_key:
                kwargs["aws_secret_access_key"] = self._secret_access_key
            if self._endpoint_url:
                kwargs["endpoint_url"] = self._endpoint_url
            self._client = boto3.client("s3", **kwargs)
        return self._client

    def _s3_key(self, name: str) -> str:
        filename = secure_filename(Path(name).name)
        return f"{self._prefix}/{filename}" if self._prefix else filename

    def size(self, name: str) -> int:
        """Return the object's size in bytes from its metadata."""
        return int(self._get_client().head_object(Bucket=self._bucket, Key=self._s3_key(name))["ContentLength"])

    async def list_names(self, *, min_age_seconds: float) -> list[str]:
        """List the objects directly under the prefix that are at least ``min_age_seconds`` old.

        An empty prefix lists nothing: it would be the bucket root, where other data may live.
        """
        if not self._prefix:
            logger.error("Not listing S3 bucket %s: no key prefix is set, so the sweep skips it.", self._bucket)
            return []
        client = self._get_client()
        bucket = self._bucket
        key_prefix = f"{self._prefix}/"
        cutoff = datetime.now(UTC) - timedelta(seconds=min_age_seconds)

        def list_keys() -> list[str]:
            keys: list[str] = []
            for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=key_prefix):
                keys.extend(obj["Key"] for obj in page.get("Contents", ()) if obj["LastModified"] <= cutoff)
            return keys

        try:
            keys = await to_thread.run_sync(list_keys)
        except _s3_delete_error_types() as e:
            msg = f"Failed to list S3 objects under {key_prefix!r}: {e}"
            raise StorageBackendError(msg) from e
        names = (key.removeprefix(key_prefix) for key in keys)
        # Only flat names: a nested key was not written through this backend.
        return [name for name in names if name and Path(name).name == name]

    def get_name(self, name: str) -> str:
        """Normalize a file name for storage."""
        return secure_filename(Path(name).name)

    def get_path(self, name: str) -> str:
        """Return the public URL for a stored object."""
        filename = secure_filename(Path(name).name)
        key = f"{self._prefix}/{filename}" if self._prefix else filename
        if self._base_url:
            return f"{self._base_url}/{key}"
        if self._endpoint_url:
            return f"{self._endpoint_url.rstrip('/')}/{self._bucket}/{key}"
        return f"https://{self._bucket}.s3.{self._region}.amazonaws.com/{key}"

    def write(self, file: BinaryIO, name: str) -> str:
        """Upload a binary file to S3 and return the stored name."""
        filename = self.get_name(name)
        file.seek(0)
        client = self._get_client()
        client.upload_fileobj(file, Bucket=self._bucket, Key=self._s3_key(name))
        return filename

    async def write_upload(self, upload_file: UploadFile, name: str) -> str:
        """Upload a file to S3 using a background thread and return the stored name."""
        filename = self.get_name(name)
        await upload_file.seek(0)
        client = self._get_client()
        bucket, key = self._bucket, self._s3_key(name)
        file_obj = upload_file.file
        await to_thread.run_sync(lambda: client.upload_fileobj(file_obj, Bucket=bucket, Key=key))
        await upload_file.close()
        return filename

    async def delete(self, name: str) -> None:
        """Delete an S3 object. ``delete_object`` is idempotent for missing keys.

        A real failure (auth, network, throttling) surfaces as botocore's
        ``ClientError``/``BotoCoreError``, translated to ``StorageBackendError`` so
        best-effort cleanup callers don't need a botocore-specific except clause.
        """
        client = self._get_client()
        bucket, key = self._bucket, self._s3_key(name)
        try:
            await to_thread.run_sync(lambda: client.delete_object(Bucket=bucket, Key=key))
        except _s3_delete_error_types() as e:
            msg = f"Failed to delete S3 object {key!r}: {e}"
            raise StorageBackendError(msg) from e
