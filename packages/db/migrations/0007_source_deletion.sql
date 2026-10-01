ALTER TABLE sources ADD COLUMN deletion_requested_at timestamptz;
ALTER TABLE indexes ADD COLUMN minimum_version_sequence integer NOT NULL DEFAULT 0 CHECK (minimum_version_sequence >= 0);

CREATE FUNCTION searchforge_live_source_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleting timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.type = 'cleanup' THEN RETURN NEW; END IF;
  END IF;
  IF NEW.source_id IS NULL THEN RETURN NEW; END IF;
  SELECT deletion_requested_at INTO deleting FROM sources WHERE id = NEW.source_id FOR SHARE;
  IF NOT FOUND OR deleting IS NOT NULL THEN
    RAISE EXCEPTION 'SearchForge source unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
-- Index admission runs first on documents/jobs (alphabetic trigger ordering).
CREATE TRIGGER documents_live_source BEFORE INSERT OR UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_source_write();
CREATE TRIGGER jobs_live_source BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_source_write();
CREATE TRIGGER pages_live_source BEFORE INSERT OR UPDATE ON crawl_pages
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_source_write();
CREATE TRIGGER schedules_live_source BEFORE INSERT OR UPDATE ON crawl_schedules
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_source_write();
