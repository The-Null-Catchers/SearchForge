import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { auditLogs, indexes, jobs, searchClicks, searchEvents, type createDatabase } from "@searchforge/db";
import type { CleanupJobData } from "@searchforge/queue";

type Db = ReturnType<typeof createDatabase>["db"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanupIndexPath(root: string, id: string) {
  if (!uuid.test(id)) throw new Error("Cleanup requires a UUID index ID");
  return resolve(root, id);
}

export class IndexCleanup {
  constructor(private readonly db: Db, private readonly storagePath: string) {}

  async run(data: CleanupJobData) {
    // Reject unsupported targets instead of reporting fictitious success.
    if (data.targetType !== "index") throw new Error("Unsupported cleanup target");
    const path = cleanupIndexPath(this.storagePath, data.targetId);
    if (!uuid.test(data.projectId) || !uuid.test(data.databaseJobId)) throw new Error("Invalid cleanup identity");
    return this.db.transaction(async tx => {
      // The builder holds this same lock across file writes and activation.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${data.targetId}, 0))`);
      const [index] = await tx.select().from(indexes).where(eq(indexes.id, data.targetId)).for("update");
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, data.databaseJobId)).for("update");
      if (!job || job.projectId !== data.projectId || job.type !== "cleanup" ||
          job.progress.targetType !== "index" || job.progress.targetId !== data.targetId) {
        throw new Error("Cleanup job does not match target");
      }
      if (job.state === "completed") return job.progress;
      if (!index || index.projectId !== data.projectId || !index.deletionRequestedAt || job.indexId !== index.id) {
        throw new Error("Index has not been admitted for deletion");
      }
      if (job.cancelRequestedAt || job.state === "cancelled") throw new Error("Deletion cleanup cannot be cancelled");
      // rm unlinks a symlink at the target; it never recursively follows it.
      // Files are removed first: a DB/storage failure leaves a durable deleting
      // row and queued outbox job, so retry can safely finish the same deletion.
      await rm(path, { recursive: true, force: true });
      await tx.delete(searchClicks).where(inArray(searchClicks.searchEventId,
        tx.select({ id: searchEvents.id }).from(searchEvents).where(eq(searchEvents.indexId, index.id))));
      await tx.delete(searchEvents).where(eq(searchEvents.indexId, index.id));
      await tx.delete(indexes).where(eq(indexes.id, index.id));
      const progress = { targetType: "index", targetId: index.id, cleaned: true };
      await tx.update(jobs).set({ state: "completed", phase: "completed", progress,
        startedAt: job.startedAt ?? new Date(), finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id));
      await tx.insert(auditLogs).values({ projectId: data.projectId, action: "index.deleted", targetType: "index",
        targetId: index.id, metadata: { jobId: job.id } });
      return progress;
    });
  }
}
