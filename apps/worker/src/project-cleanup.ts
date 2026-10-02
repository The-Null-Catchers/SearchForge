import { rm } from "node:fs/promises";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  apiKeys,
  auditLogs,
  indexes,
  jobs,
  projects,
  searchClicks,
  searchEvents,
  sources,
  synonymSets,
  usageCounters,
  type createDatabase
} from "@searchforge/db";
import type { CleanupJobData } from "@searchforge/queue";
import { cleanupIndexPath } from "./cleanup.js";

type Db = ReturnType<typeof createDatabase>["db"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ProjectCleanup {
  constructor(private readonly db: Db, private readonly storagePath: string) {}

  async run(data: CleanupJobData) {
    if (data.targetType !== "project" || data.targetId !== data.projectId) {
      throw new Error("Unsupported project cleanup target");
    }
    if (![data.targetId, data.projectId, data.databaseJobId].every(value => uuid.test(value))) {
      throw new Error("Invalid project cleanup identity");
    }

    return this.db.transaction(async tx => {
      const [project] = await tx.select().from(projects)
        .where(eq(projects.id, data.projectId)).for("update");
      const [receipt] = await tx.select().from(jobs)
        .where(eq(jobs.id, data.databaseJobId)).for("update");

      if (!project || project.deletedAt || !project.deletionRequestedAt) {
        if (receipt?.state === "completed") return receipt.progress;
        throw new Error("Project has not been admitted for deletion");
      }
      if (!receipt || receipt.projectId !== project.id || receipt.type !== "cleanup" ||
          receipt.progress.targetType !== "project" || receipt.progress.targetId !== project.id) {
        throw new Error("Cleanup job does not match project");
      }
      if (receipt.state === "completed") return receipt.progress;
      if (receipt.state === "failed" || receipt.cancelRequestedAt || receipt.state === "cancelled") {
        throw new Error("Project cleanup requires explicit retry admission");
      }

      const projectSources = await tx.select({ id: sources.id }).from(sources)
        .where(eq(sources.projectId, project.id)).orderBy(asc(sources.id));
      const projectIndexes = await tx.select({ id: indexes.id }).from(indexes)
        .where(eq(indexes.projectId, project.id)).orderBy(asc(indexes.id));

      // Source cleanup/crawlers take source locks before index builder locks.
      // Keep the same global order so deletion drains active processors safely.
      for (const source of projectSources) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`source:${source.id}`}, 0))`);
      }
      for (const index of projectIndexes) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${index.id}, 0))`);
      }

      // Remove immutable search data before metadata. A storage failure rolls
      // back the database transaction and leaves the durable deletion marker
      // and receipt available for explicit retry.
      for (const index of projectIndexes) {
        await rm(cleanupIndexPath(this.storagePath, index.id), { recursive: true, force: true });
      }

      // Purge project-owned data. Source/index cascades remove schedules,
      // crawl pages, documents and index versions. Security audit rows are
      // intentionally retained and continue pointing at the tombstone.
      await tx.delete(searchClicks).where(eq(searchClicks.projectId, project.id));
      await tx.delete(searchEvents).where(eq(searchEvents.projectId, project.id));
      await tx.delete(apiKeys).where(eq(apiKeys.projectId, project.id));
      await tx.delete(synonymSets).where(eq(synonymSets.projectId, project.id));
      await tx.delete(usageCounters).where(eq(usageCounters.projectId, project.id));
      await tx.delete(jobs).where(and(eq(jobs.projectId, project.id), ne(jobs.id, receipt.id)));
      await tx.delete(sources).where(eq(sources.projectId, project.id));
      await tx.delete(indexes).where(eq(indexes.projectId, project.id));

      const now = new Date();
      const progress = {
        targetType: "project",
        targetId: project.id,
        cleaned: true,
        indexesRemoved: projectIndexes.length,
        sourcesRemoved: projectSources.length
      };
      await tx.update(projects).set({
        name: "Deleted project",
        slug: `deleted-${project.id}`,
        description: null,
        supportedLanguages: [],
        indexSettings: {},
        crawlSettings: {},
        rankingSettings: {},
        autocompleteSettings: {},
        analyticsEnabled: false,
        deletedAt: now,
        updatedAt: now
      }).where(eq(projects.id, project.id));
      await tx.update(jobs).set({
        state: "completed",
        phase: "completed",
        progress,
        startedAt: receipt.startedAt ?? now,
        finishedAt: now,
        updatedAt: now
      }).where(eq(jobs.id, receipt.id));
      await tx.insert(auditLogs).values({
        organizationId: project.organizationId,
        projectId: project.id,
        action: "project.deleted",
        targetType: "project",
        targetId: project.id,
        metadata: { jobId: receipt.id, indexesRemoved: projectIndexes.length, sourcesRemoved: projectSources.length }
      });
      return progress;
    });
  }
}
