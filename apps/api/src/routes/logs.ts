import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { auditLogs, jobs, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import { projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Access token required", 401);
  return header.slice(7);
}

type DeveloperLog = {
  id: string;
  kind: "audit" | "job";
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  requestId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

export async function logRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.get("/v1/projects/:projectId/logs", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await projectAccess(db, claims.userId, projectId, "viewer");
    const query = z.object({
      kind: z.enum(["all", "audit", "job"]).default("all"),
      level: z.enum(["all", "info", "warn", "error"]).default("all"),
      q: z.string().max(200).default(""),
      limit: z.coerce.number().int().min(1).max(200).default(50)
    }).parse(request.query);

    const needle = query.q.trim();
    const auditRows = query.kind === "job" ? [] : await db.select().from(auditLogs)
      .where(and(
        eq(auditLogs.projectId, projectId),
        needle ? or(
          ilike(auditLogs.action, `%${needle}%`),
          ilike(auditLogs.targetType, `%${needle}%`),
          ilike(auditLogs.targetId, `%${needle}%`),
          ilike(auditLogs.requestId, `%${needle}%`)
        ) : undefined
      ))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(query.limit * 2, 200));

    const jobRows = query.kind === "audit" ? [] : await db.select().from(jobs)
      .where(and(
        eq(jobs.projectId, projectId),
        needle ? or(
          ilike(jobs.type, `%${needle}%`),
          ilike(jobs.phase, `%${needle}%`),
          ilike(jobs.errorCode, `%${needle}%`),
          ilike(jobs.errorMessage, `%${needle}%`)
        ) : undefined
      ))
      .orderBy(desc(jobs.updatedAt))
      .limit(Math.min(query.limit * 2, 200));

    const logs: DeveloperLog[] = [
      ...auditRows.map(row => ({
        id: `audit:${row.id}`,
        kind: "audit" as const,
        level: "info" as const,
        event: row.action,
        message: row.targetType ? `${row.action} · ${row.targetType}` : row.action,
        requestId: row.requestId,
        targetType: row.targetType,
        targetId: row.targetId,
        metadata: row.metadata ?? {},
        createdAt: row.createdAt
      })),
      ...jobRows.map(row => ({
        id: `job:${row.id}`,
        kind: "job" as const,
        level: (row.state === "failed" ? "error" : row.state === "cancelled" ? "warn" : "info") as "info" | "warn" | "error",
        event: `job.${row.state}`,
        message: row.errorMessage || `${row.type} · ${row.phase}`,
        requestId: null,
        targetType: row.sourceId ? "source" : row.indexId ? "index" : "job",
        targetId: row.sourceId ?? row.indexId ?? row.id,
        metadata: {
          jobId: row.id,
          type: row.type,
          state: row.state,
          phase: row.phase,
          errorCode: row.errorCode,
          progress: row.progress
        },
        createdAt: row.updatedAt
      }))
    ];

    const filtered = logs
      .filter(row => query.level === "all" || row.level === query.level)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, query.limit);

    return {
      logs: filtered.map(row => ({ ...row, createdAt: row.createdAt.toISOString() })),
      count: filtered.length
    };
  });
}
