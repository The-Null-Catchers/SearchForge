create table if not exists notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  dedupe_key varchar(320) not null unique,
  project_id uuid references projects(id) on delete cascade,
  recipient_user_id uuid references users(id) on delete set null,
  recipient varchar(320) not null,
  kind varchar(80) not null,
  payload jsonb not null default '{}'::jsonb,
  state varchar(20) not null default 'pending'
    check (state in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error varchar(120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_deliveries_due_idx
  on notification_deliveries (state, next_attempt_at, created_at);

create index if not exists notification_deliveries_project_idx
  on notification_deliveries (project_id, created_at desc);
