# Source deletion and retained index safety

Owners/admins can delete a source from the Sources dashboard. Type its exact name to confirm. The API requires a user access token:

```http
DELETE /v1/sources/:sourceId
Authorization: Bearer <access-token>
Content-Type: application/json

{"confirmation":"Documentation website"}
```

Admission returns `202 {jobId, sourceId, state: "deleting"}`. Poll `GET /v1/jobs/:jobId`; the dashboard lists cleanup progress and exposes confirmed retry when the receipt fails. Cleanup cannot be cancelled once accepted.

## Admission

A transaction disables the recrawl schedule, marks the source disabled/deleting, cancels its queued/running crawl/build jobs, and persists an outbox cleanup task and audit event. Repeated requests return the same receipt. Exhausted failures can be retried with the same confirmation; delivery gets a fresh BullMQ ID while the saved plan survives.

Every project index receives a minimum version sequence above its highest existing version. This conservatively invalidates rollback to older versions even if source documents were previously tombstoned or overwritten. Source deletion therefore retires rollback history for all indexes in that project, not just indexes currently containing live source documents. Indexers reject publication below this floor; manual activation reads/checks the current target again under the index advisory lock.

Database triggers fence document, crawl-page, schedule and job writes against a deleting source. The indexer excludes deleting-source documents when loading its corpus. Admission preserves lock ordering: schedule, indexes in UUID order, source, jobs. Crawler completion locks index/source before the job. Each crawler holds a source advisory lock for its full lifetime, coordinating retry processes and deletion.

## Durable cleanup phases

1. Acquire the source advisory lock, draining any old crawler still fetching/extracting.
2. Delete source-owned document rows and atomically save replacement index job IDs with their outbox tasks. Heavy indexing runs in the existing index worker, not HTTP or cleanup code.
3. Wait for a safe active version. The previous version stays searchable during replacement. Source content can still appear until the replacement activates; deleting the source is complete only when cleanup finishes.
4. Under each index's builder advisory lock, remove published/temporary files below its version floor and delete their version metadata. Require the active version to meet the current floor before purging. If the index is itself deleting, collect all its files after draining its builder; index cleanup owns that index's metadata receipt.
5. Remove crawl pages/schedules and the source record, complete the durable receipt and retain an audit event. Other sources and pushed documents remain indexed.

The cleanup receipt remains transactionally queued while rebuilding so lost Redis deliveries can be recovered. Its committed child plan prevents duplicate rebuilds after process replacement; retries replace failed/cancelled children. Waiting for activation is bounded to five minutes per attempt, followed by the normal queue retry policy. A storage error leaves the marker and plan in place; old versions remain ineligible for activation even if some files have already been removed. Restarting the processor is idempotent.

Crawler upserts now update source ownership when a different source produces the same canonical document. API upserts clear source ownership so explicitly pushed replacements survive source deletion.

## Limits

The index files live on the shared `INDEX_STORAGE_PATH`; the storage root is trusted operator configuration. Purging a live index refuses a symlink directory. Old cached/in-flight snapshots may remain in API memory until eviction or restart, but deleted rollback versions cannot be reactivated. Backups, historical analytics and Redis payload retention are not erased by this endpoint. Project deletion remains separate work.

Deploy the migration with API/crawler/indexer/worker updates together. New crawl lifetime locks protect cooperating updated workers; drain old worker binaries before accepting deletion requests.

Integration CI covers a real crawler blocked in HTTP, a builder blocked after persistence, rollback rejection, late-write rejection, lost child delivery recovery, storage failure, explicit retry, preserved source/API ownership and physical retained-segment inspection.
