import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, indexes, jobOutbox, jobs, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];
export async function deletionRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.delete("/v1/console/indexes/:indexId", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { indexId } = z.object({ indexId: z.string().uuid() }).parse(request.params);
    const { confirmation } = z.object({ confirmation: z.string().min(1).max(80) }).strict().parse(request.body);
    const [index] = await db.select().from(indexes).where(eq(indexes.id, indexId)).limit(1);
    if (!index) throw new AppError("INDEX_NOT_FOUND", "Index not found", 404);
    const access = await projectAccess(db, claims.userId, index.projectId, "admin");
    const jobId = await db.transaction(async tx => {
      const [current] = await tx.select().from(indexes).where(eq(indexes.id, indexId)).for("update");
      if (!current) throw new AppError("INDEX_NOT_FOUND", "Index not found", 404);
      if (confirmation !== current.slug) throw new AppError("CONFIRMATION_REQUIRED", "Type the index slug to confirm deletion", 400);
      if (current.deletionRequestedAt) {
        const [existing] = await tx.select().from(jobs)
          .where(and(eq(jobs.indexId, indexId), eq(jobs.type, "cleanup"))).limit(1);
        if (!existing) throw new Error("Deleting index has no cleanup job");
        if (existing.state === "failed") {
          await tx.update(jobs).set({ state: "queued", phase: "queued", externalJobId: randomUUID(),
            errorCode: null, errorMessage: null, finishedAt: null, updatedAt: new Date() }).where(eq(jobs.id, existing.id));
          await tx.update(jobOutbox).set({ dispatchedAt: null, updatedAt: new Date() }).where(eq(jobOutbox.jobId, existing.id));
        }
        return existing.id;
      }
      const now = new Date();
      await tx.update(indexes).set({ deletionRequestedAt: now, updatedAt: now }).where(eq(indexes.id, indexId));
      // Stop already accepted builds. New writes are fenced by database triggers.
      await tx.update(jobs).set({ cancelRequestedAt: now, state: "cancelled", phase: "cancelled", finishedAt: now, updatedAt: now })
        .where(and(eq(jobs.indexId, indexId), inArray(jobs.state, ["queued", "running"])));
      const id = randomUUID();
      await tx.insert(jobs).values({ id, externalJobId: randomUUID(), projectId: index.projectId,
        indexId, type: "cleanup", progress: { targetType: "index", targetId: indexId } });
      await tx.insert(jobOutbox).values({ jobId: id, queue: "cleanup", name: "delete-index", priority: 1,
        payload: { databaseJobId: id, projectId: index.projectId, targetType: "index", targetId: indexId } });
      await tx.insert(auditLogs).values({ organizationId: access.organizationId, projectId: index.projectId,
        actorUserId: claims.userId, action: "index.deletion_requested", targetType: "index", targetId: indexId,
        requestId: request.id, ip: request.ip, metadata: { jobId: id, slug: current.slug } });
      return id;
    });
    return reply.code(202).send({ jobId, indexId, state: "deleting" });
  });
}
