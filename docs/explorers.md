# Document and crawl explorers

The console API uses a user's access token and server-side organization roles.
Search-only API keys cannot use these administrative routes. Viewers may inspect;
developers, admins and owners may edit rules, delete documents or request rebuilds.

## Documents

`GET /v1/console/indexes/:indexId/documents` browses PostgreSQL document metadata.
It accepts `q` (literal substring of ID/title/content), `status=live|deleted|all`,
`sourceId`, `limit` (1–100) and `after` (the last document ID). It orders IDs and
returns `nextAfter`; restart from the first page when changing filters. This is a
mutable metadata browser, not the lexical search endpoint or an index snapshot.
The actual search API continues to use custom postings and BM25.

`GET /v1/console/indexes/:indexId/documents/:documentId` compares the stored body
to the current active segment. `indexed` means they match; `pending` means stored
changes have not been activated; `deleted` means the database has a tombstone.
`inActiveVersion` separately reports whether the active index still contains it.
The response includes stored fields, active indexed fields and actual postings
with field, term frequency, document frequency and positions. Responses cap terms
at 500 and positions at 100 per term. Inspection scans the active dictionary and
is intended for debugging, not bulk export or the search hot path.

`DELETE /v1/console/indexes/:indexId/documents/:documentId` commits a tombstone,
audit event and rebuild outbox entry together, returning HTTP 202 and a job ID.
The UI asks for confirmation. Search uses the prior active index until a successful
replacement activates; failure or cancellation preserves that version.

`POST /v1/console/indexes/:indexId/rebuild` requests a background rebuild without
requiring a new document mutation. The dashboard tracks the returned job and
refreshes versions when it completes. Rebuilding uses the current stored corpus,
including previously committed changes from cancelled jobs.

## Sources and crawl pages

`PUT /v1/sources/:sourceId` accepts `name` and the complete crawl `config`.
It validates limits, bounded glob lists, HTTP(S) start URLs without credentials,
and allowed hostnames. robots.txt cannot be disabled. DNS/private-address checks
remain in the crawler transport. Each update records previous/current settings
under a source row lock. Running crawls retain their loaded settings; later
attempts load the edited source configuration.

`GET /v1/sources/:sourceId/pages` supports literal URL substring `q`, `jobId`,
`status`, `limit` and `cursor`. Supported statuses are indexed, unchanged,
blocked, failed, duplicate and skipped. Each row shows actual HTTP status,
response time, content type, canonical URL, crawl depth and errors where recorded.
It does not invent separate redirected rows when redirects were followed.

Pagination orders by creation timestamp and UUID. Cursors preserve PostgreSQL
microseconds and are bound to the source/query/status/job filters; mismatches
return 400. A source/time/ID database index supports the traversal. New pages
appear on the first page; older-page navigation does not repeat existing IDs.
The dashboard polls page progress every three seconds and escapes content/errors.
Document/crawl links allow only HTTP(S) without embedded credentials.

## Remaining work

Full browser E2E, document field editing, source deletion/cleanup, bulk exports,
ranking/settings/log workflows and richer analytics remain release work. The
metadata substring filter is not optimized for huge corpora; use the lexical
search API for retrieval.
