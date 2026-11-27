# Measured disposable CI baseline

Source commit: `00cf674fff8f8456b9f2f962e793c49951d44d85`. GitHub-hosted Ubuntu runner, November 21, 2026 UTC. [CI run 44933442056](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44933442056) and [container-smoke job log](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44933442056/job/136934848037).

## Method

The CI job built and started the development Docker Compose stack, seeded the reserved synthetic tenants, imported eight documents, exercised Chromium search and index rollback, then measured authenticated HTTP search. The load client and services shared the same runner. The load harness sent 20 warmup requests and 120 measured requests with five concurrent clients. The query mix was `javascript`, `distributed systems`, `محرك بحث` and `تطبيع النص العربي`.

| Measure | Actual result |
| --- | ---: |
| Successful requests | 120/120 |
| Error rate | 0% |
| Throughput | 215.76 requests/s |
| p50 wall latency | 22.02 ms |
| p95 wall latency | 31.98 ms |
| p99 wall latency | 38.74 ms |
| Maximum wall latency | 43 ms |

## Recovery

The same run reported eight restored live documents, one active index (version 1), matching immutable segment hashes, a verified restored MinIO test object and a successful offline Arabic query returning the expected `search-ar` document (two total hits).

All four CI jobs passed: Node build/unit/relevance/typecheck/migrations/integration, security baseline, Dart SDK analysis/tests, and Compose/Chromium/load/recovery.

The original [recovery artifact](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44933442056/artifacts/14719155499) contains the raw load report, CPU/memory/Docker Compose context, restoration output and checksums; [browser artifact](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44933442056/artifacts/14718533354) contains genuine captures and result JSON. Artifact retention is limited (30 and 14 days respectively). Hardware details are not transcribed here because the printed CI summary did not contain them.

## Limits

These are historical measurements of one tiny synthetic dataset on a disposable runner, not final-head or VPS measurements, production SLOs, index-building throughput, or an estimate of performance on larger corpora. The target VPS has not been authorized for deployment or load. Repeat the documented workflow on an isolated representative deployment before release claims. Final-head screenshots, hardware metadata, indexing duration and deployment-specific evidence must still be collected and reviewed.
