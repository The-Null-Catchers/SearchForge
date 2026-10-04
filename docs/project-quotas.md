# Project quotas

SearchForge stores project quota policy separately from usage counters. Admins and owners can configure monthly search/API/crawl-page limits, a maximum document count, and an in-product warning threshold. Viewers can inspect usage and warnings.

## Enforcement

API-key authenticated requests increment the current UTC month API-request counter after credential, expiration, IP, and per-key RPM validation. A configured monthly API-request limit is a hard 429 boundary. Search requests also increment the monthly search counter and stop with 429 when the search quota is exhausted. Counter increments and quota checks run in one PostgreSQL transaction so rejected over-limit increments roll back.

The Usage dashboard also reports crawl-page and document consumption. Hard admission enforcement for crawl-page and document ceilings is intentionally separate from the API/search request path because those writes are asynchronous worker operations; that enforcement must happen at crawl/index admission boundaries rather than in the dashboard.

## Notifications

The API derives project notifications from current usage and the configured warning percentage. `warning` starts when usage reaches the threshold, while `exceeded` means the hard limit has been reached. These notifications contain aggregate counts only.

## Privacy

Quota records contain numeric limits and counters. They do not contain raw API keys, query text, IP addresses, document bodies, or user identifiers. Quota policy changes are audit logged with previous/current numeric settings.
