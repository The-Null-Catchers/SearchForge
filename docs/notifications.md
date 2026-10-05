# Operational email notifications

SearchForge sends durable operational email alerts for project quota pressure and API key expiration when SMTP is configured.

## Recipients

Alerts are sent only to verified organization owners and admins for the affected project. Search-only, indexing, and admin API keys are all covered. Plaintext API key secrets are never stored or included in notifications; only the key name, kind, and visible prefix are referenced.

## Quota alerts

The notification sweep evaluates configured project quotas against current usage:

- monthly searches
- monthly API requests
- monthly crawl pages
- indexed document count

For monthly quotas, one warning is emitted per project, recipient, metric, and billing month when the configured warning percentage is reached. A second alert is emitted if the quota is later exceeded. Document-limit alerts are deduplicated against the configured limit and warning percentage rather than the month, so an unchanged long-lived document limit does not generate a new email every month.

## API key expiration alerts

Active API keys with an expiration timestamp are bucketed into:

- within 7 days
- within 1 day
- expired within the previous 24 hours

Each bucket is emitted at most once per recipient and key. Revoked keys and projects being deleted are ignored.

## Delivery durability

Candidate alerts are first recorded in PostgreSQL `notification_deliveries` using a unique deduplication key. Delivery claims use `FOR UPDATE SKIP LOCKED`, which allows multiple API replicas to run the sweep without concurrently sending the same receipt.

A claimed receipt moves through:

```text
pending -> sending -> sent
              |
              v
            failed -> sending
```

Failed deliveries use bounded exponential retry delays. A `sending` claim older than 15 minutes is considered interrupted and becomes retryable again. This keeps notifications recoverable across process restarts and SMTP outages without coupling email delivery to search or indexing request latency.

## SMTP behavior

The same `SMTP_URL` and `MAIL_FROM` settings used for account verification/password recovery are used for operational alerts. In non-production environments, when SMTP is not configured, the notification sweep is not started. Production configuration already requires SMTP for account security flows.

## Observability

The API exposes `searchforge_operational_notifications_total{result=...}` with results:

- `queued`
- `sent`
- `failed`

Structured logs are emitted only when a sweep has activity or fails. Notification payloads do not contain API secrets or indexed document bodies.

## Release validation

For a release environment, verify all three paths with a disposable owner/admin account:

1. Set a low quota and generate enough usage to cross the warning threshold, then the hard limit.
2. Create an API key expiring within seven days and another within one day.
3. Stop SMTP temporarily, confirm the receipt moves to `failed`, restore SMTP, and verify a later sweep moves it to `sent`.

Do not use production recipient addresses for destructive or load testing.
