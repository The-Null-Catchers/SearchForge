import type { FastifyInstance } from "fastify";
import { and, count, eq, isNull } from "drizzle-orm";
import { auditLogs, documents, indexes, projectQuotas, usageCounters, type createDatabase } from "@searchforge/db";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];

const quotaValue = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable();
const quotaSchema = z.object({
  monthlySearches: quotaValue,
  monthlyApiRequests: quotaValue,
  monthlyCrawlPages: quotaValue,
  maxDocuments: quotaValue,
  warningPercent: z.number().int().min(1).max(99)
}).strict();

function monthPeriod(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function quotaStatus(used: number, limit: number | null, warningPercent: number) {
  if (limit === null) return { used, limit, percent: null, state: "unlimited" as const };
  const percent = limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  return {
    used,
    limit,
    percent,
    state: used >= limit ? "exceeded" as const : percent >= warningPercent ? "warning" as const : "ok" as const
  };
}

export async function quotaRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.get("/v1/projects/:projectId/quotas", async request => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, projectId, "viewer");

    const period = monthPeriod();
    const [[quota], [usage], [documentCount]] = await Promise.all([
      db.select().from(projectQuotas).where(eq(projectQuotas.projectId, projectId)).limit(1),
      db.select().from(usageCounters).where(and(eq(usageCounters.projectId, projectId), eq(usageCounters.period, period))).limit(1),
      db.select({ value: count() }).from(documents)
        .innerJoin(indexes, eq(indexes.id, documents.indexId))
        .where(and(eq(indexes.projectId, projectId), isNull(indexes.deletionRequestedAt), isNull(documents.deletedAt)))
    ]);

    const limits = {
      monthlySearches: quota?.monthlySearches ?? null,
      monthlyApiRequests: quota?.monthlyApiRequests ?? null,
      monthlyCrawlPages: quota?.monthlyCrawlPages ?? null,
      maxDocuments: quota?.maxDocuments ?? null,
      warningPercent: quota?.warningPercent ?? 80
    };
    const current = {
      searches: Number(usage?.searches ?? 0),
      apiRequests: Number(usage?.apiRequests ?? 0),
      crawlPages: Number(usage?.crawlPages ?? 0),
      documents: Number(documentCount?.value ?? 0)
    };
    const metrics = {
      searches: quotaStatus(current.searches, limits.monthlySearches, limits.warningPercent),
      apiRequests: quotaStatus(current.apiRequests, limits.monthlyApiRequests, limits.warningPercent),
      crawlPages: quotaStatus(current.crawlPages, limits.monthlyCrawlPages, limits.warningPercent),
      documents: quotaStatus(current.documents, limits.maxDocuments, limits.warningPercent)
    };
    const notifications = Object.entries(metrics)
      .filter(([, value]) => value.state === "warning" || value.state === "exceeded")
      .map(([metric, value]) => ({ metric, state: value.state, percent: value.percent, used: value.used, limit: value.limit }));

    return { period, role: access.role, limits, current, metrics, notifications };
  });

  app.put("/v1/projects/:projectId/quotas", async request => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, projectId, "admin");
    const body = quotaSchema.parse(request.body);

    return db.transaction(async tx => {
      const [previous] = await tx.select().from(projectQuotas).where(eq(projectQuotas.projectId, projectId)).for("update");
      const [updated] = await tx.insert(projectQuotas).values({ projectId, ...body, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: projectQuotas.projectId,
          set: { ...body, updatedAt: new Date() }
        })
        .returning();
      await tx.insert(auditLogs).values({
        organizationId: access.organizationId,
        projectId,
        actorUserId: claims.userId,
        action: "project.quotas_updated",
        targetType: "project",
        targetId: projectId,
        requestId: request.id,
        ip: request.ip,
        metadata: {
          previous: previous ? {
            monthlySearches: previous.monthlySearches,
            monthlyApiRequests: previous.monthlyApiRequests,
            monthlyCrawlPages: previous.monthlyCrawlPages,
            maxDocuments: previous.maxDocuments,
            warningPercent: previous.warningPercent
          } : null,
          current: body
        }
      });
      return updated;
    });
  });
}
