import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { auditLogs, crawlPages, crawlSchedules, documents, indexes, indexVersions, jobs, sources, type createDatabase } from "@searchforge/db";
import { enqueueIndex, type CleanupJobData } from "@searchforge/queue";
import { cleanupIndexPath } from "./cleanup.js";

type Db = ReturnType<typeof createDatabase>["db"];
type Task = { indexId: string; jobId: string | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function tasksFrom(progress: Record<string, unknown>): Task[] {
  if (progress.tasks === undefined) return [];
  if (!Array.isArray(progress.tasks) || progress.tasks.length > 10000) throw new Error("Invalid source cleanup plan");
  return progress.tasks.map(value => {
    if (!value || typeof value !== "object" || typeof value.indexId !== "string" || (value.jobId !== null && typeof value.jobId !== "string") ||
        !uuid.test(value.indexId) || (value.jobId !== null && !uuid.test(value.jobId))) throw new Error("Invalid source cleanup task");
    return { indexId: value.indexId, jobId: value.jobId };
  });
}

export function obsoleteSegmentFile(name: string, minimumSequence: number): boolean {
  const match = /^([1-9]\d*)\.segment\.json(?:\.tmp-[0-9a-f-]+)?$/i.exec(name);
  return !!match && Number.isSafeInteger(Number(match[1])) && Number(match[1]) < minimumSequence;
}

export class SourceCleanup {
  constructor(private readonly db: Db, private readonly storagePath: string, private readonly waitMs = 300_000) {}

  async run(data: CleanupJobData) {
    if (data.targetType !== "source") throw new Error("Unsupported source cleanup target");
    if (![data.targetId, data.projectId, data.databaseJobId].every(value => uuid.test(value))) throw new Error("Invalid source cleanup identity");
    return this.db.transaction(async lock => {
      // Crawlers use this lock for their entire lifetime, including completion.
      await lock.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`source:${data.targetId}`}, 0))`);
      const [receipt] = await this.db.select().from(jobs).where(eq(jobs.id, data.databaseJobId)).limit(1);
      if (!receipt || receipt.projectId !== data.projectId || receipt.type !== "cleanup" ||
          receipt.progress.targetType !== "source" || receipt.progress.targetId !== data.targetId) throw new Error("Cleanup job does not match source");
      if (receipt.state === "completed") return receipt.progress;
      if (receipt.state === "failed" || receipt.cancelRequestedAt || receipt.state === "cancelled") throw new Error("Source cleanup requires retry admission");
      const [source] = await this.db.select().from(sources).where(eq(sources.id, data.targetId)).limit(1);
      if (!source || source.projectId !== data.projectId || !source.deletionRequestedAt || receipt.sourceId !== source.id) {
        throw new Error("Source has not been admitted for deletion");
      }
      const tasks = await this.prepare(data);
      const deadline = Date.now() + this.waitMs;
      for (const task of tasks) {
        while (!(await this.ready(task))) {
          if (Date.now() >= deadline) throw new Error("Timed out waiting for source-free index activation");
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        await this.purge(task.indexId, data.projectId);
      }
      return this.db.transaction(async tx => {
        const [current] = await tx.select().from(jobs).where(eq(jobs.id, receipt.id)).for("update");
        if (!current) throw new Error("Cleanup receipt missing");
        // Drain child rows before deleting the source parent, avoiding inverted
        // locks with producers that started before admission.
        await tx.delete(crawlPages).where(eq(crawlPages.sourceId, source.id));
        await tx.delete(crawlSchedules).where(eq(crawlSchedules.sourceId, source.id));
        await tx.delete(documents).where(eq(documents.sourceId, source.id));
        await tx.delete(sources).where(eq(sources.id, source.id));
        const progress = { ...current.progress, cleaned: true };
        await tx.update(jobs).set({ state: "completed", phase: "completed", progress,
          finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, receipt.id));
        await tx.insert(auditLogs).values({ projectId: data.projectId, action: "source.deleted", targetType: "source",
          targetId: source.id, metadata: { jobId: receipt.id } });
        return progress;
      });
    });
  }

  private async prepare(data: CleanupJobData) {
    return this.db.transaction(async tx => {
      const liveIndexes = await tx.select().from(indexes)
        .where(eq(indexes.projectId, data.projectId))
        .orderBy(asc(indexes.id)).for("share");
      const [receipt] = await tx.select().from(jobs).where(eq(jobs.id, data.databaseJobId)).for("update");
      if (!receipt) throw new Error("Cleanup receipt missing");
      // Commit source document erasure and the replacement build outbox together.
      await tx.delete(documents).where(eq(documents.sourceId, data.targetId));
      const tasks = tasksFrom(receipt.progress);
      for (const index of liveIndexes) {
        const prior = tasks.find(task => task.indexId === index.id);
        if (index.deletionRequestedAt) {
          if (!prior) tasks.push({ indexId: index.id, jobId: null });
          continue;
        }
        const [child] = prior?.jobId ? await tx.select().from(jobs).where(eq(jobs.id, prior.jobId)).limit(1) : [];
        const [active] = index.activeVersionId ? await tx.select().from(indexVersions)
          .where(eq(indexVersions.id, index.activeVersionId)).limit(1) : [];
        const safe = !!active && active.state === "active" && active.sequence >= index.minimumVersionSequence;
        if (prior && child && !["failed", "cancelled"].includes(child.state) && (child.state !== "completed" || safe)) continue;
        const jobId = await enqueueIndex(tx, data.projectId, index.id);
        if (prior) prior.jobId = jobId;
        else tasks.push({ indexId: index.id, jobId });
      }
      await tx.update(jobs).set({ phase: "rebuilding", startedAt: receipt.startedAt ?? new Date(),
        progress: { ...receipt.progress, tasks }, updatedAt: new Date() }).where(eq(jobs.id, receipt.id));
      return tasks;
    });
  }

  private async ready(task: Task) {
    const [index] = await this.db.select().from(indexes).where(eq(indexes.id, task.indexId)).limit(1);
    if (!index || index.deletionRequestedAt) return true; // Index cleanup owns its files.
    const [active] = index.activeVersionId ? await this.db.select().from(indexVersions)
      .where(eq(indexVersions.id, index.activeVersionId)).limit(1) : [];
    if (active?.state === "active" && active.sequence >= index.minimumVersionSequence) return true;
    if (!task.jobId) throw new Error("Missing replacement build task");
    const [child] = await this.db.select().from(jobs).where(eq(jobs.id, task.jobId)).limit(1);
    if (!child || ["failed", "cancelled", "completed"].includes(child.state)) throw new Error("Source replacement build did not activate a safe version");
    return false;
  }

  private async purge(indexId: string, projectId: string) {
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${indexId}, 0))`);
      const [index] = await tx.select().from(indexes).where(eq(indexes.id, indexId)).for("update");
      if (!index) return;
      if (index.projectId !== projectId) throw new Error("Cleanup index project mismatch");
      if (index.deletionRequestedAt) {
        // Search is already fenced; drain its builder then collect all files.
        // The admitted index cleanup remains responsible for metadata/receipts.
        await rm(cleanupIndexPath(this.storagePath, indexId), { recursive: true, force: true });
        return;
      }
      const [active] = index.activeVersionId ? await tx.select().from(indexVersions).where(eq(indexVersions.id, index.activeVersionId)).limit(1) : [];
      if (!active || active.state !== "active" || active.sequence < index.minimumVersionSequence) throw new Error("Source-free index activation is required before purge");
      const directory = cleanupIndexPath(this.storagePath, indexId);
      if (!(await lstat(directory)).isDirectory()) throw new Error("Index storage must be a directory, not a symlink");
      // Include failed-build/orphan temporary files, not just published manifests.
      for (const name of await readdir(directory)) {
        if (obsoleteSegmentFile(name, index.minimumVersionSequence)) await rm(join(directory, name), { force: true });
      }
      await tx.delete(indexVersions).where(and(eq(indexVersions.indexId, indexId), lt(indexVersions.sequence, index.minimumVersionSequence)));
    });
  }
}
