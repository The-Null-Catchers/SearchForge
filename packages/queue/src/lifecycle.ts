import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, isNotNull, lte } from "drizzle-orm";
import { crawlSchedules, jobOutbox, jobs, indexes, sources, type createDatabase } from "@searchforge/db";
import type { Queue } from "bullmq";

type Db = ReturnType<typeof createDatabase>["db"];
export type JobTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export class JobCancelled extends Error {
  constructor() { super("Job cancelled"); this.name = "JobCancelled"; }
}

export class SourceUnavailable extends JobCancelled {
  constructor() { super(); this.name = "SourceUnavailable"; this.message = "Source is unavailable or disabled"; }
}

export async function assertJobActive(db: Db | JobTransaction, id: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) throw new Error("Job not found");
  if (job.cancelRequestedAt || job.state === "cancelled") throw new JobCancelled();
  return job;
}

export async function finishCancelled(db: Db, id: string) {
  await db.update(jobs).set({ state: "cancelled", phase: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(jobs.id, id), inArray(jobs.state, ["queued", "running"])));
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

  // Recover accepted tasks whose Redis record disappeared after delivery. Running
  // tasks are deliberately excluded: replaying them needs processor fencing.
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
