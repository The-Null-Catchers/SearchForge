import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { auditLogs, jobs, projects, memberships, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { Redis as IORedis } from "ioredis";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];

export async function jobRoutes(app: FastifyInstance, db: Db, redis: IORedis, auth: AuthService) {
  app.post("/v1/jobs/:jobId/cancel", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const [row] = await db.select({ job: jobs }).from(jobs)
      .innerJoin(projects, eq(projects.id, jobs.projectId))
      .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
      .where(and(eq(jobs.id, jobId), eq(memberships.userId, claims.userId))).limit(1);
    if (!row) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    const access = await projectAccess(db, claims.userId, row.job.projectId, "developer");
    const result = await db.transaction(async tx => {
      const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).for("update");
      if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
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
    // Cancellation is committed even if the progress transport is temporarily down.
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
