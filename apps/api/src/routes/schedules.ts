import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { auditLogs, crawlSchedules, sources, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];
export async function scheduleRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.put("/v1/sources/:sourceId/schedule", async request => {
    const claims = await auth.verifyAccess(bearer(request));
    const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
    const body = z.object({ enabled: z.boolean(), intervalSeconds: z.union([
      z.literal(3600), z.literal(21600), z.literal(86400), z.literal(604800)
    ]) }).strict().parse(request.body);
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!source || source.kind !== "website") throw new AppError("SOURCE_NOT_FOUND", "Website source not found", 404);
    const access = await projectAccess(db, claims.userId, source.projectId, "developer");
    return db.transaction(async tx => {
      const nextRunAt = new Date(Date.now() + body.intervalSeconds * 1000);
      const [schedule] = await tx.insert(crawlSchedules).values({ sourceId, ...body, nextRunAt })
        .onConflictDoUpdate({ target: crawlSchedules.sourceId, set: { ...body, nextRunAt, updatedAt: new Date() } }).returning();
      await tx.insert(auditLogs).values({ organizationId: access.organizationId, projectId: source.projectId,
        actorUserId: claims.userId, action: "crawl_schedule.updated", targetType: "source", targetId: sourceId,
        requestId: request.id, ip: request.ip, metadata: body });
      return schedule;
    });
  });
}
