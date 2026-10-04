create table if not exists project_quotas (
  project_id uuid primary key references projects(id) on delete cascade,
  monthly_searches bigint,
  monthly_api_requests bigint,
  monthly_crawl_pages bigint,
  max_documents bigint,
  warning_percent integer not null default 80 check (warning_percent between 1 and 99),
  updated_at timestamptz not null default now(),
  check (monthly_searches is null or monthly_searches > 0),
  check (monthly_api_requests is null or monthly_api_requests > 0),
  check (monthly_crawl_pages is null or monthly_crawl_pages > 0),
  check (max_documents is null or max_documents > 0)
);
