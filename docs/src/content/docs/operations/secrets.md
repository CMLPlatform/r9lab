---
title: Secrets and rotation
description: Where R9lab keeps secrets, which values are encrypted, and how to rotate or replace them.
---

Access control protects most R9lab data. Application-level encryption covers only values the
backend must read back later.

## What is encrypted

Passwords are hashed. Public research records, uploaded media, public r9cam keys, request IDs and
cache keys are not encrypted by the application.

`DATA_ENCRYPTION_KEY` encrypts values the backend must recover, such as OAuth provider tokens and
active YouTube broadcast keys. `CACHE_SIGNING_SECRET` signs cache payloads. `OAUTH_STATE_SECRET`
signs OAuth state. Each key has one purpose.

## Where secrets live

| Where                  | What it holds                                       |
| ---------------------- | --------------------------------------------------- |
| `infra/cloudflare/`    | Public edge configuration                           |
| `deploy/`              | Committed, non-secret runtime identity              |
| Root `.env`            | Host-local operator inputs                          |
| `secrets/<env>/`       | Uncommitted secret material, one file per secret    |
| `scripts/`             | Repo-wide helpers too large for the root `justfile` |

Backend dotenv files are for local and test use only. Prod and staging do not read backend
`.env.<env>` files.

The secret files cover the backend app secrets, the database role passwords, the Redis password,
the restic repository password and an optional rclone config. They are gitignored. Each service
mounts only the files its process reads. The API does not get the migration or backup role
password, or the bootstrap superuser password.

`deploy/env/variables.toml` is the source-controlled inventory of these files. Run
`just env-inventory` from the repo root when you onboard a host or review a secret-file change.

## Database roles

The application, migration and backup roles are separate PostgreSQL users. The application role
does not own the schema.

`just stack prod up` and `just stack staging up` run `deploy/postgres/initdb/provision.sh` against
the live database before they start the API. The script creates the roles, moves table ownership
to the migration role and installs the superuser-only extensions. The same script runs from
`/docker-entrypoint-initdb.d` on an empty volume, so an existing volume needs no rebuild.

## Rotate an app secret

1. Replace the file under `secrets/<env>/`.
1. Restart the affected service.
1. Check `/livez` and `/readyz`.

Rotating `AUTH_TOKEN_SECRET` invalidates existing login, reset and verification tokens. For OAuth
or email provider secrets, rotate the upstream credential first, then update the file, then
restart `api`.

## Rotate a database password

1. Change the PostgreSQL role password.
1. Update the matching file under `secrets/<env>/`.
1. Restart the affected service: `api`, `migrator` or `backup`.

To rotate the Redis password, restart `redis` and its consumers, such as `api`.

## Break-glass

`DATA_ENCRYPTION_KEY` is break-glass material. Older encrypted values and backups depend on the
previous key. Rotating it needs a planned re-encryption path and a check of backup retention.

If a secret leaks outside its host:

1. Revoke or rotate it upstream.
1. Update the host file or the root `.env` value.
1. Restart the affected services and run the health checks.
1. Record what was exposed and when.

Existing encrypted backups depend on the old key until their retention window passes.
