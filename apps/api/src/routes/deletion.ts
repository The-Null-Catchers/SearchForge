import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { apiKeys, auditLogs, crawlSchedules, indexVersions, indexes, jobOutbox, jobs, memberships, projects, sources, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];
export async function deletionRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.delete("/v1/projects/:projectId", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const { confirmation } = z.object({ confirmation: z.string().min(1).max(80) }).strict().parse(request.body);

    const [access] = await db.select({ project: projects, role: memberships.role })
      .from(projects)
      .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
      .where(and(eq(projects.id, projectId), eq(memberships.userId, claims.userId)))
      .limit(1);
    if (!access || access.project.deletedAt) throw new AppError("PROJECT_NOT_FOUND", "Project not found", 404);
    if (access.role !== "owner") throw new AppError("FORBIDDEN", "Only an organization owner can delete a project", 403);

    const jobId = await db.transaction(async tx => {
      // Existing producers lock index/source before their direct project write.
      // Preserve that order, then take the project lock. Once the project UPDATE
      // lock is held, project-write triggers prevent new children from appearing.
      await tx.select({ id: indexes.id }).from(indexes).where(eq(indexes.projectId, projectId))
        .orderBy(asc(indexes.id)).for("update");
      await tx.select({ id: sources.id }).from(sources).where(eq(sources.projectId, projectId))
        .orderBy(asc(sources.id)).for("update");
      const [current] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
      if (!current || current.deletedAt) throw new AppError("PROJECT_NOT_FOUND", "Project not found", 404);
      if (confirmation !== current.slug) {
        throw new AppError("CONFIRMATION_REQUIRED", "Type the project slug to confirm deletion", 400);
      }

      const cleanupJobs = await tx.select().from(jobs)
        .where(and(eq(jobs.projectId, projectId), eq(jobs.type, "cleanup")))
        .orderBy(asc(jobs.createdAt));
      const existing = cleanupJobs.find(job =>
        job.progress.targetType === "project" && job.progress.targetId === projectId
      );
      if (current.deletionRequestedAt) {
        if (!existing) throw new Error("Deleting project has no cleanup job");
        if (existing.state === "failed") {
          await tx.update(jobs).set({
            state: "queued", phase: "queued", externalJobId: randomUUID(),
            errorCode: null, errorMessage: null, finishedAt: null, updatedAt: new Date()
          }).where(eq(jobs.id, existing.id));
          await tx.update(jobOutbox).set({ dispatchedAt: null, updatedAt: new Date() })
            .where(eq(jobOutbox.jobId, existing.id));
          await tx.insert(auditLogs).values({
            organizationId: current.organizationId, projectId,
            actorUserId: claims.userId, action: "project.deletion_retried",
            targetType: "project", targetId: projectId, requestId: request.id, ip: request.ip,
            metadata: { jobId: existing.id }
          });
        }
        return existing.id;
      }

      const now = new Date();
      // Re-read after the project lock so any child admitted just before the lock
      // is included in the deletion fence.
      const projectIndexes = await tx.select().from(indexes)
        .where(eq(indexes.projectId, projectId)).orderBy(asc(indexes.id)).for("update");
      const projectSources = await tx.select().from(sources)
        .where(eq(sources.projectId, projectId)).orderBy(asc(sources.id)).for("update");

      if (projectSources.length > 0) {
        const sourceIds = projectSources.map(source => source.id);
        await tx.update(crawlSchedules).set({ enabled: false, updatedAt: now })
          .where(inArray(crawlSchedules.sourceId, sourceIds));
        await tx.update(sources).set({ enabled: false, deletionRequestedAt: now, updatedAt: now })
          .where(inArray(sources.id, sourceIds));
      }
      if (projectIndexes.length > 0) {
        await tx.update(indexes).set({ deletionRequestedAt: now, updatedAt: now })
          .where(inArray(indexes.id, projectIndexes.map(index => index.id)));
      }

      await tx.update(apiKeys).set({ revokedAt: now, updatedAt: now })
        .where(eq(apiKeys.projectId, projectId));
      await tx.update(jobs).set({
        cancelRequestedAt: now, state: "cancelled", phase: "cancelled",
        finishedAt: now, updatedAt: now
      }).where(and(
        eq(jobs.projectId, projectId),
        ne(jobs.type, "cleanup"),
        inArray(jobs.state, ["queued", "running"])
      ));
      await tx.update(projects).set({ deletionRequestedAt: now, updatedAt: now })
        .where(eq(projects.id, projectId));

      const id = randomUUID();
      await tx.insert(jobs).values({
        id, externalJobId: randomUUID(), projectId, type: "cleanup",
        progress: { targetType: "project", targetId: projectId }
      });
      await tx.insert(jobOutbox).values({
        jobId: id, queue: "cleanup", name: "delete-project", priority: 1,
        payload: { databaseJobId: id, projectId, targetType: "project", targetId: projectId }
      });
      await tx.insert(auditLogs).values({
        organizationId: current.organizationId, projectId,
        actorUserId: claims.userId, action: "project.deletion_requested",
        targetType: "project", targetId: projectId, requestId: request.id, ip: request.ip,
        metadata: {
          jobId: id,
          slug: current.slug,
          indexCount: projectIndexes.length,
          sourceCount: projectSources.length
        }
      });
      return id;
    });

    return reply.code(202).send({ jobId, projectId, state: "deleting" });
  });
  app.delete("/v1/sources/:sourceId", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
    const { confirmation } = z.object({ confirmation: z.string().min(1).max(140) }).strict().parse(request.body);
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!source) throw new AppError("SOURCE_NOT_FOUND", "Source not found", 404);
    const access = await projectAccess(db, claims.userId, source.projectId, "admin");
    const jobId = await db.transaction(async tx => {
      // Scheduler locks schedule before source. Document/activation producers
      // lock index before source/job; preserve both orders during admission.
      await tx.select().from(crawlSchedules).where(eq(crawlSchedules.sourceId, sourceId)).for("update");
      const projectIndexes = await tx.select().from(indexes).where(eq(indexes.projectId, source.projectId))
        .orderBy(asc(indexes.id)).for("update");
      const [current] = await tx.select().from(sources).where(eq(sources.id, sourceId)).for("update");
      if (!current) throw new AppError("SOURCE_NOT_FOUND", "Source not found", 404);
      if (confirmation !== current.name) throw new AppError("CONFIRMATION_REQUIRED", "Type the source name to confirm deletion", 400);
      if (current.deletionRequestedAt) {
        const [existing] = await tx.select().from(jobs)
          .where(and(eq(jobs.sourceId, sourceId), eq(jobs.type, "cleanup"))).limit(1);
        if (!existing) throw new Error("Deleting source has no cleanup job");
        if (existing.state === "failed") {
          await tx.update(jobs).set({ state: "queued", phase: "queued", externalJobId: randomUUID(),
            errorCode: null, errorMessage: null, finishedAt: null, updatedAt: new Date() }).where(eq(jobs.id, existing.id));
          await tx.update(jobOutbox).set({ dispatchedAt: null, updatedAt: new Date() }).where(eq(jobOutbox.jobId, existing.id));
          await tx.insert(auditLogs).values({ organizationId: access.organizationId, projectId: source.projectId,
            actorUserId: claims.userId, action: "source.deletion_retried", targetType: "source", targetId: sourceId,
            requestId: request.id, ip: request.ip, metadata: { jobId: existing.id } });
        }
        return existing.id;
      }
      const now = new Date();
      await tx.update(crawlSchedules).set({ enabled: false, updatedAt: now }).where(eq(crawlSchedules.sourceId, sourceId));
      await tx.update(sources).set({ deletionRequestedAt: now, enabled: false, updatedAt: now }).where(eq(sources.id, sourceId));
      // Retained segments may contain this source even when its documents were
      // previously tombstoned. Conservatively fence every index in the project.
      for (const index of projectIndexes) {
        const [maximum] = await tx.select({ value: sql<number>`coalesce(max(${indexVersions.sequence}), 0)` })
          .from(indexVersions).where(eq(indexVersions.indexId, index.id));
        await tx.update(indexes).set({ minimumVersionSequence: Math.max(index.minimumVersionSequence, Number(maximum?.value ?? 0) + 1), updatedAt: now })
          .where(eq(indexes.id, index.id));
      }
      await tx.update(jobs).set({ cancelRequestedAt: now, state: "cancelled", phase: "cancelled", finishedAt: now, updatedAt: now })
        .where(and(eq(jobs.sourceId, sourceId), ne(jobs.type, "cleanup"), inArray(jobs.state, ["queued", "running"])));
      const id = randomUUID();
      await tx.insert(jobs).values({ id, externalJobId: randomUUID(), projectId: source.projectId, sourceId,
        type: "cleanup", progress: { targetType: "source", targetId: sourceId } });
      await tx.insert(jobOutbox).values({ jobId: id, queue: "cleanup", name: "delete-source", priority: 1,
        payload: { databaseJobId: id, projectId: source.projectId, targetType: "source", targetId: sourceId } });
      await tx.insert(auditLogs).values({ organizationId: access.organizationId, projectId: source.projectId,
        actorUserId: claims.userId, action: "source.deletion_requested", targetType: "source", targetId: sourceId,
        requestId: request.id, ip: request.ip, metadata: { jobId: id, name: current.name } });
      return id;
    });
    return reply.code(202).send({ jobId, sourceId, state: "deleting" });
  });

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
