# Setting up a host

The steps that take an empty prod or staging host to a running stack. Then continue with Part 1 of
[DEPLOY-PROD.md](DEPLOY-PROD.md) or [DEPLOY-STAGING.md](DEPLOY-STAGING.md) for backups, scheduled
jobs and telemetry. [Deployment and operations](https://docs.r9lab.io/operations/deployment/)
describes the topology these steps produce.

The stack runs on one host behind a Cloudflare Tunnel, so the host needs no public ports. Every
command runs as `just stack <prod|staging> <command>`. A command that changes state takes `YES` to
confirm which host it acts on. The examples use `prod`.

______________________________________________________________________

## 1. Tunnel and edge

`infra/cloudflare/` manages the DNS records, the tunnels, the ingress rules and the GitHub
Environments. Its [README](../infra/cloudflare/README.md) lists the credentials, the API token
scopes and the state encryption passphrase. With those exported:

```bash
just cloudflare-check
just cloudflare-plan prod
just cloudflare-apply prod       # plans and saves it; review the diff
just cloudflare-apply prod YES   # applies the plan you just reviewed
```

Apply only against a new zone, or after you import the existing DNS records, tunnels and rulesets
into state (the README's import workflow). Otherwise the apply duplicates DNS records and creates
a second tunnel whose token does not match `secrets/<env>/cloudflare_tunnel_token`. It can also
overwrite existing rulesets, because each Cloudflare phase allows one ruleset per zone.

Copy the tunnel token: step 3 puts it in a secret file. Run the Deploy Sites workflow for the
environment before the apply that gives the Workers their hostnames; the README lists the order.

## 2. The root `.env`

```bash
cp .env.example .env
```

The root `.env` is gitignored and holds every host-local value Compose interpolates. One host
serves one environment. `.env.example` describes every key. The required ones:

- `ENVIRONMENT`: `prod` or `staging`. `just stack` refuses to run against a host whose `.env` says
  otherwise.
- `API_PUBLIC_URL`, `APP_PUBLIC_URL`, `SITE_PUBLIC_URL`, `DOCS_PUBLIC_URL`: the four public origins.
- `IMAGE_TAG`: written by `just stack prod tag YES <tag>` (step 5).
- `GOOGLE_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_ID`: OAuth client IDs for social login.
- `EMAIL_PROVIDER` and the sender fields. With `smtp`, also fill `SMTP_HOST`, `SMTP_USERNAME` and
  `secrets/<env>/smtp_password`. With `microsoft_graph`, fill the tenant, client and sender values
  and `secrets/<env>/microsoft_graph_client_secret`. Backend startup validates the provider you
  chose.
- `BOOTSTRAP_SUPERUSER_EMAIL`: the first admin account. The migrator creates it with the password
  in `secrets/<env>/bootstrap_superuser_password`.
- `MALWARE_SCAN_ENABLED`: `true` starts ClamAV with the stack (step 5).

With `ENVIRONMENT=prod`, migrations reject `SEED_DUMMY_DATA=true` or `BULK_SEED_PRODUCTS` greater
than zero before running Alembic or Python.

Upload quotas: `MAX_UPLOAD_FILES_PER_USER` and `MAX_UPLOAD_BYTES_PER_USER_MB` cap `contributor`
accounts, and the `*_LAB_USER*` pair caps `lab` accounts and must not be lower. The quota counts
existing rows, so on a host with existing data, raise the limits before the first start: an owner
already above the limit cannot upload at all. A superuser promotes lab members with
`PUT /v1/admin/users/{user_id}/role` and the body `{"role": "lab"}`.

Per-image caps: `MAX_IMAGE_UPLOAD_SIZE_MB` and `MAX_IMAGE_UPLOAD_PIXELS` cap `contributor` images
(10 MB, 12.6 MP), and the `_LAB` variants cap `lab` images (20 MB, 24 MP). No pixel cap may exceed
50 MP. An image takes about 6 bytes per pixel of memory while it is processed (about 145 MB at
24 MP), so size `IMAGE_RESIZE_WORKERS` x `WEB_CONCURRENCY` against the backend's memory limit
before raising a pixel cap.

## 3. Runtime secrets

```bash
just deploy-secrets-template prod
```

Replace every placeholder under `secrets/prod/`, and paste the tunnel token from step 1 into
`secrets/prod/cloudflare_tunnel_token`. Runtime secrets (database passwords, the auth token secret,
the restic password, the tunnel token, provider secrets) live only there, never in `.env`.
`deploy/env/variables.toml` is the inventory; `just env-inventory` prints it.

## 4. Validate

```bash
just compose-config         # the Compose overlays render for every environment
just deploy-secrets-check   # every secret file exists, has mode 0644 in a 0700 dir, and is not a placeholder
```

## 5. First start

Pull a published tag (DEPLOY-PROD Part 2 says where tags come from), then start with the
`migrations` profile, which runs the migrator first and starts the API only after it exits 0:

```bash
just stack prod tag YES <tag>   # pulls every image, then writes IMAGE_TAG to .env
just stack prod up YES migrations
```

ClamAV needs about 3 to 4 GiB of extra RAM. Its signature database persists in the `clamav_db`
volume, and the first boot with an empty volume takes several minutes to download it. With
`MALWARE_SCAN_ENABLED=false`, uploads are stored unscanned.

To also seed the CPV or HS taxonomies, run the migrator once by itself:

```bash
BACKEND_MIGRATIONS_INCLUDE_TAXONOMY_SEED_DEPS=true just stack prod migrate YES
```

## 6. Verify

`/live` on the API is the shallow process check that Compose uses; `/health` also checks
PostgreSQL and Redis. Log in as the bootstrap superuser and enrol two-factor authentication in the
account settings: the `/admin` routes refuse a superuser without it. Then try one upload, and read
`just stack prod logs`.

Before you rely on the host, set up backups: DEPLOY-PROD Part 1.1.
