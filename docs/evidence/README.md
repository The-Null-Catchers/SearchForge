# Portfolio measurements

## Local HTTP and indexing

Application revision `aaec7fc3a450bf033cadba98a5e12aca0ae7eaed`, measured 2026-11-27T13:27:47.039Z.
The load client, Caddy, Fastify, workers, PostgreSQL 17.12 and Redis 7.4.9 shared
an Omarchy 4.5.0 Linux host with an Intel Core i5-1035G1, eight logical CPUs,
and 16,528,609,280 bytes of RAM. Node was
`v22.23.5`. These services ran natively. Docker was used
for the separate CI verification below. The four queries were
`javascript`, `distributed systems`, `محرك بحث`, and `تطبيع النص العربي`.
Each workload sent eight warmup requests. The 45 measured requests split 12/11/11/11 across the queries in that order.

| Documents | Index bytes | Concurrency | Successes | Error rate | Requests/s | p50 ms | p95 ms | p99 ms | Max ms | Run ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 56,032 | 1 | 45/45 | 0% | 37.56 | 26.20 | 29.35 | 34.17 | 34.17 | 1198.16 |
| 8 | 56,032 | 12 | 45/45 | 0% | 58.02 | 171.28 | 300.33 | 343.46 | 343.46 | 775.59 |
| 800 | 1,141,653 | 1 | 45/45 | 0% | 33.72 | 29.61 | 34.35 | 37.68 | 37.68 | 1334.45 |
| 800 | 1,141,653 | 12 | 45/45 | 0% | 58.91 | 178.99 | 276.08 | 347.00 | 347.00 | 763.92 |

Import-to-completion took 866 ms for eight documents and
1,332 ms for 800 documents. The corresponding worker job
times were 71 ms and 289 ms.
The separate browser run took 604 ms from import
to completed job, 3,528 ms from edit to changed search
result, 378 ms from clicking Activate to API
acknowledgement, and 1,577 ms until the restored
search result appeared. Browser timings include polling or UI work and exclude
the deliberate pause for recording.

[Raw local measurements](local-synthetic/) · [Browser receipt](../images/portfolio/result.json) · [Reproduce](../benchmarking.md)

## Disposable Docker and recovery

The first PR run at `febb35186c6884308731fb8802e576e145ec83dc` used Ubuntu
26.04.1 LTS, an AMD EPYC 7763 with four logical CPUs, 16,759,431,168 bytes of
RAM, Docker Engine 29.4.2 and Compose 5.1.3. It indexed the original eight
documents into 56,032 bytes. With five concurrent clients and 20 warmups,
120 of 120 measured search requests succeeded at 143.91 requests/s.
Wall latency was 33.91 ms p50, 45.24 ms p95, 49.16 ms p99 and 53.29 ms maximum.
The measured request window was 833.87 ms.

Backup took 15,301 ms, and the isolated restore took 7,692 ms. The job
restored eight live documents and one active index, matched segment hashes,
retrieved the MinIO probe object, and returned `search-ar` from the restored
active segment with networking disabled. The [first PR run](https://github.com/The-Null-Catchers/SearchForge/actions/runs/46004341121)
and [current PR checks](https://github.com/The-Null-Catchers/SearchForge/pull/87/checks)
publish the environment, checksums and raw receipts.

The [earlier main benchmark](../portfolio-baseline.md) is preserved separately.
The native workloads and GitHub-hosted workloads ran on different hardware
and topologies. The measurements describe only the stated synthetic scenarios.
