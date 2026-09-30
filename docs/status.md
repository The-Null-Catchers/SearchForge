# Implementation status

SearchForge implements its own TypeScript lexical engine; no external search
engine is used. Rust/Go search nodes are future extensions, not implemented.

## Implemented and covered by local tests

- Arabic/English analyzers and positional postings with BM25.
- Phrase/prefix/typo search, flat filters, facets and safe highlight ranges.
- Immutable segment creation, corruption detection and exclusive publication.
- Authentication route contracts and secure refresh-cookie attributes.
- JavaScript SDK search, suggestions, indexing, clicks, cancellation and errors.
- Shared browser refresh coordination (concurrent/late 401 regression tests).
- URL normalization, private-network checks and robots parsing.
- DNS-pinned HTTP transport, redirect checks and bounded gzip sitemap parsing.
- Monorepo application builds and type checking.

## Verified by PostgreSQL/Redis integration CI

- Registration, organizations/projects, project-scoped hashed keys.
- Refresh rotation serialized with row locks and family revocation on reuse.
- Job reads and SSE checked against organization membership.
- Async document indexing, version activation and rollback.
- Version allocation serialized across workers using PostgreSQL advisory locks.
- Migration runner and dependency ordering in Compose.
- Incremental conditional recrawl with stored links for 304 responses.
- Dart SDK search/filter/pagination/autocomplete/click/error handling (CI passed).

Integration CI passed registration, tenant isolation, async indexing, bilingual search,
rebuild/rollback, incremental crawling and refresh-token reuse detection. Dart analysis
and three SDK tests passed. The latest local run and CI passed 30 unit tests, builds and
type checking.

Account recovery/verification pages and container startup still require end-to-end
verification. All container images built successfully in CI, including the pinned MinIO
source build. Explicit IPv4 loopback health probes fixed the Compose startup failure.
CI run 36715821234 passed all four jobs: Node build/unit/types/integration, Dart,
security baseline and full container smoke. Caddy routed API readiness and the
login page successfully. Browser E2E remains release work.

## Job lifecycle additions

- Transactional PostgreSQL outbox for document indexing and crawl admission.
- Durable hourly/6-hour/daily/weekly schedules with overlap prevention.
- Tenant/role-controlled queued and cooperative running cancellation.
- Sources dashboard schedule controls, cancellation and live polling.
- Regression scenarios added to PostgreSQL/Redis integration CI.

See docs/job-lifecycle.md for delivery semantics and cancellation boundaries.

## Remaining before MVP release

- Per-page crawl retries.
- Cleanup lifecycle and outbox retention/recovery administration.
- Compound AND/OR and date filters, query-bound cursors, normalized highlighting
  and efficient typo dictionaries for large vocabularies.
- Complete ranking/settings/logs workflows,
  index/document explorer and privacy-aware analytics charts.
- Key-specific/project quotas, expiration/IP configuration UI and notifications.
- Full tenant/synonym/analytics seeding, embeddable UI, backup scripts, OpenTelemetry, browser E2E,
  load tests with actual measured results, VPS restore rehearsal.

No performance numbers are claimed without a measured corpus and hardware profile.
