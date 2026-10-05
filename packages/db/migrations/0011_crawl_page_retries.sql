create table if not exists crawl_page_retries (
  source_id uuid not null references sources(id) on delete cascade,
  last_job_id uuid references jobs(id) on delete set null,
  url text not null,
  normalized_url text not null,
  depth integer not null default 0,
  next_attempt integer not null,
  retry_at timestamptz not null,
  http_status integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_id, normalized_url)
);

create index if not exists crawl_page_retries_due_idx
  on crawl_page_retries (retry_at, source_id);
