# Safe project deletion

Project deletion is an owner-only destructive workflow. The caller must type the
project slug exactly:

```http
DELETE /v1/projects/:projectId
Authorization: Bearer <user-access-token>
Content-Type: application/json

{"confirmation":"my-project"}
```

Admission returns `202` with a durable cleanup `jobId`. The project disappears
from normal dashboard/project access immediately. Existing project API keys stop
authenticating as soon as admission commits.

## Admission and fencing

The admission transaction preserves the existing producer lock order: index
rows, source rows, then the project row. After the project lock is acquired it
re-reads children, so a source or index admitted just before the lock is still
included.

Admission then:

- disables source schedules and marks sources unavailable;
- marks every index unavailable;
- revokes all project API keys;
- cancels queued/running non-cleanup jobs;
- sets `projects.deletion_requested_at`;
- writes one cleanup job and transactional outbox record;
- records `project.deletion_requested`.

Repeated confirmed requests return the same cleanup receipt. An exhausted
cleanup receipt can be explicitly retried with the same typed confirmation.

Database triggers reject new direct project children after the marker. Indirect
writes are fenced through the index/source deletion markers. Race requests that
were authenticated before admission therefore cannot resurrect documents,
versions, crawls, jobs, analytics, keys or synonyms.

## Background cleanup

The cleanup worker drains source advisory locks first and index builder locks
second, matching the existing crawler/source-cleanup ordering. It then removes
each immutable index directory before committing metadata deletion.

Project-owned API keys, analytics, synonyms, usage counters, old jobs, sources
and indexes are removed. Cascades remove crawl pages, schedules, documents and
index versions.

A minimal tombstone is retained instead of retaining product data:

- stable project ID and organization relationship;
- `deletion_requested_at` and `deleted_at`;
- scrubbed name/slug/settings;
- the completed cleanup receipt;
- security audit records.

The retained receipt keeps `GET /v1/jobs/:jobId` useful after cleanup and makes
replayed cleanup delivery idempotent. Tombstones are excluded from normal
project listings and project authorization.

## Failure behavior

Filesystem deletion occurs while the database transaction holds processor
locks. If storage removal or a later database operation fails, database changes
roll back while the project remains fenced. The same deletion request can
requeue a failed durable receipt. Removing an already-removed index directory
is safe, so retry is idempotent.

This workflow does not erase external backups. Backup-retention erasure remains
an operator policy documented separately.
