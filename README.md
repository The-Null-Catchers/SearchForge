# SearchForge

SearchForge is a developer-focused search platform that **crawls, analyzes, indexes, ranks, and searches content**. It is deliberately not a CRUD wrapper around a hosted search vendor: the repository contains its own language analyzers, inverted index, BM25 scorer, prefix/typo candidate generation, immutable index version model, crawler safety layer, job pipeline, SDKs, and observability.

```text
Website / Documents
        ↓
      Crawler
        ↓
     Extractor
        ↓
     Analyzer
        ↓
    Index Builder
        ↓
  Search Engine
        ↓
 REST / SDK / UI
```

## Architecture

```mermaid
flowchart LR
  WEB[Next.js Dashboard] --> API[Fastify API]
  SDK[JS / Flutter SDKs] --> API
  API --> PG[(PostgreSQL)]
  API --> REDIS[(Redis)]
  API --> CORE[Search Core]
  CRAWL[Crawler] --> REDIS
  REDIS --> WORKER[Workers]
  WORKER --> CORE
  WORKER --> OBJ[(S3 / MinIO)]
  CORE --> SEG[(Immutable Segments)]
  PROM[Prometheus] --> API
  PROM --> CRAWL
```

## What is implemented

- Multi-tenant data model for users, organizations, projects, memberships, sources, indexes, versions, jobs, API keys, analytics, and audit logs.
- Secure auth primitives: Argon2id passwords, refresh-token rotation/reuse detection model, verification/reset tokens, rate-limit hooks.
- Website crawler primitives with robots.txt, sitemap parsing, URL normalization, redirect checks, size/content-type limits, SSRF/private-network protection, and content deduplication.
- English + Arabic analyzers, configurable Arabic normalization, light stemming, field-aware inverted index, positional postings, BM25, phrase matching, prefix search, typo-aware term expansion, filters, facets, safe highlight ranges, autocomplete, and explain output.
- BullMQ queues for crawl/fetch/extract/normalize/index/merge/analytics/cleanup.
- Atomic index-version activation and rollback semantics in metadata.
- REST API, JavaScript SDK, Dart SDK, dashboard, health/readiness, Prometheus metrics, structured errors, request IDs, Docker Compose, and CI.

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

The one-shot migration service applies checked-in SQL before the API and workers
start. Open `http://localhost` through Caddy; browser API requests use the same
origin. Register, create an organization and project, then add a website or use
a private indexing key to push documents. Keep returned API keys somewhere safe;
plaintext keys are returned only once.

Add metrics and dashboards with:

```bash
docker compose --profile observability up --build
```

MinIO console: `http://localhost:9001`  
Grafana: `http://localhost:3001`

For host-based development, publish PostgreSQL and Redis using the development
override described in [docs/development.md](docs/development.md), then build,
migrate and run the apps. See [docs/deployment.md](docs/deployment.md) before
configuring a VPS.

## Search request

```http
POST /v1/indexes/docs/search
Authorization: Bearer sf_search_...
Content-Type: application/json

{
  "query": "distributed systems",
  "filters": {"category": "docs"},
  "facets": ["category"],
  "limit": 20
}
```

## Engineering targets

Targets are intentionally not published as achieved benchmarks. Use `tests/load` against your own hardware and dataset and publish p50/p95/p99 with corpus size, index size, CPU/RAM, and concurrency.

- low-millisecond autocomplete from a hot cache
- sub-100 ms typical lexical search on moderate indexes
- bounded per-domain crawl concurrency
- zero-downtime index activation

## Security defaults

Crawler access to loopback, link-local, RFC1918, IPv6 local/private ranges, credential-bearing URLs, non-HTTP schemes, and unsafe redirects is denied by default. API keys are represented by a visible prefix plus a one-way digest; plaintext secrets are returned once only.

See [docs/security.md](docs/security.md) and [docs/architecture.md](docs/architecture.md).

## Roadmap

MVP focuses on lexical retrieval. The core exposes boundaries for sharding, replica selection, vector stores, hybrid fusion, external source connectors, and ranking experiments without making them mandatory.

## SDKs and demo corpus

See [SDK usage](docs/sdk.md), [demo and benchmarks](docs/benchmarking.md) and
[implementation status](docs/status.md). SDK packages are not published yet.

Job delivery, scheduled recrawls and cancellation: [job lifecycle](docs/job-lifecycle.md).

Inspecting stored content and crawl results: [explorers](docs/explorers.md).

Permanent index removal and retry semantics: [safe index deletion](docs/index-deletion.md).

Source erasure and retained version fencing: [safe source deletion](docs/source-deletion.md).
