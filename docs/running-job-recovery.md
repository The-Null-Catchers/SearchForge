# Running job fencing and recovery

SearchForge treats PostgreSQL as the durable authority for crawl/index job ownership and uses BullMQ job IDs as execution fencing tokens.

## Claiming an execution

Every crawl/index delivery must claim the persisted job before doing work. The claim succeeds only when:

- the BullMQ `job.id` matches `jobs.external_job_id`,
- the durable job is queued (or failed and being retried by the same BullMQ delivery identity),
- cancellation has not been requested.

An old Redis delivery whose ID no longer matches the durable job is ignored instead of mutating terminal state.

## Heartbeats

Claimed crawl/index workers update `jobs.updated_at` every 15 seconds while the job remains `running` and the execution ID still matches. This makes loss of a worker observable without introducing a second lease table.

`RUNNING_JOB_STALE_SECONDS` controls when the dispatcher considers a running job stale. The default is 120 seconds and values below 30 seconds are rejected/fallback to the default.

## Recovery safety

A stale timestamp alone is not enough to replay work. Before recovery the dispatcher attempts to acquire the same PostgreSQL advisory transaction lock used by the processor:

- crawl: `source:<sourceId>`
- index build: `<indexId>`

If the advisory lock is still owned, the processor is treated as alive even when its heartbeat is stale. This is important for synchronous CPU-heavy indexing phases where the Node.js event loop may not run the heartbeat timer promptly.

Only after the execution lock is confirmed released does SearchForge:

1. rotate `external_job_id`, fencing the previous Redis delivery,
2. move the durable job back to `queued`,
3. clear stale terminal/error timing state,
4. reset the durable outbox row to undispatched,
5. let the normal outbox dispatcher deliver the new execution.

The old BullMQ delivery cannot claim the job again because its ID no longer matches the rotated execution ID. Failure/cancellation writes in crawler/indexer entrypoints are also conditioned on the current execution ID.

## Scope

Automatic stale-running recovery currently applies to crawl and index jobs. Cleanup jobs have different deletion semantics and remain governed by their existing durable cleanup receipt/retry flow.

This mechanism is intentionally separate from per-page crawl retry policy. Page fetches already have bounded transient retries, while durable deferred per-page retry scheduling remains follow-up work.
