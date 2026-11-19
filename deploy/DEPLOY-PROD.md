# Operating the production host

This runbook covers what is specific to the CML production host: first-time setup, the routine
release and recovery. [SETUP.md](SETUP.md) takes an empty host to a
running stack (tunnel, `.env`, secrets, first start); start there.

Staging equivalent: [DEPLOY-STAGING.md](DEPLOY-STAGING.md). Rehearse there first.

______________________________________________________________________

## Part 1: First-time host setup

Once per machine, not per release. `just watchdog prod` reports each missing piece as a distinct
alert.

Commands in this runbook read `BACKUP_HOST_DIR` from the shell. Load it from the host's `.env`
first: `export BACKUP_HOST_DIR="$(sed -n 's/^BACKUP_HOST_DIR=//p' .env)"`.

### 1.0 Docker daemon log rotation (fallback)

The Compose files cap every stack service's logs (`max-size: 10m`, `max-file: 3`). Set the same
defaults host-wide, so a container started outside the stack (a debug `docker run`, a second
project) cannot fill the disk either. Do not replace an existing `/etc/docker/daemon.json`: merge
these keys into it. Restart dockerd in a maintenance window. The defaults apply only to containers
created afterwards:

```json
"log-driver": "json-file",
"log-opts": { "max-size": "10m", "max-file": "3" }
```

Skipping this is safe for the stack: the Compose caps still apply.

### 1.1 Backup repository

The backup container runs as UID 65532. Create the restic directory first: the service refuses to
start without it (`create_host_path: false`), so Docker cannot create an empty directory that looks
like a real mount. **The repository is never created automatically**, and backup runs never create
one. Never run `backup-init` on a host that already has backups.

The `erasure-ledger` directory beside it holds the account erasure ledger, which the API appends to
on every account deletion. It lives outside Postgres so that `just restore` can erase those
accounts again after loading an older dump. The API and the migrator refuse to start without it,
for the same reason as the restic directory. Never delete or truncate it: an entry lost there is an
erased account that a restore brings back. Every database snapshot archives it with the dump, so
the offsite copy carries it; if this disk is lost, erasures since the last offsite copy (up to a
day) are in no copy.

```bash
mkdir -p "${BACKUP_HOST_DIR:-./backups}/restic" "${BACKUP_HOST_DIR:-./backups}/erasure-ledger"
sudo chown -R 65532:65532 "${BACKUP_HOST_DIR:-./backups}"
just backup-init prod     # creates the repository, marks the uploads volume
just backup prod          # takes the first snapshot
just restore-check prod   # restores it: DB into a scratch container, uploads into a scratch dir
```

The repository is encrypted with `secrets/prod/restic_password`. Never rotate it: every later
snapshot depends on it.

`backup-init` also stamps the uploads volume with `.relab-volume`, naming its environment. A backup
then refuses to run if the marker is missing or wrong: a deleted volume returns silently empty and the
API refills it at startup, so existence alone proves nothing about the data inside. Do not re-run
`backup-init` to silence this: it fails against an existing repository.

**Marker missing, and the volume already has real uploads in it:** this host was deployed before
the marker existed. Switch to a release that has the guard first, then stamp, then take the first
marked snapshot:

```bash
just stack prod tag YES <tag>    # the guard ships inside the backup image, not the checkout
just backup-stamp-volume prod    # writes .relab-volume; safe to re-run, never overwrites
just backup prod                 # first snapshot carrying the marker
just timers-install prod         # re-render the units
```

`just backup` runs the script baked into the `r9lab-backup` image that `IMAGE_TAG` names
(`backend/Dockerfile.backups` copies it in), not the one in the checkout. Pull the new code without
switching the tag and the stamp lands while every guard stays inert: the run archives, the snapshot
carries the marker, and nothing checks it.

The new image says so in its own log. A guarded run reports each tag by name:

```text
postgres size 267556 bytes (100% of previous); archiving
user-uploads size 355234816 bytes (100% of previous); archiving
```

`Dump size ...` with no `user-uploads` line means the container is still on the old image; check
`IMAGE_TAG` and run it again.

Run `just backup` before the next `r9lab-restore-check@` fires. Restore verification enforces the
marker strictly, so a check landing between the stamp and the first marked snapshot fails against
the pre-marker one. `systemctl list-timers r9lab-restore-check@prod` shows how long you have.

**Dump or uploads tree refused as collapsed:** a run refuses to archive data under half the size of
the newest snapshot with the same tag. If the shrink is real (a deliberate mass deletion), take one
snapshot with the guard off; the next scheduled run compares against it:

```bash
RESTIC_MIN_DUMP_RATIO=0 just backup prod
```

**Marker missing, and the volume is genuinely empty:** the volume lost its contents or was
replaced. No `just` recipe restores uploads live (`restore-check` only targets a scratch directory;
`just restore` is Postgres-only), so restore by hand into the compose-managed volume
(`r9lab_prod_user_uploads`); restic's `--target` restores under the absolute backed-up path
(`/data/uploads`), hence the two-step copy below.

Put the scratch directory on the backup disk, not `/tmp`: a full restore there can fill the disk
Postgres and Docker use, and the watchdog only checks `BACKUP_HOST_DIR`. The directory must be
writable by uid 65532 (the backup image's uid). `--no-lock` is required because the repository
mounts read-only.

```bash
BACKUP_IMAGE="ghcr.io/cmlplatform/r9lab-backup:$(sed -n 's/^IMAGE_TAG=//p' .env)"
just stack prod down YES
SCRATCH="${BACKUP_HOST_DIR:-./backups}/uploads-restore"
mkdir -p "$SCRATCH"
docker run --rm -v "$SCRATCH:/restore" --entrypoint chown alpine:3.22 -R 65532:65532 /restore
docker run --rm \
  -v "${BACKUP_HOST_DIR:-./backups}/restic:/restic:ro" \
  -v "$(pwd)/secrets/prod/restic_password:/run/secrets/restic_password:ro" \
  -v "$SCRATCH:/restore" \
  -e RESTIC_PASSWORD_FILE=/run/secrets/restic_password \
  --entrypoint restic "$BACKUP_IMAGE" \
  restore --no-lock latest --repo /restic --tag user-uploads --target /restore
docker run --rm \
  -v r9lab_prod_user_uploads:/data/uploads \
  -v "$SCRATCH:/restore:ro" \
  --entrypoint sh "$BACKUP_IMAGE" -c \
  'rm -rf /data/uploads/* && cp -a /restore/data/uploads/. /data/uploads/'
docker run --rm -v "$SCRATCH:/restore" --entrypoint chown alpine:3.22 -R "$(id -u):$(id -g)" /restore
rm -rf "$SCRATCH"
just stack prod up YES
```

If the source snapshot came from another environment, the restored tree carries that
environment's marker. `just backup-stamp-volume prod` cannot fix it (it never overwrites), so
rewrite the marker by hand:

```bash
docker run --rm -v r9lab_prod_user_uploads:/data/uploads --entrypoint sh busybox -c \
  'printf prod >/data/uploads/.relab-volume.tmp && mv /data/uploads/.relab-volume.tmp /data/uploads/.relab-volume'
```

**Marker present but names another environment:** the wrong volume is mounted, typically a mistyped
`-p`/compose project. Re-point the mount; restoring here would overwrite correct data with the
wrong environment's.

A missing repository fails the backup with restic exit 10. An empty directory for the wrong reason
(a wrong `BACKUP_HOST_DIR`, a swapped disk) looks just like a first run. Creating a repository there
would exit 0 after backing up into an empty repo on the wrong filesystem, and the real archive
would be unreachable.

**If an existing host starts reporting that the repository is not readable, do not run
`backup-init`.** That message means a repository that was working no longer is, and initializing
over it replaces the problem with an empty archive that reports success. Check `findmnt -T
"$BACKUP_HOST_DIR"`, then `secrets/prod/restic_password`. `backup-init` is for a host that has never
had a backup.

`BACKUP_HOST_DIR` is one value shared by every stack on the host, so two environments on one machine
would share a restic directory. It fails closed, but only one of them gets backups. Give each host a
single environment.

**Before anything destructive, take a tagged backup:** `just backup prod manual`. The `manual` tag
is exempt from retention. An untagged copy is not safe: retention keeps only the newest snapshot
per calendar day, so it can expire the same day.

### 1.2 Scheduled jobs

```bash
just timers-render             # inspect what will be installed
just timers-install prod      # render, install, enable, start (prompts for sudo; not `sudo just`)
systemctl list-timers 'r9lab-*@prod.timer'   # confirm the NEXT times are scheduled
```

The units run as whoever runs that command. On a host with a dedicated, sudo-less deploy user
(1.6), run it from an account that has sudo and name the deploy user. The units then run as that
user, it owns `/etc/r9lab/r9lab.env`, and the rendered `PATH` finds its per-user `uv`:

```bash
R9LAB_UNIT_USER=r9lab just timers-install prod
```

| Job                             | When             | Catch-up                                                |
| ------------------------------- | ---------------- | ------------------------------------------------------- |
| `r9lab-backup@prod`             | hourly           | yes: an hour missed while the host was off runs at boot |
| `r9lab-backup-maintenance@prod` | 02:30 daily      | yes: a night missed while the host was off runs at boot |
| `r9lab-watchdog@prod`           | hourly           | no: a missed check self-heals within the hour           |
| `r9lab-restore-check@prod`      | 06:00 on the 1st | yes                                                     |

### How a failed job reaches you

The installer seeds `/etc/r9lab/r9lab.env` (mode 0600, never committed) with one dead-man's-switch
URL variable per job. Only `PING_WATCHDOG` has to be filled in: the hourly watchdog checks every
other job's timer state, last result and staleness, and puts a failing job's own output in the
alert body. The other three are optional: set one to give that job its own healthchecks.io check.
Never share a URL between jobs, or the hourly job's pings mask the monthly job's silence:

```ini
PING_WATCHDOG=https://hc-ping.com/...           # required; period 1 hour, grace 30 min
PING_BACKUP=                                    # optional; period 1 hour
PING_BACKUP_MAINTENANCE=                        # optional; period 1 day
PING_RESTORE_CHECK=                             # optional; period 35 days
```

Each job with a URL pings on success, and on failure pings `/fail` with its own output as the body,
so the alert carries the reason. An empty URL disables that job's ping without failing the job. The
failure body sends job output (hostnames, paths, restic summaries) to a third party.

The deploy user needs docker-group membership, which is root-equivalent: these units run a writable
git checkout as unattended, scheduled, root-level jobs. Treat that directory as privileged.

### 1.3 Offsite copy

SURFdrive over WebDAV, reached with a **share-link credential scoped to one folder**, not an account
app password. App passwords grant whole-account access, so two of them would give staging delete
authority over production's only off-host copy. A share link cannot leave its folder.

In SURFdrive: create prod's folder, share it as a link with **edit** permission, set a share
password, leave expiry **off** (an expiring link stops backups silently). The token is the last path
segment of the share URL.

Then write `secrets/prod/rclone.conf` (`just deploy-secrets-template prod` seeds a placeholder). The
remote **must** be named `surfdrive_prod`:

```ini
[surfdrive_prod]
type = webdav
url = https://surfdrive.surf.nl/public.php/webdav
vendor = nextcloud
user = <share token — the token only, NOT the full share URL>
pass = <output of: rclone obscure '<share password>'>
```

Two details fail differently:

- `pass` must be obscured (`rclone obscure`), not plaintext. Fails loudly.
- `user` is the token alone. The full share URL gives a 401.

The backup copies to `rclone:surfdrive_prod:`, the file's one remote with an empty path, because a
share link's WebDAV root *is* the shared folder, and a path appended to it would create a second,
empty repository nested inside the real one. There is no override: the conf's one remote is the
offsite target.

```bash
just deploy-secrets-check   # reports if the remote is still undefined
```

> If you add periodic `restic check --read-data-subset`: there is **no official cadence
> recommendation** for it. The commonly repeated "1/12 monthly" is forum folklore, not upstream
> guidance. Pick a cadence and write down why.

**This does not give immutability.** restic must delete to prune, so no credential setup makes a
WebDAV copy append-only. Where offsite immutability is required, use object-lock storage (B2,
Wasabi, S3) or a restic REST server with `--append-only`.

### 1.4 What the watchdog checks

`sudo -u r9lab just watchdog prod` runs hourly from the timer above. Run it by hand after any
change, as the deploy user (1.6), so it sees the checkout the way the timer does. It checks:

- every stack service (running, and healthy where a healthcheck exists)
- newest snapshot age
- free space on the filesystem holding the restic repository: alerts at 85% used
  (`BACKUP_DISK_ALERT_PCENT`) **or** under 25 GiB free (`BACKUP_DISK_MIN_FREE_GB`, 0 disables).
  Whichever threshold is crossed first triggers the alert. On a large disk that is usually the
  percentage. The floor covers a repository sharing a small filesystem with the database or the
  Docker data root.
- all four scheduled-job timers (installed, enabled, active, last run not failed, last trigger not
  overdue)
- that `PING_WATCHDOG` is filled in
- deployment drift (uncommitted changes, or commits that exist nowhere else). With a release
  `IMAGE_TAG` such as `0.4.0`, the checkout must contain the git tag `v0.4.0`; being behind `main`
  is expected then. With a `sha-` tag, it must be level with its upstream branch.
- that telemetry exports reach the collector
- schema drift: the database's alembic revision against the one the deployed migrator image
  expects, and any index left `indisvalid = f` by a concurrent build that died (Part 3). Between
  `pull` and `migrate` a revision behind is expected and brief; an hour later it means the migrate
  step was skipped or failed.

It exits non-zero with one `ALERT[...]` line per problem. The hourly dead-man's switch reports that
exit code, so a failing check surfaces as a missed or failed ping.

Its timer checks read systemd's `Result` of each unit's **last run**. After fixing a job, clear the
alert by running the unit, not the `just` recipe, which systemd never sees:

```bash
sudo systemctl reset-failed r9lab-backup-maintenance@prod.service && sudo systemctl start r9lab-backup-maintenance@prod.service
```

`reset-failed` also lifts the start-rate limit that a few consecutive timer failures trip, which
otherwise refuses a manual start too.

That applies to a crash. Exit 3 differs: the unit refused to archive (an emptied uploads volume, a
collapsed dump, a missing or mismatched marker), and `RestartPreventExitStatus=3` stops
`r9lab-backup@.service` retrying. `reset-failed` clears the alert, not the cause: the unit refuses
again until the guard's trigger is fixed (see 1.1).

The telemetry check probes from inside the api container, so it tests the credentials that container
ships with. It separates two failure modes fixed in different systems: a `cf-mitigated` response
means Cloudflare challenged the export (the skip rule is missing, or the two halves of the edge key
disagree, §1.5); a 401/403 without it means the collector rejected the bearer token. Both are
otherwise silent: the SDK logs an export error and the application carries on serving traffic.

**Do not delete the service-health, snapshot-age or timer checks until the central monitoring
stack's `ProjectTelemetrySilent` and container-lifecycle rules are live and verified for this
environment.** Live means bootstrap has been run for it (§1.5), not merely that the stack has the
rules. Until then this script is the only detector for those failures. See CMLPlatform/monitoring,
ADR 0002.

### 1.5 Telemetry

Set these four in the host's root `.env`. The endpoint and token come from the monitoring stack
operator (github.com/CMLPlatform/monitoring); the edge key is shared with whoever runs
`infra/cloudflare-zone` (`TF_VAR_telemetry_edge_key` must carry the same value):

```env
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.cml-relab.org
OTLP_AUTH_TOKEN=<bearer token>
TELEMETRY_EDGE_KEY=<edge key>
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

The collector keeps its `cml-relab.org` name: the monitoring stack publishes it there, and
`scripts/env_policy.py` checks `.env.example` for that name.

Every CML project shipping to `otel.` shares `TELEMETRY_EDGE_KEY`. Rotate it together with
`TF_VAR_telemetry_edge_key` in `infra/cloudflare-zone` and every other spoke's `.env`. If the two
differ, every export 403s with a `cf-mitigated` header.

**Then run `./bootstrap.sh <project> <env>` on the monitoring host, in the same change.** Setting
the endpoint starts telemetry flowing; bootstrap creates the rule that notices when it *stops*.
Nothing on this host can tell you that rule is missing. The arguments must match `PROJECT` and
`ENVIRONMENT`, which the deploy recipes set (`r9lab` and the recipe's environment); those are the
label values the rule matches on. Bootstrap also prints the `.env` block and the commands that
vendor the agent files at a pinned tag.

Hosts with an NVIDIA card set `GPU_METRICS=1`.

Verify the whole path end to end with a real job:

```bash
just backup prod
```

Then look for `service.name=backup` and the line `Backup run completed` in Grafana.

______________________________________________________________________

### 1.6 A deploy user and a restricted key

The host runs prod from a checkout nobody edits, as a sudo-less account, and is only ever *reached*
from the operator's machine; credentials and working trees stay there.

**Run recipes as that account: `sudo -u r9lab just <recipe> prod`.** Plain `sudo just` runs as
root, and git refuses a checkout that `r9lab` owns: the watchdog's drift check then reports the
directory as not a checkout at all. `just timers-install` is the one exception (1.2). It refuses to
run as root and calls `sudo` itself, and `r9lab` is a system account with no password to answer
that prompt.

```bash
sudo useradd --system --create-home --home-dir /var/lib/r9lab --shell /bin/bash --groups docker r9lab
sudo git clone https://github.com/CMLPlatform/r9lab.git /opt/r9lab
sudo chown -R r9lab:r9lab /opt/r9lab
sudo -u r9lab sh -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'   # ~/.local/bin/uv; `uv self update` to move it
sudo install -o r9lab -g r9lab -m 600 <old checkout>/.env /opt/r9lab/.env
sudo install -d -o r9lab -g r9lab -m 700 /opt/r9lab/secrets/prod
sudo install -o r9lab -g r9lab -m 644 <old checkout>/secrets/prod/* /opt/r9lab/secrets/prod/
R9LAB_UNIT_USER=r9lab just timers-install prod                            # from /opt/r9lab, as the sudo account
```

Then one key pair on the dev host, used for nothing else, and one `authorized_keys` line for the
deploy user whose forced command is `scripts/remote_deploy.sh`. The script maps a short allow-list
onto the `just` recipes and refuses anything else, so the key cannot open a shell or read a secret:

```text
command="/opt/r9lab/scripts/remote_deploy.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... r9lab-deploy
```

The environment is the host's own root `.env`; it is never an argument. The repository is public,
so `git pull` over https needs no credential; a private repository would need a read-only GitHub
deploy key in `/var/lib/r9lab/.ssh` with the remote switched to ssh. The personal key stays on the
sudo account and never on the deploy user.

______________________________________________________________________

## Part 2: Routine release

Before you start: CI green on `main`, you know whether the release contains migrations
(`cd backend && uv run alembic history -r <current>:head`), and you have a fresh backup
(`just backup prod`).

From the dev host, over the restricted key (`r9lab-prod` here is an ssh config alias for the
deploy user on the prod host; `R9LAB_DEPLOY_HOST` names a different alias for `just deploy`):

```bash
ssh r9lab-prod pull                 # git pull --ff-only of origin/main, prints the revision
just deploy prod 0.4.0              # images-verify on the dev host, then `ssh r9lab-prod tag 0.4.0`
ssh r9lab-prod up migrations
```

`just deploy` refuses to reach the host unless every image of the tag verifies: release images
must come from their release tag, which only repository admins and maintainers can create or move
(the `release tags` ruleset in `infra/cloudflare/github.tf`). `ssh r9lab-prod` with no command
prints the allow-list. On the host itself the steps are `git pull --ff-only`, `just stack prod tag
YES <tag>`, `just stack prod up YES migrations` as the deploy user; run `just images-verify prod
<tag>` on the dev host first.

The images come from the release. Publishing it on GitHub starts `release.yml`, which publishes
them to GHCR (`publish-images.yml`). Wait for that run to finish. `tag` pulls every image before it
writes `IMAGE_TAG`, so an unpublished tag stops there with the stack untouched. `up` never pulls: it
runs the images that `tag` pulled, so a tag moved on GHCR afterwards cannot reach the host on a
restart.

`images-verify` checks each image's build provenance. It reads the images from GHCR with Docker's
credentials, so they must be public (or run `docker login ghcr.io` first). To try a commit before a
release, run the Publish Images workflow on it by hand and use its `sha-<short sha>` tag.

The landing page and docs are not on this host: the same release deploys them to Cloudflare
Workers (`deploy-sites.yml`, which the published release starts). Staging's go first. Prod's wait
in that run until you approve them, so check staging before you approve. Prod is never rebuilt
unattended. To show a changed featured product (the `FEATURED_PRODUCT_ID` variable of the `prod`
GitHub Environment), run Deploy Sites by hand for `prod` on `main` and approve it. Staging rebuilds
weekly on its own.

A failed migration does not leave the old API serving: `up` exits non-zero and names the
migrator, and the new API is either not started or running on the unfinished schema. Fix forward or
roll back (Part 3). The migration history was flattened into `a9c2e4f60b18` on 2026-09-08, so
older revisions cannot be targeted. Without the `migrations` profile, the API briefly serves
against the old schema: acceptable during a planned outage, not for a routine release.

Do not run `just cloudflare-apply prod` as part of a deploy. The edge is managed separately in
`infra/cloudflare/`. The tunnel's ingress rules live there, so a renamed Compose service needs a
plan and apply, not a dashboard edit.

### Releases that need a window

Four things stretch a release beyond the time the commands take.

**A backfill migration holds the API down for its whole duration.** The `migrations` profile gates
the API on `service_completed_successfully`. A release whose migrator backfills existing rows
(regenerating derivatives, recomputing a column) keeps `api` and the tunnel in `Created` until it
finishes, however long that is. Check for one before you start: run `alembic history` as above, and
read what the migrator does, not only whether it exists. Announce the window from what you find
there, not from the first 100% CPU reading during the release.

**A change to the containers' uid needs a chown, in a fixed order.** The Compose `user:` pin
overrides the image's own `USER`, so the change takes effect as soon as the checkout moves, and
every backup fails until the matching `chown`. The safety snapshot cannot run after `down`, because
`just backup <env> manual` runs with `--no-deps`: the timer must never start PostgreSQL as a side
effect. `up` refuses to start while a mount is unwritable and names the volume. In the order
that works:

```bash
env=prod                          # or staging
just stack "$env" tag YES <tag>
sudo chown -R 65532:65532 "${BACKUP_HOST_DIR:-./backups}"   # a host bind: safe with the stack up
just backup "$env" manual         # tagged, so retention cannot expire it
just stack "$env" down YES
# Run as uid 0 in a container, so the host needs no knowledge of where Docker keeps volumes.
for volume in user_uploads restic_cache; do
    docker run --rm --user 0 -v "r9lab_${env}_${volume}:/mnt" \
        busybox chown -R 65532:65532 /mnt
done
just stack "$env" up YES migrations
```

**Restart every timer you stopped.** Stopping the backup and maintenance timers for a window means
stopping the watchdog too, or it pages mid-window. A stopped watchdog cannot then tell you the
others are still stopped. The dead man's switch is the backstop: with no ping, the external check
fires after its grace period. Do not rely on it. Run `systemctl is-active` on all three before you
close the window.

### Verify

```bash
ssh r9lab-prod watchdog
ssh r9lab-prod status
ssh r9lab-prod logs 10m     # non-following; `just stack prod logs` on the host follows
```

Then test by hand what automation cannot: one upload, one OAuth login, one product page.

______________________________________________________________________

## Part 3: Recovery

Migrations commit one revision at a time (`transaction_per_migration=True` in
`backend/alembic/env.py`), so a failed migrate leaves `alembic_version` at the last revision that
succeeded, and a re-run resumes from there. Fix forward where possible. One kind of revision
escapes that guarantee: see "A revision that builds an index concurrently" at the end of this part.

Every release stays published on GHCR under its version (unrelated to the alembic revision, which
names the schema), so rolling back is pulling an earlier tag. The package pages on GitHub list them.
`rollback` cannot cross the R9lab rename: an older release runs the `relab_prod` project. Fix
forward or restore from backup instead.

The api healthcheck tries `/livez` and falls back to `/live`, so a rollback to a release from
before the probe rename still turns healthy.

```bash
just stack prod rollback YES <tag>                    # code only: the new schema still suits the old code
just stack prod rollback YES <tag> <alembic-revision> # also downgrade the schema to that revision
```

With a revision, the recipe first checks that no migration in the range dropped or rewrote data
(`scripts.maintenance.downgrade_safety`). A downgrade would re-create such objects empty, so the
recipe refuses and points at the backup instead. A migration whose destructive statement is harmless
declares `ROLLBACK_SAFE = True`; without it the check fails closed, including on dynamic SQL it
cannot read.

The recipe then stops the API, runs `alembic downgrade` with the current release's migrator, writes
the earlier tag to `IMAGE_TAG`, and starts the stack. It pulls the earlier tag's images before any of
that, so a missing tag changes nothing. Find the revision with `cd backend && uv run alembic
history`. History was flattened at `a9c2e4f60b18` on 2026-09-08, so a schema rollback can only
target that id or a newer one.

**A rollback across a dropped column needs the revision form.** Code from before the drop still
reads the column, so a code-only rollback leaves it failing on every query that touches it.
Downgrade to the earlier release's head revision with it:

```bash
just stack prod rollback YES <tag> <revision>
```

If the downgrade itself fails, the rollback stops before switching images and says so: the API is
stopped, `IMAGE_TAG` still names the release you were leaving, and the schema sits at the last
revision that downgraded. `just stack prod up YES migrations` returns to that release; the printed
`rollback` line retries once the error is fixed.

Otherwise the backup is the recovery path:

```bash
just restore-check prod    # proves the snapshot loads: DB into a scratch container, uploads into a scratch dir
```

For a real restore, pick the snapshot and restore it into the live database:

```bash
just snapshots prod           # read-only; ids, dates, and dump sizes
just restore prod YES <id>    # stops the api, restores, replays erasures, restarts it; a failure leaves it stopped
```

Before the API starts again, the restore runs `scripts.maintenance.replay_erasures` in the migrator
image. The migrator entrypoint first brings the schema to the release's head. The replay then reads
the live erasure ledger together with the copy in the newest snapshot, and erases again every account
in either that the restored database still holds, through the same code path as a deletion in the
API. Accounts already gone are skipped, so running it again is harmless. An unreadable ledger line,
an account it cannot erase, or no ledger file at all fails the restore and leaves the API stopped;
the log names the line or the account id. An entry is written before its erasure commits, so an
erasure whose commit failed still has one, and a later restore erases that account.

A last line with no newline at its end is an append cut short by a power cut or a full disk. Its
erasure never committed, so the replay skips it with a warning. The next erasure ends that line,
and from then on it is reported like any other unreadable line. To clear a reported line:

1. Read it, with the line number from the log:
   `sudo sed -n '<line>p' "${BACKUP_HOST_DIR:-./backups}/erasure-ledger/erasures.jsonl"`. A bad
   line reported in the backup copy (`/run/erasure-ledger-backup/...`) is in the live ledger too;
   fix the live one.
2. Keep a copy: `sudo cp -p erasures.jsonl erasures.jsonl.bak` in that directory.
3. If the line holds a whole account id, rewrite it as a full record, so the replay erases that
   account: `{"user_id": "<id>", "content": "<anonymize or delete, as the line shows; anonymize if
   it does not>", "erased_at": "<the time on the next record>"}`. That person asked for the
   erasure, so erasing again is the safe side. With no whole id there is no account to name:
   delete the line.
4. Re-run the replay by hand as below (without `--empty-ok`), then `just stack prod up YES`.

On a host where no account was ever erased there is no ledger file yet, and the restore stops at the
replay. Confirm the ledger directory is the mounted backup disk (`findmnt -T
"${BACKUP_HOST_DIR:-./backups}/erasure-ledger"`), then finish by hand:

```bash
just stack prod compose --profile migrations run --rm --no-deps -T migrator \
    .venv/bin/python -m scripts.maintenance.replay_erasures --empty-ok
just stack prod up YES
```

Drop `--empty-ok` to re-run the replay by hand on any host, with `just stack prod compose stop api`
first.

These restore Postgres only. User uploads need a separate manual restore; see "Marker missing, and
the volume is genuinely empty" in 1.1.

Look at the sizes before choosing. `latest` is the default and is usually right, but it is wrong
when the most recent backup is the damage. `just restore` drops schema `public` and replaces it, so
it refuses to run without `YES`. It asserts that the restored database has rows, not merely tables,
before it reports success. It then re-runs `deploy/postgres/initdb/provision.sh`, because the
restore skips the dump's owners and grants (so a dump from before a role rename still loads). The
script hands ownership to the migration role and restores every grant. (`just stack <env> up` runs
the same script on every start, so a volume that predates a change to it converges on the next
release.)

### A revision that builds an index concurrently

The resume guarantee above has one exception. `CREATE INDEX CONCURRENTLY` cannot run inside a
transaction, so a revision that builds one commits the index on its own, in an
`autocommit_block()`, *before* the revision is stamped. A run that dies in that window leaves the
index built and the revision unstamped. Every re-run then fails with `relation "..." already
exists` and the migrator exits non-zero. The effect on the stack depends on how the migrator
failed. If it runs and exits non-zero, that is only a warning under `required: false`, so the stack
starts anyway on the older schema. If it never starts, `api` and everything behind it stay in
`created`. The first case is the quieter and more dangerous.

Two states are possible, and they need opposite responses. Check whether the index is valid:

```bash
docker compose -p r9lab_prod exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid"'
```

- **The index is listed: the build died partway.** The index is useless: the planner never uses it,
  every write still maintains it, and it holds the name the revision needs. Drop it and re-run.
- **Nothing is listed, but the migrate still fails on that name: the build finished and only the
  stamp was lost.** The schema is already what the revision wants. Dropping and re-running is still
  the safer of the two fixes, because it re-derives the state instead of asserting it; prefer it
  whenever the table is small enough to rebuild. Where a rebuild is not acceptable,
  `alembic stamp <revision>` records what is already true.

Either way, the drop must be concurrent too, and the re-run is the ordinary migrate:

```bash
just backup prod manual
docker compose -p r9lab_prod exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP INDEX CONCURRENTLY <index-name>"'
just stack prod migrate YES
```

The watchdog's schema-drift check (1.4) reports both states, so neither reaches a deploy
unnoticed.

### Rotating secrets

Secret files live under `secrets/prod/` (inventory: `deploy/env/variables.toml`, printed by
`just env-inventory`). Each service mounts only the files its process reads.

**An app secret:** replace the file under `secrets/prod/`, restart the affected service, and check
`/livez` and `/readyz`. Rotating `AUTH_TOKEN_SECRET` invalidates existing login, reset and
verification tokens. For an OAuth or email provider secret, rotate the upstream credential first,
then update the file, then restart `api`.

**A database role password:** change the PostgreSQL role password, update the matching file under
`secrets/prod/`, and restart the affected service (`api`, `migrator` or `backup`). To rotate the
Redis password, restart `redis` and its consumers, such as `api`.

**`DATA_ENCRYPTION_KEY` is break-glass material.** Older encrypted values and backups depend on the
previous key. Rotating it needs a planned re-encryption path and a check of backup retention.

**A secret that leaked outside its host:**

1. Revoke or rotate it upstream.
1. Update the host file or the root `.env` value.
1. Restart the affected services and run the health checks.
1. Record what was exposed and when.

Existing encrypted backups depend on the old key until their retention window passes. Never rotate
`restic_password` (1.1).

**Database roles:** `just stack prod up` runs `deploy/postgres/initdb/provision.sh`
against the live database before the API starts. It creates the roles, moves table ownership to the
migration role and installs the superuser-only extensions, so an existing volume needs no rebuild.
