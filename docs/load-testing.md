# Search load testing

SearchForge includes a dependency-free Node.js load harness for measuring the real HTTP search path through the deployed API.

It deliberately does not publish hard-coded performance claims. Results depend on corpus size, hardware, storage, network distance, analyzer configuration, synonyms, query mix, and concurrency.

## Run

Use a search-scoped API key for the project/index you want to measure:

```bash
SEARCHFORGE_LOAD_BASE_URL=https://search.example.com \
SEARCHFORGE_LOAD_API_KEY='sf_...' \
SEARCHFORGE_LOAD_INDEX=docs \
pnpm load:search
```

Defaults:

- 500 measured requests
- concurrency 10
- up to 25 warm-up requests
- 10 second request timeout
- 1% maximum error rate
- mixed English and Arabic query set
- JSON result at `artifacts/load/search-load.json`

## Tune the run

```bash
SEARCHFORGE_LOAD_REQUESTS=5000 \
SEARCHFORGE_LOAD_CONCURRENCY=25 \
SEARCHFORGE_LOAD_WARMUP=100 \
SEARCHFORGE_LOAD_TIMEOUT_MS=5000 \
SEARCHFORGE_LOAD_QUERIES='search,documentation,api,بحث,توثيق' \
SEARCHFORGE_LOAD_MAX_ERROR_RATE=0.01 \
SEARCHFORGE_LOAD_MAX_P95_MS=250 \
SEARCHFORGE_LOAD_OUTPUT=artifacts/load/vps-search.json \
pnpm load:search
```

`SEARCHFORGE_LOAD_MAX_P95_MS` is optional. When present, the process exits non-zero if observed p95 wall latency exceeds it. The process also exits non-zero when the configured error-rate threshold is exceeded.

## Report

The JSON report records:

- start/end timestamps and duration
- total throughput in requests/second
- successes, failures, and error rate
- HTTP status distribution
- error-code distribution
- wall-clock p50/p95/p99/max latency
- engine-reported p50/p95/p99/max `processingTimeMs` when available
- exact run configuration and threshold result

The report never stores the API key.

## Release evidence

For portfolio/release evidence, run this against the target VPS using a representative corpus and save the resulting JSON with the hardware/corpus description. Keep CI smoke tests separate from performance claims: hosted CI runners are useful for regression checks, but they are not a stable benchmark environment.

Before a high-volume run, verify project search quotas and per-key rate limits are configured to allow the intended traffic. The harness uses the real authenticated search endpoint, so normal quota/rate-limit enforcement remains active.
