# Page fetch retries

Website sources accept `retryMaxAttempts` (1–5, default 3),
`retryBaseDelayMs` (100–10000, default 500) and `retryMaxDelayMs`
(100–30000, default 30000). Attempts include the initial fetch. Existing source
configurations receive defaults when parsed; the dashboard can edit these values.

Retries cover HTTP 408, 429, 500, 502, 503 and 504, bounded fetch timeouts and
explicit transient transport/DNS error codes. Permanent HTTP errors and
validation, SSRF, size and robots failures are not retried. Every attempt uses the
original URL and conditional headers and repeats safe DNS/redirect/robots checks
and crawl delay enforcement. The domain concurrency slot remains held during
backoff, bounding outstanding requests; limits are per crawler process.

Backoff is exponential with jitter. Valid Retry-After delta-seconds or HTTP dates
set a minimum wait. If Retry-After exceeds the configured maximum, no early retry
is sent: the final HTTP failure is recorded for a later recrawl. Waits check job
cancellation every 250 ms. In-flight fetch cancellation retains the existing
bounded request timeout semantics. A robots crawl-delay wait retains its existing
behavior, separate from retry backoff.

Retries do not increment the unique processed-page count or create duplicate
page/document rows. Exhausted HTTP failures retain their status, content type and
response time. Structured `crawl.page_retry` records include job/source/URL,
next attempt and wait. Completed crawl jobs can contain failed pages: job
completion means the crawl traversal finished, not that every page succeeded.

The frontier/backoff remains process-local. This is not a durable deferred-page
scheduler. Whole-job BullMQ retries can traverse previously fetched URLs again;
durable page checkpoints, dead-letter administration and fleet-wide origin
cooldowns remain follow-up work.

Unit tests cover backoff, Retry-After, attempt limits, transport classification,
security failure exclusion and cancellation. PostgreSQL/Redis integration uses
real HTTP 503 recovery, cancelled 429 backoff and exhausted plain-text failures.
