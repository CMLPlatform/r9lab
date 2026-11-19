---
title: Telemetry and monitoring
description: How prod and staging ship logs, traces and metrics, and what to watch for.
---

Prod and staging can ship logs, traces and metrics to a central monitoring stack outside this
repository. Dev and CI ship nothing.

## Turn it on

Set these in the root `.env`. All three must be set together. `just deploy-secrets-check` enforces
this.

| Variable                      | What it does                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Switches on the backend's OTLP export and the `compose.telemetry.yml` overlay                                        |
| `OTLP_AUTH_TOKEN`             | The collector's bearer token. Alloy reads it directly. Compose folds it into the SDK's header format for the backend |
| `TELEMETRY_EDGE_KEY`          | A second credential that the edge in front of the collector expects                                                  |

`OTEL_EXPORTER_OTLP_PROTOCOL` defaults to `http/protobuf`. The collector sits behind a tunnel that
routes HTTPS only. Hosts without these variables ship nothing.

Keep monitoring endpoints behind a tunnel or a private network. Never expose the monitoring stack
to the public internet. With telemetry on, only the authenticated OTLP endpoint is reachable, and
no Loki push hostname is exposed.

## What Alloy collects

The Alloy overlay ships container stdout from every other service, plus host metrics: CPU, memory,
load, disk, network and `hwmon` temperatures.

- Alloy never touches the Docker socket. A `docker-socket-proxy` container holds it and exposes
  only the read-only endpoints that discovery and log tailing need. It refuses POST.
- Alloy mounts the host's `/proc`, `/sys` and `/` read-only for node metrics. It runs as root with
  capabilities dropped to `SYSLOG` and `DAC_READ_SEARCH`.
- On a host with an NVIDIA card, `GPU_METRICS=1` adds `compose.telemetry.gpu.yml` and GPU metrics
  under the same `host_name`.

## Operating notes

- Redis serves caching and parts of the authentication and token flow. A partial Redis outage has
  user-facing effects.
- Scaling and secret rotation are manual. The Compose setup trades automation for a single VPS.
- For scheduled jobs and the watchdog, see [Backups and recovery](/operations/backups/#scheduled-work).
