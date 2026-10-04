# Project quotas

SearchForge stores project quota policy separately from usage counters. Admins and owners can configure monthly search/API/crawl-page limits, a maximum document count, and an in-product warning threshold. Viewers can inspect usage and warnings.

## Enforcement

API-key authenticated requests increment the current UTC month API-request counter after credential, expiration, IP, and per-key RPM validation. A configured monthly API-request limit is a hard 429 boundary. Search requests also increment the monthly search counter and stop with 429 when the search quota is exhausted. Counter increments and quota checks run in one PostgreSQL transaction so rejected over-limit increments roll back.

Document writes enforce `maxDocuments` at write admission. Single-document and batch upserts serialize the project document-count check with a PostgreSQL advisory transaction lock, count only non-deleted documents in active indexes, and reject the whole request with 429 before mutation when new documents would exceed the configured ceiling. Updates to an already-active document do not consume another document slot, and duplicate ids inside a batch are rejected before persistence.

Monthly crawl-page quotas are enforced in PostgreSQL at the durable `crawl_pages` persistence boundary. An `AFTER INSERT` trigger resolves the source project, serializes reservations per project and UTC month with an advisory transaction lock, increments `usage_counters.crawl_pages`, and raises an exception when the configured monthly allowance would be exceeded. Because the trigger runs only after a row is actually inserted, crawler `ON CONFLICT DO NOTHING` retries do not double-count usage. Robots-denied URLs are excluded because they never reach the content page fetch path; fetched pages count whether they are indexed, unchanged, skipped by content type, duplicates, or failed after an attempted fetch.

The over-limit exception rolls back both the crawl-page row and its counter increment, and propagates out of the crawler worker so concurrent crawl jobs cannot oversubscribe the monthly allowance.

## Notifications

The API derives project notifications from current usage and the configured warning percentage. `warning` starts when usage reaches the threshold, while `exceeded` means the hard limit has been reached. These notifications contain aggregate counts only.

## Privacy

Quota records contain numeric limits and counters. They do not contain raw API keys, query text, IP addresses, document bodies, or user identifiers. Quota policy changes are audit logged with previous/current numeric settings.
