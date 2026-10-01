# Safe index deletion

Administrators and owners can permanently remove an index from the index explorer. Type its exact slug in the confirmation prompt. The API accepts the same explicit confirmation:

```http
DELETE /v1/console/indexes/:indexId
Authorization: Bearer <user-access-token>
Content-Type: application/json

{"confirmation":"docs"}
```

The response is `202` with `jobId`, `indexId`, and `state: deleting`. Search, autocomplete, explain, document inspection, version listing and new writes stop using the index as soon as admission commits. Requests already executing may finish with their previously loaded snapshot. This operation removes every version, including rollback versions, and cannot be cancelled after acceptance.

## Admission and fencing

One PostgreSQL transaction locks the index row, checks the current slug and permissions, sets `deletion_requested_at`, cancels pending/running builds, writes a cleanup job and outbox entry, and records an audit event. Repeated requests while deleting return the same job. Exhausted cleanup jobs can be retried by sending the same confirmed deletion request; it resets delivery with a new BullMQ ID.

Database triggers take a transaction-scoped SHARE lock on the parent index before document writes, version insertion and build-job insertion. Admission takes UPDATE on that same row: producers already admitted finish before the marker, and later producers cannot resurrect data. This fence applies to API producers and crawlers, rather than depending on an earlier HTTP authorization/read. Activation takes the index row lock before the job lock to avoid the inverse lock order with deletion.

## Background cleanup

The cleanup worker takes the same PostgreSQL advisory lock as the index builder. It waits until any old builder has finished writing files. It validates the durable job's project, target, type and deletion marker before filesystem access. Only UUID index directory names are accepted; unsupported project/source targets fail explicitly. A target symlink is unlinked rather than traversed.

Files are removed before the metadata transaction commits. A filesystem or database error leaves the deletion marker and durable receipt available for retry; deleting the same folder again is safe. Document/version rows cascade with the index, index-associated search events and their attributed clicks are removed, and a completion audit event is retained. Jobs remain as receipts with their index foreign key cleared by PostgreSQL. The worker reports retry errors and exhausted attempts on that receipt. Poll `GET /v1/jobs/:jobId` for completion.

The outbox dispatcher can recover a lost queued cleanup task after Redis delivery loss. Cleanup remains transactionally queued while waiting for the builder lock, so replay is fenced by the lock and completed receipt. This requires the worker to share `INDEX_STORAGE_PATH` with the API and indexer, as in Compose.

## Limits and next steps

- This release deletes indexes, not projects or sources. Those require their own producer fencing and source-content removal from every retained segment; unsupported queue targets now fail instead of claiming success.
- Deleting the default `docs` index makes website crawling unavailable for that project until an index with that slug is provisioned. General index creation and configuration UI remains a separate roadmap item.
- API process caches may retain inaccessible snapshots until eviction or process restart. Backups and retained Redis job payloads follow their existing retention policies; this endpoint is not a backup erasure API.
- Clicks without an attributed search event cannot be reliably assigned to an index and remain in project analytics. Aggregate project usage counters remain unchanged.
- The tests exercise row-lock admission, rejected late writes, blocked cleanup under the builder lock, collection of a late file, filesystem failure rollback, tenant checks, repeated delivery, retained audit receipts and unrelated index availability using real PostgreSQL/Redis in CI.
