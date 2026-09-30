CREATE INDEX job_outbox_recovery_idx ON job_outbox (updated_at, job_id);
