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
- Queued-job recovery after acknowledged Redis job loss, rotating bounded checks,
  concurrent dispatchers and Redis outage retries. Running-job recovery still
  requires processor fencing; terminal tasks are excluded.

See docs/job-lifecycle.md for delivery semantics and cancellation boundaries.

## Explorer additions

- Document browser with filters/pagination and real active segment inspection.
- Stored-versus-active state, positional terms and safe document previews.
- Confirmed deletion and asynchronous audited rebuilds.
- Editable crawl rules, crawl-page filters and query-bound keyset pagination.
- Durable developer document field editing with immutable-segment rebuilds.
- Viewer/developer permissions, bounded URL/rule/document validation and safe links.
- 37 local unit tests plus additional integration regression scenarios.

See docs/explorers.md and docs/document-editing.md. Integration/container CI verifies the expanded workflow.
Browser E2E remains separate release work.

## Analytics correctness

Search and click consistency: search and click recording now respect `analyticsEnabled`.
Clicks referencing search events must belong to the authenticated project and
match the event query. Search/explain share enabled synonyms; explain ignores
pagination so it can inspect a matching document outside the requested page.
The analytics dashboard exposes loading/errors/retry and rejects stale responses
after project changes. Daily search/click/zero-result/latency charts use aggregate
UTC buckets, while query text is suppressed until the exact query reaches the
configured privacy threshold in the selected reporting window. Disabling analytics
stops new records; it does not erase historical records.

## Recent search-core completion

- Compound AND/OR filter expressions with backward-compatible flat filters.
- Numeric and ISO-date comparisons/ranges.
- Cursors bound to both index version and semantic search request.
- Analyzer-aware safe highlight ranges for normalized Arabic and typo-expanded matches.

## Typo dictionary completion

- Immutable segments now persist a bounded deletion dictionary for typo candidate pruning.
- Search generates deletion keys per query and runs edit-distance scoring only on dictionary candidates.
- Legacy segments without the dictionary rebuild it once when loaded, preserving backward compatibility.
- Regression tests guard against full vocabulary iteration on typo queries.

## Remaining before MVP release

- Crawl retries are implemented for transient page fetch failures; durable per-page
  deferred retries and operator retry/dead-letter controls remain follow-up work.
- Dead-letter/recovery administration for terminal Redis failures; terminal outbox retention is implemented.
- Key-specific/project quotas, expiration/IP configuration UI and notifications.
- Full tenant/synonym/analytics seeding, embeddable UI, backup scripts, OpenTelemetry, browser E2E,
  load tests with actual measured results, VPS restore rehearsal.

No performance numbers are claimed without a measured corpus and hardware profile.

## Deletion lifecycle

Owner-only project deletion now fences all project writes, revokes keys, drains source/index processors, removes immutable index storage and project-owned data, and retains only a scrubbed tombstone, durable cleanup receipt and security audit trail. See [project deletion](project-deletion.md).

Confirmed, admin-only index deletion fences writes and drains builders before file/metadata erasure. Source deletion fences crawling, queues replacement builds, prevents rollback resurrection and purges obsolete segment files while preserving other documents. See [index deletion](index-deletion.md) and [source deletion](source-deletion.md). The current local suite passes 50 unit tests; PostgreSQL/Redis scenarios verify producer draining, storage failure/retry, delivery recovery and retained-segment inspection in CI.
