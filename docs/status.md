# Implementation status

SearchForge implements its own TypeScript lexical engine; no external search
engine is used. Rust/Go search nodes are future extensions, not implemented.

## Implemented and covered by local tests

- Arabic/English analyzers and positional postings with BM25.
- Phrase/prefix/typo search, flat filters, facets and safe highlight ranges.
- Immutable segment creation, corruption detection and exclusive publication.
- Authentication route contracts and secure refresh-cookie attributes.
- JavaScript SDK search, suggestions, indexing, clicks, cancellation and errors.
- URL normalization, private-network checks and robots parsing.
- Monorepo application builds and type checking.

## Implemented, integration verification required

- Registration, organizations/projects, project-scoped hashed keys.
- Refresh rotation serialized with row locks and family revocation on reuse.
- Job reads and SSE checked against organization membership.
- Async document indexing, version activation and rollback.
- Version allocation serialized across workers using PostgreSQL advisory locks.
- Migration runner and dependency ordering in Compose.
- Dart SDK search/filter/pagination/autocomplete/click/error handling.

CI includes isolated PostgreSQL/Redis integration tests and Dart tests. Docker
container builds, Compose startup and browser E2E still need explicit verification.

## Remaining before MVP release

- Incremental HTTP requests using stored ETag/Last-Modified; the crawler currently
  stores validators but does not yet send them on subsequent crawls.
- DNS-pinned crawler transport, strict redirect-domain/robots checks, bounded
  gzip sitemap expansion, per-page retries and reliable crawl-delay coordination.
- Scheduler, cancellation, transactional queue outbox and cleanup lifecycle.
- Compound AND/OR and date filters, query-bound cursors, normalized highlighting
  and efficient typo dictionaries for large vocabularies.
- Complete account recovery/verification UI, ranking/settings/logs workflows,
  index/document explorer and privacy-aware analytics charts.
- Key-specific/project quotas, expiration/IP configuration UI and notifications.
- Seed dataset, embeddable UI, backup scripts, OpenTelemetry, browser E2E,
  load tests with actual measured results, VPS restore rehearsal.

No performance numbers are claimed without a measured corpus and hardware profile.
