---
title: Backups and recovery
description: What R9lab backs up, how often, where it goes and what protects the copies.
---

This page describes the backup design. The commands for the production host are in
[`deploy/DEPLOY-PROD.md`](https://github.com/CMLPlatform/r9lab/blob/main/deploy/DEPLOY-PROD.md).
For the services involved, see [Deployment topology](/operations/deployment/).

## What is stored

- PostgreSQL holds the application state.
- Uploaded files and images sit on disk and are served by the backend. They are primary research
  data.

## What is backed up

Database dumps and uploads go into an encrypted local restic repository on the host. Backups are
host systemd timers, not Compose services:

- A snapshot every hour.
- Retention, an integrity check and an optional offsite copy once a day.

Losing the host still costs up to a day of data. The offsite copy goes to one rclone remote.

Each account deletion is also appended to an erasure ledger in `BACKUP_HOST_DIR/erasure-ledger`,
outside the database. A line holds the account id, the content policy and the time. Each database
snapshot archives the ledger with the dump, so the offsite copy carries it. `just restore` replays
the live ledger and the newest snapshot's copy before the API starts again, so restoring a dump
taken before a deletion does not bring the account back. If the backup disk is lost too, deletions
since the last offsite copy (up to a day) are in no copy of the ledger and come back with a restore
from offsite. The API refuses to start when the directory is missing.

## Safety checks

A backup refuses to run when it would replace good data with bad.

- **Size check.** It refuses a dump or uploads tree that is much smaller than the newest snapshot,
  so an empty one cannot age out the good copies.
- **Environment marker.** The uploads volume carries a marker with the name of its environment. A
  backup refuses to run when the marker is missing or names another environment.

## Restores and rollback

- A monthly restore check restores the latest dump and uploads snapshot into scratch space and
  confirms they hold real data.
- A failed migration leaves the last successful revision in place, and a re-run resumes from there.
- A rollback returns to an earlier release's images. It downgrades the schema only when no
  migration in the range destroyed data. Otherwise, restore a backup.

## Monitoring

Each scheduled job pings a dead-man's switch that bypasses the telemetry collector, so a failure
is reported even when telemetry is down. See
[Telemetry and monitoring](/operations/monitoring/).
