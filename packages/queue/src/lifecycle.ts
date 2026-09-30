import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { crawlSchedules, jobOutbox, jobs, sources, type createDatabase } from "@searchforge/db";
import type { Queue } from "bullmq";

type Db = ReturnType<typeof createDatabase>["db"];
export type JobTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
export class JobCancelled extends Error {
  constructor() { super("Job cancelled"); this.name = "JobCancelled"; }
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
  if (!source?.enabled) throw new Error("Source is unavailable or disabled");
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
  constructor(private readonly db: Db, private readonly queues: Record<string, Pick<Queue, "add">>) {}

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
        if (source?.enabled) await enqueueCrawl(tx, source.projectId, source.id);
        // Coalesce missed runs after downtime instead of flooding the crawler.
        await tx.update(crawlSchedules).set({ nextRunAt: new Date(now.getTime() + schedule.intervalSeconds * 1000), updatedAt: now })
          .where(eq(crawlSchedules.sourceId, schedule.sourceId));
      }
      return due.length;
    });
  }
}
