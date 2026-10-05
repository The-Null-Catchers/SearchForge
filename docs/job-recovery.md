# Failed job recovery

SearchForge treats terminal crawl/index failures as operator-visible dead-letter work instead of silently discarding them.

## List failed jobs

Project developers and above can inspect retained failures:

```http
GET /v1/projects/:projectId/jobs/dead-letter?limit=50
Authorization: Bearer <access-token>
```

The response includes the persisted job state/error plus whether its durable outbox metadata is still available for retry.

## Retry

Project admins and owners can retry a failed crawl or index job:

```http
POST /v1/jobs/:jobId/retry
Authorization: Bearer <access-token>
```

Retry is transactional. SearchForge:

1. locks the failed job and retained outbox entry,
2. rejects non-failed or non-retryable job types,
3. refuses a retry when another crawl/build for the same source/index is already active,
4. allocates a new BullMQ external job ID so an old terminal Redis record cannot collide with the retry,
5. clears terminal error/timing/cancellation state,
6. resets the durable outbox entry to undispatched,
7. records an audit event without copying the previous error message into audit metadata.

The normal durable dispatcher then delivers the retry. A Redis outage during the API request therefore does not lose the accepted retry.

## Retention boundary

Retry depends on the durable outbox entry still existing. Terminal outbox rows are currently retained for seven days by the bounded retention process. Once that metadata is purged, the historical failed job remains visible but is reported as non-retryable through this endpoint.

This operator retry path covers terminal crawl/index jobs. Processor fencing for replaying ambiguous `running` jobs after worker loss and durable per-page deferred crawl retries remain separate reliability work.
