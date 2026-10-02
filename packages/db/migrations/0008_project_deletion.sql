ALTER TABLE projects
  ADD COLUMN deletion_requested_at timestamptz,
  ADD COLUMN deleted_at timestamptz;

CREATE FUNCTION searchforge_live_project_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleting timestamptz;
DECLARE deleted timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.type = 'cleanup' THEN RETURN NEW; END IF;
  END IF;
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT deletion_requested_at, deleted_at INTO deleting, deleted
    FROM projects WHERE id = NEW.project_id FOR SHARE;
  IF NOT FOUND OR deleting IS NOT NULL OR deleted IS NOT NULL THEN
    RAISE EXCEPTION 'SearchForge project unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

-- Direct project children are fenced. Indirect writes (documents, versions,
-- crawl pages/schedules) are fenced through their index/source markers set by
-- project-deletion admission.
CREATE TRIGGER indexes_live_project BEFORE INSERT ON indexes
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();
CREATE TRIGGER sources_live_project BEFORE INSERT ON sources
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();
CREATE TRIGGER api_keys_live_project BEFORE INSERT ON api_keys
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();
-- PostgreSQL fires same-kind triggers alphabetically. Run after the existing
-- index/source job fences so admission can keep index -> source -> project order.
CREATE TRIGGER zz_jobs_live_project BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();
CREATE TRIGGER search_events_live_project BEFORE INSERT ON search_events
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();
CREATE TRIGGER search_clicks_live_project BEFORE INSERT ON search_clicks
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();
CREATE TRIGGER usage_live_project BEFORE INSERT ON usage_counters
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();
CREATE TRIGGER synonyms_live_project BEFORE INSERT ON synonym_sets
  FOR EACH ROW EXECUTE FUNCTION searchforge_live_project_write();

CREATE INDEX projects_deletion_idx ON projects (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL AND deleted_at IS NULL;
