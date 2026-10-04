create or replace function searchforge_enforce_crawl_page_quota()
returns trigger
language plpgsql
as $$
declare
  v_project_id uuid;
  v_limit bigint;
  v_period varchar(16);
  v_used bigint;
begin
  -- robots-denied URLs never reached the page fetch path, so they do not consume crawl-page quota.
  if new.status = 'blocked' then
    return new;
  end if;

  select s.project_id
    into v_project_id
  from sources s
  where s.id = new.source_id;

  if v_project_id is null then
    return new;
  end if;

  v_period := to_char(timezone('UTC', now()), 'YYYY-MM');

  -- Serialize reservations across every crawler process for this project/month.
  perform pg_advisory_xact_lock(
    hashtextextended('crawl-quota:' || v_project_id::text || ':' || v_period, 0)
  );

  select q.monthly_crawl_pages
    into v_limit
  from project_quotas q
  where q.project_id = v_project_id;

  insert into usage_counters (project_id, period, crawl_pages)
  values (v_project_id, v_period, 1)
  on conflict (project_id, period)
  do update set crawl_pages = usage_counters.crawl_pages + 1
  returning crawl_pages into v_used;

  if v_limit is not null and v_used > v_limit then
    raise exception 'SearchForge monthly crawl page quota exceeded'
      using errcode = 'P0001',
            detail = format('project=%s period=%s used=%s limit=%s', v_project_id, v_period, v_used, v_limit),
            hint = 'Increase the project monthly crawl-page quota or wait for the next UTC month.';
  end if;

  return new;
end;
$$;

drop trigger if exists searchforge_crawl_page_quota_trigger on crawl_pages;

create trigger searchforge_crawl_page_quota_trigger
after insert on crawl_pages
for each row
execute function searchforge_enforce_crawl_page_quota();
