import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { jobs, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type IORedis from "ioredis";
import type { AuthService } from "../auth.js";

type Db = ReturnType<typeof createDatabase>["db"];

export async function jobRoutes(app: FastifyInstance, db: Db, redis: IORedis, auth: AuthService) {
  app.get("/v1/jobs/:jobId", async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Access token required", 401);
    await auth.verifyAccess(header.slice(7));
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) throw new AppError("JOB_NOT_FOUND", "Job not found", 404);
    return job;
  });

  app.get("/v1/jobs/:jobId/events", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Access token required", 401);
    await auth.verifyAccess(header.slice(7));
    const { jobId } = z.object({ jobId: z.string().uuid() }).parse(request.params);
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
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      subscriber.off("message", send);
      void subscriber.unsubscribe().finally(() => subscriber.quit());
    });
  });
}
