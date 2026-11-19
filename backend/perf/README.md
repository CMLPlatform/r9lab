# Backend Performance Baseline

A small `k6` suite that catches latency regressions in common backend paths and the camera relay.

## Covered Scenarios

| Scenario            | Path           | Enabled when                                   |
| ------------------- | -------------- | ---------------------------------------------- |
| `live_probe`        | `/livez`       | always                                         |
| `product_list_read` | `/v1/products` | always                                         |
| `product_search_read` | `/v1/products?search=` | always                                     |
| `product_detail_read` | `/v1/products/{id}` | always                                        |
| `product_components_read` | `/v1/products/{id}/components` | always                            |
| `reference_data_read` | `/v1/materials` | always                                            |
| `bearer_login`      | auth login     | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |
| `media_url_read`    | media URL      | `PERF_MEDIA_URL` set                           |
| `product_create_write` | `POST /v1/products` | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |
| `image_upload_write` | `POST /v1/products/{id}/images` | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |
| `r9cam_ws_connect` | camera relay WebSocket handshake | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |
| `r9cam_telemetry_relay` | `GET .../cameras/{id}/telemetry?force_refresh=true` | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |
| `r9cam_hls_relay` | `GET .../cameras/{id}/hls/{segment}` | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |
| `r9cam_capture` | `POST .../cameras/{id}/captures` | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |
| `r9cam_preview_upload` | `POST .../device/cameras/{id}/preview-thumbnail-upload` | `PERF_USER_EMAIL` and `PERF_USER_PASSWORD` set |

`just docker-ci-perf-baseline` fills the gated inputs itself. It reads the first seeded product's
`thumbnail_url` from the running stack into `PERF_MEDIA_URL`. If the database holds no seeded
images, it fails instead of silently skipping media coverage.

## How the Suite Is Shaped

Five choices decide what the numbers measure.

**Scenarios run one at a time, not together.** Each stage starts after the previous one finishes
(`PERF_STAGE_SECONDS`, then a `PERF_STAGE_GAP_SECONDS` gap). Overlapping them would measure
contention, not endpoint cost: `bearer_login` spends 50-100ms per request inside Argon2, and CI runs
a single API worker, so a concurrent login stage inflates the tail of every other request in
flight. Isolated stages also vary far less between runs, so the thresholds below can sit close to
observed latency without flaking.

**Load is open-model.** Scenarios use `constant-arrival-rate`, so `k6` holds the request rate steady
whatever the server does. A closed model (`constant-vus` plus `sleep`) sends *less* load as latency
grows, which hides the regressions this suite exists to catch. `dropped_iterations` has a
threshold because an open-model run that cannot start iterations on time means a saturated server.

**The write stages run last, uploads last of all.** `product_create_write` inserts rows, so the
read stages run against a table that is not growing. `image_upload_write` posts through the real
multipart path, so it decodes an image and writes derivatives. It is by far the slowest endpoint in
the API. Malware scanning is not exercised, because the CI stack does not run ClamAV.

Iterations rotate through three photo sizes. Each is tagged `upload_size` and has its own
threshold, because a percentile mixed across all three hides which one moved:

| `upload_size` | dimensions  | source                                                |
| ------------- | ----------- | ----------------------------------------------------- |
| `small`       | 1200x900    | `perf/fixtures/upload-sample.jpg`, committed          |
| `medium`      | 2400x1800   | tiled from the sample by `just perf-fixtures`         |
| `large`       | 4800x3600   | tiled from the sample by `just perf-fixtures`         |

One size is not enough. At 1200x900 the 1600px derivative is skipped and only about 21ms of
thumbnail work runs, so a regression in the expensive part of the pipeline would not move the
number. From `medium` up, every standard width applies, and the derivative work takes about
110-130ms instead of about 20ms.

The two larger sizes are tiled from the committed sample, not upscaled or generated. Tiling repeats
the source's own frequency content, so decode, resize and encode cost per pixel stay in the range
of a real photograph. They are gitignored, and `just perf-fixtures` rebuilds them. Both perf
recipes run it first. The whole set comes from one 87 KB source, so no multi-megabyte binaries
enter the repo.

The per-size thresholds are a coarse guard. Two runs of the same commit on GitHub runners put
`small` at 69 ms and 31 ms, so run-to-run variance is over 2x. A ceiling tight enough to catch
an increase of about 40-50 ms in the derivative work would flap on that variance. These thresholds catch only
a gross regression. To measure the resize path itself, run it directly, without a network and a
shared runner in the number.

**The camera relay runs after every other stage.** The device opens a long-lived WebSocket, and
user requests reach the camera as frames over that socket. An HTTP latency number alone cannot see
it, so for the relay a regression is any of these:

- **Connection setup**: `ws_connecting` p95 in `r9cam_ws_connect`. Each iteration signs a fresh
  device assertion and opens a socket, so this measures the handshake plus the ES256 verification,
  the replay check in Redis and the camera lookup.
- **Round-trip latency**: `http_req_duration` p95 of a relayed request. `r9cam_telemetry_relay`
  carries a small JSON response, `r9cam_hls_relay` an 87 KB binary frame, and `r9cam_capture`
  the full capture path: the relayed command, the device's image push and the stored image.
- **Dropped or failed relay**: `http_req_failed` in those stages. A lost frame or a dead socket
  surfaces as a 503 once the relay times out.

k6 simulates the camera itself. It does not use `scripts/plugins/r9cam/webcam_fake_camera.py`,
which needs a webcam and predates device assertions. `setup()` registers a camera with a fresh P-256
key, and the fake device signs the same ES256 assertion a paired Pi does, so the auth path is the
real one. One device VU holds the relay socket open for the three relayed stages and answers their
commands. It runs from halfway through the gap before them to halfway through the gap after. The
backend keeps one socket per camera. If the device connected earlier, a straggling connect-stage
socket could replace it. If it closed earlier, the last capture still in flight would fail.

`r9cam_preview_upload` needs no socket. It is the device-side HTTP push of a preview thumbnail.
The suite runs one camera and does not measure concurrent cameras. WebSocket authentication is
rate-limited outside `dev` and `testing`, so run the relay stages against the CI stack, not a
deployed backend.

`product_search_read` rotates its query terms, so the run does not measure one cached query. It is
the slowest read path.

**The database is not empty, and neither is any other table.** `BULK_SEED_PRODUCTS` scales the
fixtures (5000 products by default in CI) through `scripts/seed/bulk_seed.py`. The script scales
users, product types, materials and categories with the product count. It gives a fifth of the
products an image and a tenth a component subtree. Against the handful of rows the dummy seed
creates, the suite could not detect the regressions that hurt: a missing index, a linear
`COUNT(*)`, an eager load that degrades with row count.

Rows come from `scripts/seed/factories`, the polyfactory and faker factories the test suite also
uses, so the rows a baseline measures and the fixtures a test asserts against cannot drift apart.
Generating the full set takes about 12 seconds and the seeder is idempotent, so no pre-built dump
needs to stay in sync with the schema. The generator spreads `created_at` over two years and draws
high-cardinality names, brands and models, because those columns are trigram-indexed and feed
`search_vector`. A short word list would make those indexes far more selective than production.

The script then runs `VACUUM ANALYZE`. Without it, the run measures the database recovering from
the fixture load, not steady state: planner statistics still describe an almost empty table, and
the four GIN indexes on `product` carry a full pending list. That cleanup showed up as a 6.5s p95
in the write scenario, against a 55ms median.

## Thresholds

The thresholds are regression tripwires, not capacity targets. Refresh them from a summary export
with `just _perf-thresholds-apply <headroom>`. Do not edit them by hand.

The committed values carry roughly 5x headroom over an isolated run on a quiet developer host. That
absorbs a slower shared CI runner and still catches a real regression.

The `r9cam_*` thresholds come from two isolated runs of the CI stack on a developer host, not a
GitHub runner. Treat them as provisional until the next workflow artifact refreshes them.

## Recommended Target

Run the baseline against the Docker CI stack, which runs the backend in `testing` with the committed
credentials from `backend/.env.test`:

```bash
just docker-ci-perf-baseline           # 5000 seeded products
just docker-ci-perf-baseline 20000     # or pick a row count
```

Local runs against a host-reachable backend are distorted by laptop CPU contention and Docker
overhead. Calibrate committed thresholds from the GitHub Actions perf workflow, not from a
developer host.

## Usage

Run against a host-reachable backend:

```bash
just perf-baseline
```

Enable login coverage:

```bash
PERF_USER_EMAIL=user@example.com \
PERF_USER_PASSWORD=secret \
just perf-baseline
```

Enable media URL coverage when you have a sample uploaded media URL:

```bash
PERF_MEDIA_URL=https://api-test.r9lab.io/uploads/images/sample.webp \
just perf-baseline
```

Target a non-local backend:

```bash
BASE_URL=https://api-test.r9lab.io \
just perf-baseline
```

## Useful Environment Variables

- `BASE_URL`
- `PERF_PRODUCT_LIST_PATH`
- `PERF_LIVE_PATH`
- `PERF_USER_EMAIL`
- `PERF_USER_PASSWORD`
- `PERF_MEDIA_URL`
- `PERF_STAGE_SECONDS`: duration of each scenario stage (default `20`)
- `PERF_STAGE_GAP_SECONDS`: idle gap between stages (default `5`)
- `PERF_SEARCH_TERMS`: comma-separated query terms the search scenario rotates through
- `PERF_DETAIL_RATE`, `PERF_COMPONENTS_RATE`, `PERF_REFERENCE_RATE`, `PERF_UPLOAD_RATE`
- `PERF_PRODUCT_LIST_RATE`, `PERF_LIVE_RATE`, `PERF_LOGIN_RATE`, `PERF_MEDIA_RATE`,
  `PERF_SEARCH_RATE`, `PERF_CREATE_RATE`: requests per second per scenario
- `PERF_R9CAM_CONNECT_RATE`, `PERF_R9CAM_TELEMETRY_RATE`, `PERF_R9CAM_HLS_RATE`,
  `PERF_R9CAM_CAPTURE_RATE`, `PERF_R9CAM_PREVIEW_RATE`: the same, for the camera stages

## Recommended Baseline Inputs

- Use `just docker-ci-perf-baseline`, so the database is migrated, dummy-seeded and topped up to a
  realistic row count first.
- `live_probe` and `product_list_read` must stay runnable. The script must also pass with no media
  URL, so `PERF_MEDIA_URL` stays optional even though the CI recipe always supplies one.
- Use `/v1/products?size=20` as the product-read baseline.
- Use the CI superuser from `backend/.env.test` for login measurements.
- The `k6` image is pinned by digest. A moving `:latest` would change the measurement tool between
  runs, and a latency baseline must hold that fixed.

## Capacity

The baseline catches regressions. It does not say how much load the deploy can take.
`perf/k6-capacity.js` answers that, and it drops the choices that keep the baseline stable: all
operations overlap, the rate keeps climbing, and nothing has a threshold.

```bash
just docker-perf-capacity           # mixed workload
just docker-perf-capacity login     # logins only
PERF_CAPACITY_RATES=200,300,400 just docker-perf-capacity   # pick the steps
```

The recipe runs from the repo root under its own Compose project (`r9lab_capacity`, or
`COMPOSE_PROJECT_NAME`), so it never touches the CI stack. It layers `perf/compose.capacity.yaml`
over the CI stack to match the deploy shape: four workers, a pool of 3 + 10 overflow per worker,
`max_connections=100`, a 6 GiB API memory cap and a concurrency limit of 100 per worker. It seeds
5000 products and 50 verified accounts, runs k6, and removes the stack and its volumes on exit.

The arrival rate climbs in steps (`ramping-arrival-rate`, a 5 s ramp, then a 30 s hold). The script
prints one row per hold: target and achieved rate, p50, p95 and p99, and the error rate. The knee is
the last row before errors or a shortfall appear. The mixed workload is 30% list, 15% search, 20%
detail, 10% components, 10% materials, 2% login, 9% product create and 4% photo upload (the three
upload sizes above). Logins and writes rotate across the 50 accounts. With a single account, every
login and upload would queue on one user row, and the result would measure that row lock.

### Results, 2026-09-27

Measured on a shared development host, not production hardware: Intel i9-14900KF (32 threads),
62 GiB RAM, with other stacks idle alongside. The API is not CPU-capped, and Argon2 releases the GIL,
so logins can use more than the four worker cores. Treat the absolute numbers as an upper bound.
The shape of the curve and the first resource to saturate carry over to other hosts.

| Mixed target/s | p50 ms | p95 ms | p99 ms | errors |
| -------------- | ------ | ------ | ------ | ------ |
| 100            | 13     | 153    | 331    | 0%     |
| 200            | 157    | 469    | 638    | 0%     |
| 300            | 214    | 708    | 1202   | 0%     |
| 400            | 67     | 1276   | 30058  | 42%    |

The same mixed run after the auth dependencies began to share the request session (one connection
per authenticated request), with other test suites running on the host at the same time:

| Mixed target/s | p50 ms | p95 ms | p99 ms | errors |
| -------------- | ------ | ------ | ------ | ------ |
| 200            | 96     | 341    | 451    | 0%     |
| 300            | 165    | 382    | 615    | 0%     |
| 400            | 203    | 580    | 1041   | 0%     |
| 500            | 173    | 2823   | 4691   | 34%    |

The knee moves from about 300 to about 400-450 requests/s. Past it, the p99 stays in seconds and
does not hit the 30 s pool timeout.

| Login target/s | p50 ms | p95 ms | p99 ms | errors |
| -------------- | ------ | ------ | ------ | ------ |
| 100            | 28     | 38     | 78     | 0%     |
| 200            | 187    | 445    | 695    | 0%     |
| 300            | 401    | 791    | 1103   | 0%     |
| 400            | 1124   | 2190   | 3083   | 21%    |

- **Mixed knee: about 400-450 requests/s** (about 300 before the shared auth session). At one
  request every 5-10 s per active person, that is roughly 2000-4500 people working at once.
  Latency starts to queue from about 200/s.
- **The connection pool saturates first, not the CPU.** At 400/s, all 52 pool connections sat
  `idle in transaction` while API CPU fell back to about two cores. The p99 of 30 s is the
  SQLAlchemy pool timeout. Postgres itself peaked at about 1.5 cores. The auth dependencies used to
  open a session of their own, so an authenticated route that also took `AsyncSessionDep` held two
  connections. Under pool pressure, requests that held one connection waited for a second until the
  timeout, so past the knee throughput collapsed instead of degrading. The auth dependencies now
  share the request session.
- **Logins: about 300/s before queueing turns into errors.** The Argon2 threadpool (40 tokens per
  worker) was never the limit. The two limits were CPU, with the API at about 16 cores at 400/s,
  and the per-worker concurrency limit of 100, which returned the 503s. Each login also holds a
  pool connection during the hash. On a host with fewer cores, expect roughly 25-30 logins/s per
  free core.

Before a workshop, check the per-IP rate limits against the room. The limiter keys on client IP,
and a room on one network usually shares one public address. Then 3 logins/min, 5
registrations/hour and 300 reads/min apply to everyone in the room together. Neither this test nor
the CI stack exercises the limits, because they are off in `testing`.

Not covered: malware scanning (the deploy scans uploads with ClamAV), Cloudflare and the tunnel in
front of the API, the telemetry exporter, and hosts with fewer cores than the four workers need.

## Recording Results

`just perf-baseline` writes a raw `k6` summary to `reports/performance/latest-k6-summary.json`
(gitignored).

To recalibrate thresholds:

1. Run the `Performance Baseline` workflow with `workflow_dispatch`.
1. Download the `ops-backend-perf-baseline` artifact.
1. Run `just _perf-thresholds-apply <headroom>` against that summary export.
1. Commit the thresholds. Put key numbers in the PR description, not in dated report files.
