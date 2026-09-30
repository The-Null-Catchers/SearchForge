ALTER TABLE jobs ADD COLUMN cancel_requested_at timestamptz;
CREATE INDEX jobs_source_state_idx ON jobs (source_id, state);
CREATE TABLE crawl_schedules (
  source_id uuid PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  interval_seconds integer NOT NULL CHECK (interval_seconds IN (3600, 21600, 86400, 604800)),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crawl_schedules_due_idx ON crawl_schedules (enabled, next_run_at);
CREATE TABLE job_outbox (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  queue varchar(40) NOT NULL CHECK (queue IN ('crawl', 'index')),
  name varchar(80) NOT NULL,
  payload jsonb NOT NULL,
  priority integer NOT NULL DEFAULT 5,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_outbox_pending_idx ON job_outbox (dispatched_at, created_at);
-- Preserve queued work accepted before the outbox migration. Existing Redis
-- jobs use the same external ID, so backfill/replay does not enqueue duplicates.
INSERT INTO job_outbox (job_id, queue, name, payload)
SELECT id, type,
  CASE WHEN type = 'crawl' THEN 'crawl-source' ELSE 'build-index' END,
  CASE WHEN type = 'crawl'
    THEN jsonb_build_object('databaseJobId', id::text, 'projectId', project_id::text, 'sourceId', source_id::text)
    ELSE jsonb_build_object('databaseJobId', id::text, 'projectId', project_id::text, 'indexId', index_id::text)
  END
FROM jobs WHERE state = 'queued' AND external_job_id IS NOT NULL
AND ((type = 'crawl' AND source_id IS NOT NULL) OR (type = 'index' AND index_id IS NOT NULL));
