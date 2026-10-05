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
login page successfully. Real Chromium dashboard smoke coverage is now included in container CI.

## Job lifecycle additions

- Transactional PostgreSQL outbox for document indexing and crawl admission.
- Durable hourly/6-hour/daily/weekly schedules with overlap prevention.
- Tenant/role-controlled queued and cooperative running cancellation.
- Sources dashboard schedule controls, cancellation and live polling.
- Regression scenarios added to PostgreSQL/Redis integration CI.
- Queued-job recovery after acknowledged Redis job loss, rotating bounded checks,
  concurrent dispatchers and Redis outage retries. Running-job recovery still
  requires processor fencing; terminal tasks are excluded from automatic replay.
- Failed crawl/index jobs are exposed through a project dead-letter view and can be
  transactionally re-queued by admins while durable outbox metadata is retained.
- Operator retries allocate a fresh BullMQ job ID, reject overlapping source/index work,
  and are audited without copying failure text into audit metadata.

See docs/job-lifecycle.md and docs/job-recovery.md for delivery, cancellation and recovery boundaries.

## Explorer additions

- Document browser with filters/pagination and real active segment inspection.
- Stored-versus-active state, positional terms and safe document previews.
- Confirmed deletion and asynchronous audited rebuilds.
- Editable crawl rules, crawl-page filters and query-bound keyset pagination.
- Durable developer document field editing with immutable-segment rebuilds.
- Viewer/developer permissions, bounded URL/rule/document validation and safe links.
- 37 local unit tests plus additional integration regression scenarios.

See docs/explorers.md and docs/document-editing.md. Integration/container CI verifies the expanded workflow.

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

## API key and quota controls

- Admin-managed expiration timestamps and exact IPv4/IPv6 allowlists.
- Redis-backed per-key requests-per-minute enforcement in addition to the global API limiter.
- Project monthly API/search/crawl quotas and max-document admission controls.
- PostgreSQL serialization prevents concurrent API writers or crawler workers from oversubscribing configured limits.
- Dashboard usage warnings and API-key active/expiring/expired/revoked states are available in-product.
- Control changes are audited without persisting or disclosing raw secrets.

See docs/api-key-controls.md and docs/project-quotas.md for enforcement and privacy boundaries.

## Demo seeding

- Idempotent local demo seeding creates two isolated organizations and projects.
- Seeded roles exercise owner/developer/viewer tenant boundaries.
- English and Arabic synonym sets are included.
- Analytics includes repeated queries, clicks, zero-result searches, latency variation and a low-frequency query below the disclosure threshold.
- Production execution is blocked unless explicitly opted in.

See docs/demo-seed.md.

## Embeddable search UI

- Framework-independent static browser embed served from the web application.
- Debounced autocomplete with keyboard navigation and accessible listbox semantics.
- Safe text-only result rendering, HTTP(S)-only result links, and best-effort click analytics.
- Automatic Arabic/English direction switching plus CSS custom-property theming.
- Browser integration explicitly rejects embedded admin/indexing keys and requires search-scoped keys.

See docs/embeddable-search.md.

## Backup and recovery tooling

- Consistent snapshots cover PostgreSQL, immutable index data, and MinIO object storage.
- Writers are quiesced during backup and only previously-running services are restarted.
- Backup sets include manifests and SHA-256 checksums.
- Restore rehearsal uses isolated PostgreSQL/container volumes and does not overwrite production data.
- Redis is intentionally excluded because durable queue/outbox state is authoritative in PostgreSQL.

See docs/backup-restore.md. A measured VPS restore rehearsal is still release evidence work.

## OpenTelemetry tracing

- API requests emit sampled OTLP/HTTP server spans when tracing is configured.
- Valid W3C `traceparent` headers preserve upstream trace IDs and sampling decisions.
- Trace attributes are privacy-bounded and exclude queries, bodies, credentials, user IDs, document bodies, and IP addresses.
- Export is asynchronous, bounded, timeout-controlled, and fails open so collector outages do not block requests.
- The observability Compose profile includes a pinned OpenTelemetry Collector with OTLP gRPC/HTTP receivers.

See docs/observability.md.

## Browser release smoke

- A real Chromium flow runs against the built Docker Compose stack through Caddy.
- CI seeds deterministic demo tenants and signs in through the actual browser form.
- Dashboard overview, tenant project loading, theme switching, keyboard command palette, Analytics navigation, and authenticated reload are checked.
- Unexpected page exceptions fail the job.
- Success/failure screenshots and JSON results are uploaded as short-retention CI artifacts.

See docs/browser-e2e.md.

## Search load measurement

- A dependency-free load harness targets the real authenticated search endpoint.
- It records throughput, error rate/status distribution, wall-clock p50/p95/p99/max latency, and engine-reported processing latency.
- Concurrency, warmup, timeout, bilingual query mix, error thresholds and optional p95 thresholds are configurable.
- Structured JSON evidence is produced without persisting API keys.

See docs/load-testing.md. Measured VPS results still require a representative deployed corpus and hardware description.

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
  deferred retries remain follow-up work.
- Processor fencing/recovery for ambiguous running jobs after worker loss remains; terminal failed crawl/index jobs now have operator dead-letter/retry controls while their outbox metadata is retained.
- External quota/expiration notification delivery remains; in-product warnings are implemented.
- Load tests with actual measured VPS results and VPS restore rehearsal remain release evidence work.

No performance numbers are claimed without a measured corpus and hardware profile.

## Deletion lifecycle

Owner-only project deletion now fences all project writes, revokes keys, drains source/index processors, removes immutable index storage and project-owned data, and retains only a scrubbed tombstone, durable cleanup receipt and security audit trail. See [project deletion](project-deletion.md).

Confirmed, admin-only index deletion fences writes and drains builders before file/metadata erasure. Source deletion fences crawling, queues replacement builds, prevents rollback resurrection and purges obsolete segment files while preserving other documents. See [index deletion](index-deletion.md). The current local suite passes 50 unit tests; PostgreSQL/Redis scenarios verify producer draining, storage failure/retry, delivery recovery and retained-segment inspection in CI.
