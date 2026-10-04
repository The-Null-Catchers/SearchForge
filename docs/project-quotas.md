# Project quotas

SearchForge stores project quota policy separately from usage counters. Admins and owners can configure monthly search/API/crawl-page limits, a maximum document count, and an in-product warning threshold. Viewers can inspect usage and warnings.

## Enforcement

API-key authenticated requests increment the current UTC month API-request counter after credential, expiration, IP, and per-key RPM validation. A configured monthly API-request limit is a hard 429 boundary. Search requests also increment the monthly search counter and stop with 429 when the search quota is exhausted. Counter increments and quota checks run in one PostgreSQL transaction so rejected over-limit increments roll back.

Document writes now enforce `maxDocuments` at write admission. Single-document and batch upserts serialize the project document-count check with a PostgreSQL advisory transaction lock, count only non-deleted documents in active indexes, and reject the whole request with 429 before mutation when new documents would exceed the configured ceiling. Updates to an already-active document do not consume another document slot, and duplicate ids inside a batch are rejected before persistence.

The Usage dashboard also reports crawl-page consumption. Hard monthly crawl-page enforcement remains separate because crawling is asynchronous worker work; the next boundary is crawl admission/reservation so concurrent crawls cannot oversubscribe the monthly allowance.

## Notifications

The API derives project notifications from current usage and the configured warning percentage. `warning` starts when usage reaches the threshold, while `exceeded` means the hard limit has been reached. These notifications contain aggregate counts only.

## Privacy

Quota records contain numeric limits and counters. They do not contain raw API keys, query text, IP addresses, document bodies, or user identifiers. Quota policy changes are audit logged with previous/current numeric settings.
