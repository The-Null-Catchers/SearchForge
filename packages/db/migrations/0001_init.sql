-- SearchForge initial metadata schema.
-- Generated SQL is intentionally checked in so deployments can apply migrations without schema push.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE org_role AS ENUM ('owner','admin','developer','viewer'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE api_key_kind AS ENUM ('search','indexing','admin'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE source_kind AS ENUM ('website','api'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE job_state AS ENUM ('queued','running','completed','failed','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE index_version_state AS ENUM ('building','ready','active','retired','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  email_verified_at timestamptz,
  display_name varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(140) NOT NULL,
  slug varchar(80) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role org_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name varchar(140) NOT NULL,
  slug varchar(80) NOT NULL,
  description text,
  default_language varchar(16) NOT NULL DEFAULT 'auto',
  supported_languages jsonb NOT NULL DEFAULT '["en","ar"]'::jsonb,
  index_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  crawl_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ranking_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  autocomplete_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  analytics_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);
CREATE INDEX IF NOT EXISTS projects_org_idx ON projects(organization_id);

CREATE TABLE IF NOT EXISTS indexes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name varchar(120) NOT NULL,
  slug varchar(80) NOT NULL,
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  active_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug)
);

CREATE TABLE IF NOT EXISTS index_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  index_id uuid NOT NULL REFERENCES indexes(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  state index_version_state NOT NULL DEFAULT 'building',
  manifest_key text,
  document_count integer NOT NULL DEFAULT 0,
  indexed_bytes bigint NOT NULL DEFAULT 0,
  checksum varchar(128),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (index_id, sequence)
);
CREATE INDEX IF NOT EXISTS index_versions_state_idx ON index_versions(index_id, state);
ALTER TABLE indexes DROP CONSTRAINT IF EXISTS indexes_active_version_id_fkey;
ALTER TABLE indexes ADD CONSTRAINT indexes_active_version_id_fkey FOREIGN KEY (active_version_id) REFERENCES index_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind source_kind NOT NULL,
  name varchar(140) NOT NULL,
  config jsonb NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_crawled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sources_project_idx ON sources(project_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind api_key_kind NOT NULL,
  name varchar(120) NOT NULL,
  prefix varchar(32) NOT NULL UNIQUE,
  secret_digest varchar(128) NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  ip_restrictions jsonb NOT NULL DEFAULT '[]'::jsonb,
  rate_limit_per_minute integer,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_keys_project_idx ON api_keys(project_id);

CREATE TABLE IF NOT EXISTS refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_digest varchar(128) NOT NULL UNIQUE,
  parent_token_digest varchar(128),
  user_agent text,
  ip inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_sessions_user_idx ON refresh_sessions(user_id);
CREATE INDEX IF NOT EXISTS refresh_sessions_family_idx ON refresh_sessions(family_id);

CREATE TABLE IF NOT EXISTS one_time_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(32) NOT NULL,
  token_digest varchar(128) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id uuid REFERENCES sources(id) ON DELETE SET NULL,
  index_id uuid REFERENCES indexes(id) ON DELETE SET NULL,
  external_job_id varchar(160) UNIQUE,
  type varchar(40) NOT NULL,
  state job_state NOT NULL DEFAULT 'queued',
  phase varchar(80) NOT NULL DEFAULT 'queued',
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code varchar(80),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_project_state_idx ON jobs(project_id, state);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(120) NOT NULL,
  target_type varchar(80),
  target_id varchar(160),
  request_id varchar(80),
  ip inet,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_project_created_idx ON audit_logs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS search_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  index_id uuid REFERENCES indexes(id) ON DELETE SET NULL,
  query text NOT NULL,
  language varchar(16),
  result_count integer NOT NULL,
  latency_ms real NOT NULL,
  anonymous_user_hash varchar(128),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_events_project_created_idx ON search_events(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS search_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query text NOT NULL,
  document_id varchar(200) NOT NULL,
  position integer NOT NULL,
  search_event_id uuid REFERENCES search_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_clicks_project_created_idx ON search_clicks(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS usage_counters (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  period varchar(16) NOT NULL,
  searches bigint NOT NULL DEFAULT 0,
  api_requests bigint NOT NULL DEFAULT 0,
  crawl_pages bigint NOT NULL DEFAULT 0,
  indexed_bytes bigint NOT NULL DEFAULT 0,
  documents bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, period)
);
