---
title: Backups and recovery
description: How R9lab backs up the database and uploads, and how to check, restore and roll back.
---

This page covers what is backed up, when, and how to check it. For the services involved, see
[Deployment topology](/operations/deployment/).

## What is stored

- PostgreSQL holds the application state.
- Uploaded files and images sit on disk and are served by the backend. Treat them as primary
  research data.

## What is backed up

Database dumps and uploads go into an encrypted local restic repository under `BACKUP_HOST_DIR`.
The backup container runs as UID and GID `65532`.

Backups are host systemd timers, not Compose services:

- `r9lab-backup@.timer` takes a snapshot every hour.
- `r9lab-backup-maintenance@.timer` runs retention, the integrity check and the optional offsite
  copy once a day. The repository is repacked daily, not 24 times a day.

Losing the host still costs up to a day of data. The offsite copy uses `restic copy` over restic's
rclone backend, to the one remote in `secrets/<env>/rclone.conf`.

Each account deletion is also appended to an erasure ledger in `BACKUP_HOST_DIR/erasure-ledger`,
outside the database. A line holds the account id, the content policy and the time. Each database
snapshot archives the ledger with the dump, so the offsite copy carries it. `just restore` replays
the live ledger and the newest snapshot's copy before the API starts again, so restoring a dump
taken before a deletion does not bring the account back. If the backup disk is lost too, deletions
since the last offsite copy (up to a day) are in no copy of the ledger and come back with a restore
from offsite. The API refuses to start when the directory is missing.

## Safety checks

A backup refuses to run when it would replace good data with bad.

- **Size check.** It refuses a dump or uploads tree smaller than half the newest stored snapshot of
  the same tag. An empty snapshot could otherwise age out the good copies. `RESTIC_MIN_DUMP_RATIO`
  tunes the ratio. `0` turns the check off.
- **Environment marker.** The uploads volume carries a `.relab-volume` marker with the name of its
  environment. A backup refuses to run if the marker is missing or names another environment. The
  check is skipped when `R9LAB_ENVIRONMENT` is unset, as in dev and CI.

After you restore one environment's uploads into another's volume, rewrite the marker for the
target. The restore carries the source marker along, and every backup there then refuses.

## Check a restore

```bash
just restore-check <env>
```

This restores the latest database dump into a disposable Postgres container and checks that it
reads. It also restores the latest uploads snapshot into a scratch directory and checks that it
holds real data. A monthly timer runs it for you.

## Migrations and rollback

Alembic runs each migration revision in one transaction. A failed migration leaves the last
successful revision in place. A re-run resumes from there.

To return to an earlier release:

```bash
just stack <env> rollback YES <tag> [<revision>]
```

This switches to that release's published images. It downgrades the schema only when no migration
in the range destroyed data. Otherwise, restore a backup. It cannot return to a release from
before the R9lab rename.

## Scheduled work

Hourly backup, daily backup maintenance, the hourly watchdog and the monthly restore check all run
from systemd timers. The timers catch up on runs missed while the host was off.

Each job pings a dead-man's switch that bypasses the telemetry collector, so it reports even when
telemetry is broken. For local triage, run `just watchdog <env>`. It exits non-zero and prints one
`ALERT[...]` line for each failure.
