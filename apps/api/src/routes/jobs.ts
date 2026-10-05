import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { auditLogs, jobOutbox, jobs, projects, memberships, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { Redis as IORedis } from "ioredis";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];

export async function jobRoutes(app: FastifyInstance, db: Db, redis: IORedis, auth: AuthService) {
  app.get("/v1/projects/:projectId/jobs/dead-letter", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await projectAccess(db, claims.userId, projectId, "developer");
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    const rows = await db.select({ job: jobs, outbox: jobOutbox }).from(jobs)
      .leftJoin(jobOutbox, eq(jobOutbox.jobId, jobs.id))
      .where(and(eq(jobs.projectId, projectId), eq(jobs.state, "failed")))
      .orderBy(desc(jobs.finishedAt), desc(jobs.updatedAt)).limit(limit);
    return {
      jobs: rows.map(({ job, outbox }) => ({
        ...job,
        retryable: Boolean(outbox) && ["crawl", "index"].includes(job.type),
        queue: outbox?.queue ?? null,
        dispatchedAt: outbox?.dispatchedAt ?? null
      }))
    };
  });

  app.post("/v1/jobs/:jobId/retry", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const [visible] = await db.select({ job: jobs }).from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
      .where(and(eq(jobs.id, jobId), eq(memberships.userId, claims.userId))).limit(1);
    if (!visible) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    const access = await projectAccess(db, claims.userId, visible.job.projectId, "admin");

    const retried = await db.transaction(async tx => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
      if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
      if (job.state !== "failed") throw new AppError("VALIDATION_ERROR", "Only failed jobs can be retried", 409);
      if (!["crawl", "index"].includes(job.type)) throw new AppError("VALIDATION_ERROR", "This job type is not retryable", 409);

      const [outbox] = await tx.select().from(jobOutbox).where(eq(jobOutbox.jobId, jobId)).for("update");
      if (!outbox) throw new AppError("VALIDATION_ERROR", "Retry metadata is no longer retained for this job", 409);

      if (job.type === "crawl" && job.sourceId) {
        const [active] = await tx.select({ id: jobs.id }).from(jobs).where(and(
          eq(jobs.projectId, job.projectId), eq(jobs.sourceId, job.sourceId), eq(jobs.type, "crawl"),
          inArray(jobs.state, ["queued", "running"]), ne(jobs.id, jobId)
        )).limit(1);
        if (active) throw new AppError("VALIDATION_ERROR", "A crawl for this source is already active", 409);
      }
      if (job.type === "index" && job.indexId) {
        const [active] = await tx.select({ id: jobs.id }).from(jobs).where(and(
          eq(jobs.projectId, job.projectId), eq(jobs.indexId, job.indexId), eq(jobs.type, "index"),
          inArray(jobs.state, ["queued", "running"]), ne(jobs.id, jobId)
        )).limit(1);
        if (active) throw new AppError("VALIDATION_ERROR", "An index build for this index is already active", 409);
      }

      const now = new Date();
      const externalJobId = randomUUID();
      const [updated] = await tx.update(jobs).set({
        externalJobId,
        state: "queued",
        phase: "queued",
        progress: {},
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        cancelRequestedAt: null,
        updatedAt: now
      }).where(eq(jobs.id, jobId)).returning();
      await tx.update(jobOutbox).set({ dispatchedAt: null, updatedAt: now }).where(eq(jobOutbox.jobId, jobId));
      await tx.insert(auditLogs).values({
        organizationId: access.organizationId,
        projectId: job.projectId,
        actorUserId: claims.userId,
        action: "job.retry_requested",
        targetType: "job",
        targetId: jobId,
        requestId: request.id,
        ip: request.ip,
        metadata: { previousErrorCode: job.errorCode, queue: outbox.queue }
      });
      return updated!;
    });

    await redis.publish(`job:${jobId}`, JSON.stringify({ status: retried.state, phase: retried.phase }))
      .catch(error => request.log.error({ err: error }, "Retry notification failed"));
    return retried;
  });

  app.post("/v1/jobs/:jobId/cancel", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const [row] = await db.select({ job: jobs }).from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
      .where(and(eq(jobs.id, jobId), eq(memberships.userId, claims.userId))).limit(1);
    if (!row) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    if (row.job.type === "cleanup") {
      throw new AppError("JOB_NOT_CANCELLABLE", "Deletion cleanup must finish once accepted", 409);
    }
    const access = await projectAccess(db, claims.userId, row.job.projectId, "developer");
    const result = await db.transaction(async tx => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
      if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
      if (job.type === "cleanup") throw new AppError("JOB_NOT_CANCELLABLE", "Deletion cleanup must finish once accepted", 409);
      if (job.state === "cancelled" || job.cancelRequestedAt) return job;
      if (!["queued", "running"].includes(job.state)) throw new AppError("JOB_FINISHED", "Finished jobs cannot be cancelled", 409);
      const now = new Date();
      const [updated] = await tx.update(jobs).set({ cancelRequestedAt: now, updatedAt: now,
        ...(job.state === "queued" ? { state: "cancelled" as const, phase: "cancelled", finishedAt: now } : { phase: "cancelling" })
      }).where(eq(jobs.id, jobId)).returning();
      await tx.insert(auditLogs).values({ organizationId: access.organizationId, projectId: job.projectId,
        actorUserId: claims.userId, action: "job.cancel_requested", targetType: "job", targetId: jobId,
        requestId: request.id, ip: request.ip });
      return updated!;
    });
    await redis.publish(`job:${jobId}`, JSON.stringify({ status: result.state, phase: result.phase }))
      .catch(error => request.log.error({ err: error }, "Cancellation notification failed"));
    return result;
  });

  app.get("/v1/jobs/:jobId", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Access token required", 401);
    const claims = await auth.verifyAccess(header.slice(7));
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const [row] = await db.select({ job: jobs }).from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
      .where(and(eq(jobs.id, jobId), eq(memberships.userId, claims.userId))).limit(1);
    const job = row?.job;
    if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    return job;
  });

  app.get("/v1/jobs/:jobId/events", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Access token required", 401);
    const claims = await auth.verifyAccess(header.slice(7));
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const [row] = await db.select({ id: jobs.id, state: jobs.state, phase: jobs.phase, progress: jobs.progress }).from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
      .where(and(eq(jobs.id, jobId), eq(memberships.userId, claims.userId))).limit(1);
    if (!row) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    const subscriber = redis.duplicate();
    await subscriber.subscribe(`job:${jobId}`);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = (channel: string, message: string) => {
      if (channel === `job:${jobId}`) reply.raw.write(`event: progress\ndata: ${message}\n\n`);
    };
    subscriber.on("message", send);
    reply.raw.write(`event: progress\ndata: ${JSON.stringify({ ...row.progress, status: row.state, phase: row.phase })}\n\n`);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      subscriber.off("message", send);
      void subscriber.unsubscribe().then(() => subscriber.quit()).catch((error: unknown) => request.log.error({ err: error }, "SSE subscriber cleanup failed"));
    });
  });
}
