---
title: Secrets and rotation
description: What R9lab encrypts, where its secrets are kept, and what rotating each one means.
---

Access control protects most R9lab data. Application-level encryption covers only values the
backend must read back later. The commands to rotate a secret are in
[`deploy/DEPLOY-PROD.md`](https://github.com/CMLPlatform/r9lab/blob/main/deploy/DEPLOY-PROD.md).

## What is encrypted

Passwords are hashed. Public research records, uploaded media, public r9cam keys, request IDs and
cache keys are not encrypted by the application.

`DATA_ENCRYPTION_KEY` encrypts values the backend must recover, such as OAuth provider tokens and
active YouTube broadcast keys. `CACHE_SIGNING_SECRET` signs cache payloads. `OAUTH_STATE_SECRET`
signs OAuth state. Each key has one purpose.

## Where secrets live

| Where               | What it holds                                    |
| ------------------- | ------------------------------------------------ |
| `infra/cloudflare/` | Public edge configuration                        |
| `deploy/`           | Committed, non-secret runtime identity           |
| Root `.env`         | Host-local operator inputs                       |
| `secrets/<env>/`    | Uncommitted secret material, one file per secret |

Secrets never go in committed files or backend env files. Each service mounts only the files its
process reads. The API does not get the migration or backup role password, or the bootstrap
superuser password. The application, migration and backup roles are separate PostgreSQL users, and
the application role does not own the schema.

## What rotation means

- Rotating an app secret means replacing its file and restarting the service. Rotating
  `AUTH_TOKEN_SECRET` signs everyone out.
- Rotating a database or Redis password means changing it in the service and in its file.
- `DATA_ENCRYPTION_KEY` is break-glass material. Older encrypted values and backups depend on the
  previous key, so rotating it needs a planned re-encryption path.
- A leaked secret is treated as compromised: rotate it upstream first.
