import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  documents,
  indexVersions,
  indexes,
  jobs,
  projects,
  type createDatabase
} from "@searchforge/db";
import { buildSegment, FileSegmentStore, validateSegment, type SearchDocument } from "@searchforge/search-core";
import { indexSettingsSchema } from "@searchforge/shared";
import type { Redis as IORedis } from "ioredis";

type Db = ReturnType<typeof createDatabase>["db"];

export class IndexBuilder {
  private readonly store: FileSegmentStore;

  constructor(
    private readonly db: Db,
    private readonly redis: IORedis,
    storagePath: string
  ) {
    this.store = new FileSegmentStore(storagePath);
  }

  private async progress(jobId: string, phase: string, progress: Record<string, unknown>) {
    await this.db.update(jobs).set({ phase, progress, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await this.redis.publish(`job:${jobId}`, JSON.stringify({ phase, ...progress }));
  }

  async build(databaseJobId: string, projectId: string, indexId: string) {
    // A PostgreSQL lock coordinates all indexer processes, including retries.
    return this.db.transaction(async (lock) => {
      await lock.execute(sql`select pg_advisory_xact_lock(hashtextextended(${indexId}, 0))`);
      const [job] = await this.db.select().from(jobs).where(and(eq(jobs.id, databaseJobId), eq(jobs.projectId, projectId))).limit(1);
      if (!job || job.indexId !== indexId) throw new Error("Index job not found");
      if (job.state === "cancelled") return { cancelled: true };
      if (job.state === "completed") return job.progress;
      return this.buildLocked(databaseJobId, projectId, indexId);
    });
  }

  private async buildLocked(databaseJobId: string, projectId: string, indexId: string) {
    const [index] = await this.db.select().from(indexes)
      .where(and(eq(indexes.id, indexId), eq(indexes.projectId, projectId)))
      .limit(1);
    if (!index) throw new Error("Index not found");
    const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw new Error("Project not found");

    const [latest] = await this.db.select({ sequence: indexVersions.sequence })
      .from(indexVersions)
      .where(eq(indexVersions.indexId, indexId))
      .orderBy(desc(indexVersions.sequence))
      .limit(1);
    const sequence = (latest?.sequence ?? 0) + 1;

    const [version] = await this.db.insert(indexVersions).values({
      indexId,
      sequence,
      state: "building"
    }).returning();
    if (!version) throw new Error("Failed to create index version");

    await this.db.update(jobs).set({ state: "running", phase: "load", startedAt: new Date(), updatedAt: new Date() })
      .where(eq(jobs.id, databaseJobId));
    await this.progress(databaseJobId, "load", { processed: 0, failed: 0 });

    try {
      const rows = await this.db.select({ body: documents.body }).from(documents)
        .where(and(eq(documents.indexId, indexId), isNull(documents.deletedAt)));
      const settings = indexSettingsSchema.parse({
        ...(project.indexSettings ?? {}),
        ...(index.settings ?? {})
      });
      const searchDocuments = rows.map((row) => row.body as SearchDocument);
      await this.progress(databaseJobId, "analyze", { processed: 0, total: searchDocuments.length, failed: 0 });

      const segment = buildSegment(searchDocuments, settings, {
        version: String(sequence),
        searchableFields: Object.keys(settings.fieldBoosts)
      });
      validateSegment(segment);
      await this.progress(databaseJobId, "persist", { processed: searchDocuments.length, total: searchDocuments.length, failed: 0 });
      const manifestKey = await this.store.write(indexId, segment);

      await this.db.transaction(async (tx) => {
        if (index.activeVersionId) {
          await tx.update(indexVersions).set({ state: "retired", updatedAt: new Date() })
            .where(eq(indexVersions.id, index.activeVersionId));
        }
        await tx.update(indexVersions).set({
          state: "active",
          manifestKey,
          documentCount: searchDocuments.length,
          indexedBytes: Buffer.byteLength(JSON.stringify(segment)),
          checksum: segment.checksum,
          activatedAt: new Date(),
          updatedAt: new Date()
        }).where(eq(indexVersions.id, version.id));
        await tx.update(indexes).set({ activeVersionId: version.id, updatedAt: new Date() })
          .where(eq(indexes.id, indexId));
        await tx.update(jobs).set({
          state: "completed",
          phase: "completed",
          progress: { processed: searchDocuments.length, total: searchDocuments.length, failed: 0 },
          finishedAt: new Date(),
          updatedAt: new Date()
        }).where(eq(jobs.id, databaseJobId));
      });

      await this.redis.publish(`job:${databaseJobId}`, JSON.stringify({
        status: "completed",
        phase: "completed",
        processed: searchDocuments.length,
        indexVersion: sequence
      }));
      return { version: sequence, documents: searchDocuments.length, checksum: segment.checksum };
    } catch (error) {
      await this.db.update(indexVersions).set({ state: "failed", updatedAt: new Date() }).where(eq(indexVersions.id, version.id));
      throw error;
    }
  }
}
