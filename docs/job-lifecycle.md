# Durable jobs and recrawls

The general worker service must run alongside crawler/indexer processes. Every
two seconds it checks persisted crawl schedules and dispatches pending outbox
entries. It reports dispatch failures in structured logs and retries on later
ticks. Multiple general workers use PostgreSQL `FOR UPDATE SKIP LOCKED` to divide
work without choosing a leader. Producers lock each source when admitting crawls.

## Transactional enqueue

Document mutations, their index job, and its outbox entry commit together. Crawl
completion and the resulting index job commit together. API acceptance means
PostgreSQL persisted the task, even when Redis is temporarily unavailable.

The dispatcher delivers at least once: each retry uses the persisted BullMQ job
ID, so a crash after Redis accepts a job but before PostgreSQL acknowledges it
does not duplicate the queued task. Completed processors also check durable job
state. The dispatcher also checks acknowledged outbox rows whose durable task is
still queued, at most 25 per tick, with a 30-second interval between checks. If
the BullMQ record disappeared it restores the same ID and payload. Checks rotate
by last-check time, including healthy records, so paused queues cannot starve
lost tasks. Concurrent dispatchers lock rows with `SKIP LOCKED`; queue outages
roll back check timestamps and retry on a later tick. Recovery emits a structured
warning with checked/recovered counts.

Redis must remain persistent. Automatic recovery covers queued tasks only;
running tasks are excluded because replay after loss of their Redis lock requires
processor fencing. Cancelled, completed and failed tasks are never resurrected.
An existing Redis record is left alone even if it reports failure: terminal-state
reconciliation and dead-letter administration remain future work. Outbox rows
must be retained until their durable job finishes; retention/archival is pending.

## Schedules

`PUT /v1/sources/:sourceId/schedule` requires a developer role or higher:

```json
{ "enabled": true, "intervalSeconds": 86400 }
```

Allowed intervals are 3600, 21600, 86400 and 604800 seconds. Editing or enabling
resets the next run to one interval from now. Disabling prevents future scheduled
runs; it does not cancel an already accepted crawl. Missed runs coalesce into a
single crawl after downtime. An existing queued/running crawl is reused, so
manual and scheduled requests do not overlap for one source. Schedule timestamps
are UTC; the dashboard presents them in the viewer's local timezone.

## Cancellation

`POST /v1/jobs/:jobId/cancel` requires a developer role or higher in the job's
organization. Another organization's job returns 404. Queued tasks become
cancelled immediately; running tasks persist a cancellation request and stop at
the next safe boundary. Repeated cancellation is idempotent. Finished tasks
return `409 JOB_FINISHED`.

Crawls stop between pages/batches and after bounded HTTP requests; already
in-flight requests finish within their timeout. Index builds check before
analysis, persistence and activation. Synchronous analysis is cooperative at
phase boundaries, not interruptible in the middle of its CPU loop. Activation
and cancellation lock the same job row: one wins atomically, so a cancelled
build cannot activate its candidate index. Failed candidate segments remain
inactive and can be cleaned up later.

Cancellation does not undo document writes that already committed. Crawled or
pushed documents can be included in a later successful rebuild. The active
search version remains available. Realtime SSE remains supported by the API;
the sources dashboard refreshes persisted progress every three seconds.

## Verification

The PostgreSQL/Redis integration suite covers replay after interrupted dispatch,
single BullMQ job identity, recovery after acknowledged Redis job deletion,
concurrent recovery, existing record deduplication, recovery after Redis outage,
running/cancelled exclusion, tenant denial, repeated/queued/running cancellation,
cancellation after segment persistence but before activation, schedule persistence
across dispatcher replacement, concurrent ticks, overlap prevention, disabled
schedules and interval validation. These checks use real database/queue/file
operations with explicit fault injection, rather than snapshots.
