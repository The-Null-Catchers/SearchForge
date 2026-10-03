import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { auditLogs, indexes, projects, type createDatabase } from "@searchforge/db";
import { enqueueIndex } from "@searchforge/queue";
import { AppError, indexSettingsSchema } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];

const rankingSchema = z.object({
  bm25: z.object({
    k1: z.number().min(0.1).max(4),
    b: z.number().min(0).max(1)
  }),
  fieldBoosts: z.record(z.string().min(1).max(80), z.number().positive().max(100))
    .refine(value => Object.keys(value).length > 0 && Object.keys(value).length <= 20, "Use between 1 and 20 field boosts"),
  typoTolerance: z.object({
    enabled: z.boolean(),
    maxDistance: z.number().int().min(0).max(2),
    minTokenLength: z.number().int().min(2).max(12)
  }),
  prefixSearch: z.boolean()
}).strict();

export async function rankingRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.get("/v1/projects/:projectId/ranking", async request => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await projectAccess(db, claims.userId, projectId, "viewer");
    const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletionRequestedAt))).limit(1);
    const [index] = await db.select().from(indexes)
      .where(and(eq(indexes.projectId, projectId), eq(indexes.slug, "docs"), isNull(indexes.deletionRequestedAt))).limit(1);
    if (!project || !index) throw new AppError("INDEX_NOT_FOUND", "Default index not found", 404);
    const settings = indexSettingsSchema.parse({ ...(project.indexSettings ?? {}), ...(index.settings ?? {}) });
    return {
      ranking: {
        bm25: settings.bm25,
        fieldBoosts: settings.fieldBoosts,
        typoTolerance: settings.typoTolerance,
        prefixSearch: settings.prefixSearch
      },
      indexId: index.id,
      activeVersionId: index.activeVersionId
    };
  });

  app.put("/v1/projects/:projectId/ranking", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, projectId, "developer");
    const ranking = rankingSchema.parse(request.body);

    const result = await db.transaction(async tx => {
      const [project] = await tx.select().from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletionRequestedAt))).for("update");
      const [index] = await tx.select().from(indexes)
        .where(and(eq(indexes.projectId, projectId), eq(indexes.slug, "docs"), isNull(indexes.deletionRequestedAt))).for("update");
      if (!project || !index) throw new AppError("INDEX_NOT_FOUND", "Default index not found", 404);

      const previous = indexSettingsSchema.parse({ ...(project.indexSettings ?? {}), ...(index.settings ?? {}) });
      const next = indexSettingsSchema.parse({
        ...previous,
        bm25: ranking.bm25,
        fieldBoosts: ranking.fieldBoosts,
        typoTolerance: ranking.typoTolerance,
        prefixSearch: ranking.prefixSearch
      });

      await tx.update(projects).set({ indexSettings: next, rankingSettings: ranking, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      await tx.update(indexes).set({ settings: next, updatedAt: new Date() }).where(eq(indexes.id, index.id));
      const jobId = await enqueueIndex(tx, projectId, index.id);
      await tx.insert(auditLogs).values({
        organizationId: access.organizationId,
        projectId,
        actorUserId: claims.userId,
        action: "ranking.updated",
        targetType: "index",
        targetId: index.id,
        requestId: request.id,
        ip: request.ip,
        metadata: { previous: { bm25: previous.bm25, fieldBoosts: previous.fieldBoosts, typoTolerance: previous.typoTolerance, prefixSearch: previous.prefixSearch }, current: ranking, rebuildJobId: jobId }
      });
      return { ranking, indexId: index.id, jobId };
    });

    return reply.code(202).send(result);
  });
}
