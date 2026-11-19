"""Account erasure with a per-deletion content policy.

Deleting a user always erases their personal data. What happens to the research
data they contributed is the admin's choice at deletion time; self-service deletion
always anonymizes:

- ``anonymize`` (default) reassigns their products to a dedicated, permanently
  inactive system account, so published research data survives the account.
- ``delete`` removes the owned product subtrees, their media rows, and the bytes.

Cameras and OAuth links are personal data and are always hard-deleted.

Every erasure is also appended to a ledger outside the database
(``settings.erasure_ledger_path``). A database restore brings back the accounts erased
after its dump was taken; ``replay_erasures`` erases them again before the API takes
writes. A ledger line holds the account id, the content policy and the time, never an
email address or a name.
"""

import logging
import os
import secrets
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal

from anyio import to_thread
from pydantic import UUID4, AwareDatetime, BaseModel, ValidationError
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.api.auth.models import OAuthAccount, User
from app.api.auth.services.email_identity import canonicalize_email
from app.api.auth.services.oauth.accounts import google_tokens_to_revoke, revoke_google_tokens
from app.api.auth.services.password_hashing import build_password_helper
from app.api.common.audit import AuditAction, audit_event
from app.api.common.crud.query import require_locked_model
from app.api.common.exceptions import ConflictError
from app.api.data_collection.crud.storage import (
    cleanup_product_media_storage,
    delete_product_media,
    delete_product_rows,
    product_subtree_ids,
)
from app.api.data_collection.models.product import Product
from app.api.file_storage.upload_quota import recompute_user_upload_quota
from app.api.plugins.r9cam.models import Camera
from app.api.plugins.r9cam.runtime.preview import get_preview_thumbnail_path, remove_preview_thumbnail
from app.core.config.core import settings

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from app.api.data_collection.crud.storage import ProductMediaStorageCleanup

logger = logging.getLogger(__name__)

type ErasureContent = Literal["anonymize", "delete"]
ANONYMIZE: ErasureContent = "anonymize"

# Owner of anonymized content, so products keep a NOT NULL owner_id. NOTE: `.internal`,
# not `.invalid`: email-validator rejects `.invalid`, which would make `UserRead.email`
# unserializable and break the admin user list.
ANONYMOUS_USER_EMAIL = "anonymous@system.r9lab.internal"
# The pre-rename address, which migration 0b5e7c3a9d21 rewrites. Still refused by the
# erasure guard in case a rolled-back release recreated that row.
# TODO(drop-by 2027-01-31): drop LEGACY_ANONYMOUS_USER_EMAIL
LEGACY_ANONYMOUS_USER_EMAIL = "anonymous@system.relab.internal"


async def get_or_create_anonymous_user(session: AsyncSession) -> User:
    """Return the system account that owns anonymized content, creating it on first use.

    Never usable as a login: inactive, unverified, and holding a hash of a random
    secret nobody knows.
    """
    lookup = select(User).where(User.email_canonical == canonicalize_email(ANONYMOUS_USER_EMAIL))
    if (existing := (await session.execute(lookup)).scalars().unique().one_or_none()) is not None:
        return existing

    anonymous = User(
        email=ANONYMOUS_USER_EMAIL,
        hashed_password=build_password_helper().hash(secrets.token_urlsafe(32)),
        has_usable_password=False,
        is_active=False,
        is_verified=False,
        is_superuser=False,
    )
    try:
        async with session.begin_nested():
            session.add(anonymous)
            await session.flush()
    except IntegrityError:
        # A concurrent erasure won the insert; take its row.
        return (await session.execute(lookup)).scalars().unique().one()
    return anonymous


async def erase_user(
    session: AsyncSession,
    user: User,
    *,
    actor_id: UUID4,
    content: ErasureContent = ANONYMIZE,
    record_in_ledger: bool = True,
) -> None:
    """Erase a user account, applying the chosen policy to the content they own.

    ``actor_id`` is the account performing the erasure: the admin, or the user
    themself for self-service deletion. It is the audit subject for the product
    deletions this triggers. ``record_in_ledger`` is False only for the replay, which
    reads the ledger rather than adding to it.

    Raises:
        ConflictError: when the target is the anonymous system account or the last
            active superuser.
        OSError: when the ledger entry cannot be written; nothing is committed.
    """
    db_user = await require_erasable_account(session, user)
    user_id = db_user.id

    pending_media: list[ProductMediaStorageCleanup] = []
    deleted_product_ids: list[int] = []

    if content == ANONYMIZE:
        anonymous = await get_or_create_anonymous_user(session)
        # owner_id is denormalized onto every row of a product subtree, so a flat
        # update by owner covers base products and their components alike.
        await session.execute(update(Product).where(Product.owner_id == user_id).values(owner_id=anonymous.id))
    else:
        anonymous = None
        pending_media, deleted_product_ids = await _delete_owned_products(session, user_id)

    thumbnails = await _delete_owned_cameras(session, user_id)

    google_tokens = google_tokens_to_revoke(
        (await session.execute(select(OAuthAccount).where(OAuthAccount.user_id == user_id))).scalars()
    )
    # OAuth links follow the user row through the delete-orphan cascade.
    await session.delete(db_user)
    await session.flush()

    if anonymous is not None:
        await recompute_user_upload_quota(session, user_id=anonymous.id)

    if record_in_ledger:
        # On disk before the commit: a lost entry would let a restore revive the account,
        # while an entry whose commit then fails only replays an erasure already authorized.
        try:
            await to_thread.run_sync(append_erasure, settings.erasure_ledger_path, user_id, content)
        except OSError:
            logger.exception("Could not write the erasure ledger; the account erasure is rolled back")
            raise

    await session.commit()

    for product_id in deleted_product_ids:
        audit_event(actor_id, AuditAction.DELETE, Product, product_id)

    # Bytes only after the rows are durably gone, mirroring product deletion.
    await cleanup_product_media_storage(pending_media)
    for path in thumbnails:
        remove_preview_thumbnail(path)
    await revoke_google_tokens(google_tokens)


async def require_erasable_account(session: AsyncSession, user: User) -> User:
    """Return the session-bound user, refusing accounts the platform cannot function without.

    Callers with side effects of their own (session revocation) run this first, so a
    rejected erasure leaves nothing behind.

    Raises:
        ConflictError: when the target is the anonymous system account or the last
            active superuser.
    """
    # The caller's instance may belong to the auth dependency's own session. Locked first,
    # before any product row, in the owner-first order every product writer uses
    # (lock_product_owner).
    user = await require_locked_model(session, User, user.id)

    if user.email_canonical in {
        canonicalize_email(ANONYMOUS_USER_EMAIL),
        canonicalize_email(LEGACY_ANONYMOUS_USER_EMAIL),
    }:
        msg = "The anonymous system account cannot be deleted."
        raise ConflictError(msg)

    if not (user.is_superuser and user.is_active):
        return user

    # Locked, so two concurrent deletions cannot each see the other as "remaining".
    other_superuser = await session.execute(
        select(User.id)
        .where(User.is_superuser.is_(True), User.is_active.is_(True), User.id != user.id)
        .with_for_update()
        .limit(1)
    )
    if other_superuser.first() is None:
        msg = "The last active superuser cannot be deleted."
        raise ConflictError(msg)
    return user


async def _delete_owned_products(
    session: AsyncSession, user_id: UUID4
) -> tuple[list[ProductMediaStorageCleanup], list[int]]:
    """Delete every base product the user owns, subtrees and media included.

    Returns the storage cleanups to run after the caller's commit, and the deleted
    product ids to audit once that commit is durable. Bulk statements, however many
    products the user owns; the owner's quota and profile stats are not recomputed,
    since the user row goes too.
    """
    owned_roots = (Product.owner_id == user_id, Product.parent_id.is_(None))
    base_product_ids = (await session.execute(select(Product.id).where(*owned_roots))).scalars().all()
    subtrees = product_subtree_ids(*owned_roots)
    pending_media = await delete_product_media(session, subtrees)
    await delete_product_rows(session, subtrees)
    return pending_media, list(base_product_ids)


async def _delete_owned_cameras(session: AsyncSession, user_id: UUID4) -> list[Path]:
    """Delete the user's cameras, returning their preview thumbnails for post-commit cleanup."""
    cameras = (await session.execute(select(Camera).where(Camera.owner_id == user_id))).scalars().all()
    thumbnails = [get_preview_thumbnail_path(camera.id) for camera in cameras]
    for camera in cameras:
        await session.delete(camera)
    return thumbnails


class ErasureRecord(BaseModel):
    """One erasure ledger line: enough to erase the account again, and nothing personal."""

    user_id: UUID4
    content: ErasureContent
    erased_at: AwareDatetime


def append_erasure(path: Path, user_id: UUID4, content: ErasureContent) -> None:
    """Append one record to the erasure ledger and fsync it."""
    record = ErasureRecord(user_id=user_id, content=content, erased_at=datetime.now(UTC))
    # The leading newline ends a line torn by an earlier crash, so it cannot swallow this one.
    line = f"\n{record.model_dump_json()}\n".encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    # O_APPEND and one small write per record keep lines from concurrent API workers whole.
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        if (written := os.write(fd, line)) < len(line):
            # A full disk can take part of the record; the erasure must not commit on that.
            msg = f"Short write to the erasure ledger {path}: {written} of {len(line)} bytes"
            raise OSError(msg)
        os.fsync(fd)
    finally:
        os.close(fd)
    # The directory entry too, or a power cut can lose the file the first erasure created.
    dir_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)


def read_erasure_ledger(path: Path) -> tuple[list[ErasureRecord], list[int]]:
    """Return the ledger's valid records in order, and the numbers of the lines that are not.

    A missing file means no account was erased yet. Blank lines are skipped.
    """
    if not path.exists():
        return [], []
    records: list[ErasureRecord] = []
    bad_lines: list[int] = []
    with path.open(encoding="utf-8", errors="replace") as ledger:
        for number, line in enumerate(ledger, start=1):
            if not line.strip():
                continue
            try:
                records.append(ErasureRecord.model_validate_json(line))
            except ValidationError:
                bad_lines.append(number)
    return records, bad_lines


async def replay_erasures(session: AsyncSession, paths: Sequence[Path], *, empty_ok: bool = False) -> bool:
    """Erase again every account in any of the ledgers that the database still holds.

    Run after a restore, before the API takes writes, with the live ledger and the copy
    from the newest backup: their union survives the loss of either. Accounts already
    gone are skipped, so a second run changes nothing. Returns False when a line could
    not be read, an account could not be erased, or none of the ledgers exists (a wrong
    mount looks the same as a host with no erasures; ``empty_ok`` accepts the latter).
    The database may then still hold an erased account, so the caller must keep the API
    stopped.
    """
    if not empty_ok and not any(path.exists() for path in paths):
        logger.error(
            "No erasure ledger at %s; pass --empty-ok only if no account was ever erased", ", ".join(map(str, paths))
        )
        return False

    records: list[ErasureRecord] = []
    bad_lines = 0
    for path in paths:
        path_records, path_bad_lines = read_erasure_ledger(path)
        records += path_records
        bad_lines += len(path_bad_lines)
        for number in path_bad_lines:
            logger.error(
                "Erasure ledger %s line %d is not a valid record; check it and erase that account by hand", path, number
            )

    erased = failed = 0
    for record in records:
        user = await session.get(User, record.user_id)
        if user is None:
            continue
        try:
            await erase_user(session, user, actor_id=record.user_id, content=record.content, record_in_ledger=False)
        except ConflictError:
            await session.rollback()
            logger.exception("Could not erase account %s again", record.user_id)
            failed += 1
        else:
            erased += 1

    logger.info(
        "Erasure replay: %d records, %d accounts erased again, %d failed, %d unreadable lines",
        len(records),
        erased,
        failed,
        bad_lines,
    )
    return not bad_lines and not failed
