import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, isNotNull, lte, sql } from "drizzle-orm";
import { crawlSchedules, jobOutbox, jobs, indexes, sources, type createDatabase } from "@searchforge/db";
import type { Queue } from "bullmq";

type Db = ReturnType<typeof createDatabase>["db"];
export type JobTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export class JobCancelled extends Error {
  constructor() { super("Job cancelled"); this.name = "JobCancelled"; }
}

export class JobFenced extends JobCancelled {
  constructor() { super(); this.name = "JobFenced"; this.message = "Job execution has been fenced"; }
}

export class SourceUnavailable extends JobCancelled {
  constructor() { super(); this.name = "SourceUnavailable"; this.message = "Source is unavailable or disabled"; }
}

export async function assertJobActive(db: Db | JobTransaction, id: string, externalJobId?: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) throw new Error("Job not found");
  if (externalJobId && job.externalJobId !== externalJobId) throw new JobFenced();
  if (job.cancelRequestedAt || job.state === "cancelled") throw new JobCancelled();
  return job;
}

export async function claimJobRun(db: Db, id: string, externalJobId: string) {
  return db.transaction(async tx => {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, id)).for("update");
    if (!job || job.externalJobId !== externalJobId) return false;
    if (job.state === "completed" || job.state === "cancelled" || job.cancelRequestedAt) return false;
    if (!["queued", "failed"].includes(job.state)) return false;
    const now = new Date();
    const [claimed] = await tx.update(jobs).set({
      state: "running",
      phase: "starting",
      startedAt: now,
      finishedAt: null,
      errorCode: null,
      errorMessage: null,
      updatedAt: now
    }).where(and(eq(jobs.id, id), eq(jobs.externalJobId, externalJobId), inArray(jobs.state, ["queued", "failed"]), isNull(jobs.cancelRequestedAt))).returning({ id: jobs.id });
    return Boolean(claimed);
  });
}

export async function heartbeatJobRun(db: Db, id: string, externalJobId: string) {
  const [updated] = await db.update(jobs).set({ updatedAt: new Date() })
    .where(and(eq(jobs.id, id), eq(jobs.externalJobId, externalJobId), eq(jobs.state, "running"), isNull(jobs.cancelRequestedAt)))
    .returning({ id: jobs.id });
  return Boolean(updated);
}

export async function finishCancelled(db: Db, id: string, externalJobId?: string) {
  const conditions = [eq(jobs.id, id), inArray(jobs.state, ["queued", "running"])] as const;
  await db.update(jobs).set({ state: "cancelled", phase: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions, ...(externalJobId ? [eq(jobs.externalJobId, externalJobId)] : [])));
}

// The caller owns the transaction containing both product mutations and enqueue.
export async function enqueueIndex(tx: JobTransaction, projectId: string, indexId: string, sourceId?: string) {
  const [index] = await tx.select().from(indexes)
    .where(and(eq(indexes.id, indexId), eq(indexes.projectId, projectId))).for("share");
  if (!index || index.deletionRequestedAt) throw new JobCancelled();
  const id = randomUUID();
  const externalJobId = randomUUID();
  await tx.insert(jobs).values({ id, externalJobId, projectId, indexId, sourceId, type: "index" });
  await tx.insert(jobOutbox).values({ jobId: id, queue: "index", name: "build-index",
    payload: { databaseJobId: id, projectId, indexId } });
  return id;
}

export async function enqueueCrawl(tx: JobTransaction, projectId: string, sourceId: string) {
  // All producers serialize on the source, preventing overlapping scheduled/manual runs.
  const [source] = await tx.select().from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.projectId, projectId))).for("update");
  if (!source?.enabled || source.deletionRequestedAt) throw new SourceUnavailable();
  const [existing] = await tx.select({ id: jobs.id }).from(jobs)
    .where(and(eq(jobs.sourceId, sourceId), eq(jobs.type, "crawl"), inArray(jobs.state, ["queued", "running"]))).limit(1);
  if (existing) return existing.id;
  const id = randomUUID();
  await tx.insert(jobs).values({ id, externalJobId: randomUUID(), projectId, sourceId, type: "crawl" });
  await tx.insert(jobOutbox).values({ jobId: id, queue: "crawl", name: "crawl-source",
    payload: { databaseJobId: id, projectId, sourceId } });
  return id;
}

export class JobDispatcher {
  constructor(private readonly db: Db, private readonly queues: Record<string, Pick<Queue, "add"> & Partial<Pick<Queue, "getJob">>>) {}

  // Recover accepted tasks whose Redis record disappeared after delivery.
  async reconcile(now = new Date(), limit = 25) {
    return this.db.transaction(async tx => {
      const entries = await tx.select({ entry: jobOutbox, job: jobs }).from(jobOutbox)
        .innerJoin(jobs, eq(jobs.id, jobOutbox.jobId))
        .where(and(isNotNull(jobOutbox.dispatchedAt), eq(jobs.state, "queued"),
          isNull(jobs.cancelRequestedAt), lte(jobOutbox.updatedAt, new Date(now.getTime() - 30_000))))
        .orderBy(asc(jobOutbox.updatedAt), asc(jobOutbox.jobId)).limit(limit)
        .for("update", { skipLocked: true });
      let recovered = 0;
      for (const { entry, job } of entries) {
        const queue = this.queues[entry.queue];
        if (!queue?.getJob || !job.externalJobId) throw new Error("Invalid recovery destination");
        if (!(await queue.getJob(job.externalJobId))) {
          await queue.add(entry.name, entry.payload, { jobId: job.externalJobId, priority: entry.priority });
          recovered += 1;
        }
        // Rotate healthy entries too so large paused queues cannot starve lost jobs.
        await tx.update(jobOutbox).set({ updatedAt: now }).where(eq(jobOutbox.jobId, entry.jobId));
      }
      return { checked: entries.length, recovered };
    });
  }

  async recoverStaleRunning(now = new Date(), staleMs = 120_000, limit = 25) {
    if (!Number.isFinite(staleMs) || staleMs < 30_000) throw new RangeError("staleMs must be at least 30000");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new RangeError("limit must be between 1 and 500");
    const cutoff = new Date(now.getTime() - staleMs);
    return this.db.transaction(async tx => {
      const rows = await tx.select({ job: jobs, outbox: jobOutbox }).from(jobs)
        .innerJoin(jobOutbox, eq(jobOutbox.jobId, jobs.id))
        .where(and(eq(jobs.state, "running"), inArray(jobs.type, ["crawl", "index"]),
          isNull(jobs.cancelRequestedAt), lte(jobs.updatedAt, cutoff)))
        .orderBy(asc(jobs.updatedAt), asc(jobs.id)).limit(limit)
        .for("update", { skipLocked: true });
      let recovered = 0;
      let stillOwned = 0;
      for (const { job, outbox } of rows) {
        const lockKey = job.type === "crawl" && job.sourceId
          ? `source:${job.sourceId}`
          : job.type === "index" && job.indexId
            ? job.indexId
            : undefined;
        if (!lockKey) continue;
        const lockResult = await tx.execute<{ locked: boolean }>(sql`
          select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked
        `);
        if (!lockResult.rows[0]?.locked) {
          stillOwned += 1;
          continue;
        }
        const externalJobId = randomUUID();
        await tx.update(jobs).set({
          externalJobId,
          state: "queued",
          phase: "recovered",
          startedAt: null,
          finishedAt: null,
          errorCode: null,
          errorMessage: null,
          updatedAt: now
        }).where(and(eq(jobs.id, job.id), eq(jobs.state, "running")));
        await tx.update(jobOutbox).set({ dispatchedAt: null, updatedAt: now }).where(eq(jobOutbox.jobId, outbox.jobId));
        recovered += 1;
      }
      return { checked: rows.length, recovered, stillOwned };
    });
  }

  async purgeTerminalOutbox(now = new Date(), retentionMs = 7 * 24 * 60 * 60 * 1000, limit = 250) {
    if (!Number.isFinite(retentionMs) || retentionMs < 0) throw new RangeError("retentionMs must be a non-negative finite number");
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new RangeError("limit must be an integer between 1 and 5000");
    const cutoff = new Date(now.getTime() - retentionMs);
    return this.db.transaction(async tx => {
      const entries = await tx.select({ jobId: jobOutbox.jobId }).from(jobOutbox)
        .innerJoin(jobs, eq(jobs.id, jobOutbox.jobId))
        .where(and(isNotNull(jobOutbox.dispatchedAt), isNotNull(jobs.finishedAt),
          inArray(jobs.state, ["completed", "failed", "cancelled"]), lte(jobs.finishedAt, cutoff)))
        .orderBy(asc(jobs.finishedAt), asc(jobOutbox.jobId)).limit(limit)
        .for("update", { skipLocked: true });
      if (entries.length === 0) return 0;
      await tx.delete(jobOutbox).where(inArray(jobOutbox.jobId, entries.map(entry => entry.jobId)));
      return entries.length;
    });
  }

  async dispatch(limit = 25) {
    return this.db.transaction(async tx => {
      const entries = await tx.select().from(jobOutbox).where(isNull(jobOutbox.dispatchedAt))
        .orderBy(asc(jobOutbox.createdAt)).limit(limit).for("update", { skipLocked: true });
      for (const entry of entries) {
        const [job] = await tx.select().from(jobs).where(eq(jobs.id, entry.jobId)).limit(1);
        if (job && job.state === "queued" && !job.cancelRequestedAt) {
          const queue = this.queues[entry.queue];
          if (!queue || !job.externalJobId) throw new Error("Invalid outbox destination");
          // Crash after Redis accepts but before commit replays the SAME BullMQ ID.
          await queue.add(entry.name, entry.payload, { jobId: job.externalJobId, priority: entry.priority });
        }
        await tx.update(jobOutbox).set({ dispatchedAt: new Date(), updatedAt: new Date() })
          .where(eq(jobOutbox.jobId, entry.jobId));
      }
      return entries.length;
    });
  }

  async scheduleDeferredCrawls(now = new Date(), limit = 25) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new RangeError("limit must be between 1 and 500");
    }
    return this.db.transaction(async tx => {
      const due = await tx.execute<{ source_id: string; project_id: string }>(sql`
        select r.source_id, s.project_id
        from crawl_page_retries r
        join sources s on s.id = r.source_id
        where r.retry_at <= ${now}
          and s.enabled = true
          and s.deletion_requested_at is null
        order by r.retry_at asc, r.source_id asc
        limit ${limit}
        for update of r skip locked
      `);
      const scheduled = new Set<string>();
      for (const row of due.rows) {
        if (scheduled.has(row.source_id)) continue;
        await enqueueCrawl(tx, row.project_id, row.source_id);
        scheduled.add(row.source_id);
      }
      return { due: due.rows.length, scheduled: scheduled.size };
    });
  }

  async schedule(now = new Date()) {
    return this.db.transaction(async tx => {
      const due = await tx.select().from(crawlSchedules)
        .where(and(eq(crawlSchedules.enabled, true), lte(crawlSchedules.nextRunAt, now)))
        .orderBy(asc(crawlSchedules.nextRunAt)).limit(25).for("update", { skipLocked: true });
      for (const schedule of due) {
        const [source] = await tx.select().from(sources).where(eq(sources.id, schedule.sourceId)).limit(1);
        if (source?.enabled && !source.deletionRequestedAt) await enqueueCrawl(tx, source.projectId, source.id);
        // Coalesce missed runs after downtime instead of flooding the crawler.
        await tx.update(crawlSchedules).set({ nextRunAt: new Date(now.getTime() + schedule.intervalSeconds * 1000), updatedAt: now })
          .where(eq(crawlSchedules.sourceId, schedule.sourceId));
      }
      return due.length;
    });
  }
}
