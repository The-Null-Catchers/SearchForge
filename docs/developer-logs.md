# Developer logs

SearchForge exposes persisted project-scoped operational history at:

`GET /v1/projects/:projectId/logs`

The endpoint requires an authenticated organization member with viewer access or higher. It deliberately reads durable PostgreSQL records instead of pretending that stdout from every container is already centralized.

## Sources

The first release combines two durable sources:

- **Audit events**: security and configuration mutations, request IDs, targets, and non-secret metadata.
- **Job events**: crawl/index/cleanup lifecycle state, phase, progress, error code, and error message.

Job failures are returned at `error` level, cancellations at `warn`, and the remaining persisted events at `info`.

## Filters

Supported query parameters are:

- `kind=all|audit|job`
- `level=all|info|warn|error`
- `q=<text>` for event names, targets, request IDs, job types/phases, and stored job errors
- `limit=1..200`

The dashboard requests at most 100 rows and cancels stale requests when the selected project or filters change.

## Correlation and privacy

The UI displays request IDs for audit entries and durable job IDs for job entries so an operator can correlate a dashboard event with structured service logs. API keys and refresh tokens are never stored in these records. This endpoint is project-scoped and enforces tenant membership before querying records.

This workflow is not a replacement for centralized stdout/stderr aggregation. Production deployments can still attach Loki, OpenSearch, or another log backend to container output; the persisted developer log view remains useful for product-level audit and job history even when an external backend is unavailable.
