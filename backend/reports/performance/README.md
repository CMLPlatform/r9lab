# Performance Reports

Short baseline summaries and comparison notes go here.

`just perf-baseline` writes the most recent machine-readable export to `latest-k6-summary.json`.

Name files like this:

- `YYYY-MM-DD-local-baseline.md`
- `YYYY-MM-DD-staging-baseline.md`

Each note holds:

- environment (`local`, `staging`, `prod-like`)
- commit or branch
- enabled `k6` scenarios
- key latency numbers (`avg`, `p95`)
- request failure rate
- notable caveats such as warm cache vs cold cache
