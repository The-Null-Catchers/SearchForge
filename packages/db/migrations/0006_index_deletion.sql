ALTER TABLE indexes ADD COLUMN deletion_requested_at timestamptz;

-- Serialize write admission with the deletion marker. The SHARE lock is held
-- until the producer transaction commits, preventing post-marker resurrection.
CREATE FUNCTION searchforge_live_index_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleting timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.type = 'cleanup' THEN RETURN NEW; END IF;
  END IF;
  IF NEW.index_id IS NULL THEN RETURN NEW; END IF;
  SELECT deletion_requested_at INTO deleting FROM indexes WHERE id = NEW.index_id FOR SHARE;
  IF NOT FOUND OR deleting IS NOT NULL THEN
    RAISE EXCEPTION 'SearchForge index unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER documents_live_index BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_index_write();
CREATE TRIGGER versions_live_index BEFORE INSERT ON index_versions
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_index_write();
CREATE TRIGGER jobs_live_index BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_index_write();

ALTER TABLE job_outbox DROP CONSTRAINT job_outbox_queue_check;
ALTER TABLE job_outbox ADD CONSTRAINT job_outbox_queue_check CHECK (queue IN ('crawl', 'index', 'cleanup'));
