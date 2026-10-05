import { sql } from "drizzle-orm";
import type { createDatabase } from "@searchforge/db";

type Db = ReturnType<typeof createDatabase>["db"];

export type DeferredPageRetry = {
  sourceId: string;
  lastJobId?: string;
  url: string;
  normalizedUrl: string;
  depth: number;
  nextAttempt: number;
  retryAt: Date;
  httpStatus?: number;
};

export async function persistDeferredRetry(db: Db, retry: DeferredPageRetry) {
  await db.execute(sql`
    insert into crawl_page_retries (
      source_id, last_job_id, url, normalized_url, depth,
      next_attempt, retry_at, http_status, updated_at
    ) values (
      ${retry.sourceId}::uuid,
      ${retry.lastJobId ?? null}::uuid,
      ${retry.url},
      ${retry.normalizedUrl},
      ${retry.depth},
      ${retry.nextAttempt},
      ${retry.retryAt},
      ${retry.httpStatus ?? null},
      now()
    )
    on conflict (source_id, normalized_url) do update set
      last_job_id = excluded.last_job_id,
      url = excluded.url,
      depth = excluded.depth,
      next_attempt = excluded.next_attempt,
      retry_at = excluded.retry_at,
      http_status = excluded.http_status,
      updated_at = now()
  `);
}

export async function clearDeferredRetry(db: Db, sourceId: string, normalizedUrl: string) {
  await db.execute(sql`
    delete from crawl_page_retries
    where source_id = ${sourceId}::uuid and normalized_url = ${normalizedUrl}
  `);
}

export async function loadDueDeferredRetries(
  db: Db,
  sourceId: string,
  now = new Date(),
  limit = 250
): Promise<DeferredPageRetry[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
    throw new RangeError("limit must be between 1 and 5000");
  }
  const result = await db.execute<{
    source_id: string;
    last_job_id: string | null;
    url: string;
    normalized_url: string;
    depth: number;
    next_attempt: number;
    retry_at: Date;
    http_status: number | null;
  }>(sql`
    select source_id, last_job_id, url, normalized_url, depth,
      next_attempt, retry_at, http_status
    from crawl_page_retries
    where source_id = ${sourceId}::uuid and retry_at <= ${now}
    order by retry_at asc, normalized_url asc
    limit ${limit}
  `);
  return result.rows.map(row => ({
    sourceId: row.source_id,
    lastJobId: row.last_job_id ?? undefined,
    url: row.url,
    normalizedUrl: row.normalized_url,
    depth: row.depth,
    nextAttempt: row.next_attempt,
    retryAt: row.retry_at,
    httpStatus: row.http_status ?? undefined
  }));
}
