import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, avg, count, desc, eq, sql } from "drizzle-orm";
import {
  documents,
  indexes,
  indexVersions,
  jobs,
  memberships,
  projects,
  searchEvents,
  sources,
  crawlSchedules,
  type createDatabase
} from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";

type Db = ReturnType<typeof createDatabase>["db"];

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Access token required", 401);
  return header.slice(7);
}

async function ensureProjectAccess(db: Db, userId: string, projectId: string) {
  const [row] = await db.select({
    id: projects.id,
    name: projects.name,
    slug: projects.slug,
    organizationId: projects.organizationId,
    role: memberships.role,
    analyticsEnabled: projects.analyticsEnabled
  }).from(projects)
    .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
    .where(and(eq(projects.id, projectId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row) throw new AppError("PROJECT_NOT_FOUND", "Project not found", 404);
  return row;
}

export async function dashboardRoutes(app: FastifyInstance, db: Db, auth: AuthService) {
  app.get("/v1/me/projects", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const rows = await db.select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      organizationId: projects.organizationId,
      role: memberships.role,
      updatedAt: projects.updatedAt
    }).from(projects)
      .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
      .where(eq(memberships.userId, claims.userId))
      .orderBy(desc(projects.updatedAt));
    return { projects: rows };
  });

  app.get("/v1/projects/:projectId/overview", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await ensureProjectAccess(db, claims.userId, projectId);

    const [documentCount] = await db.select({ value: count() }).from(documents)
      .innerJoin(indexes, eq(indexes.id, documents.indexId))
      .where(and(eq(indexes.projectId, projectId), sql`${documents.deletedAt} is null`));
    const [searchStats] = await db.select({
      requests: count(),
      averageLatencyMs: avg(searchEvents.latencyMs)
    }).from(searchEvents).where(eq(searchEvents.projectId, projectId));
    const [zeroResults] = await db.select({ value: count() }).from(searchEvents)
      .where(and(eq(searchEvents.projectId, projectId), eq(searchEvents.resultCount, 0)));
    const [activeJobs] = await db.select({ value: count() }).from(jobs)
      .where(and(eq(jobs.projectId, projectId), sql`${jobs.state} in ('queued','running')`));
    const [sourceCount] = await db.select({ value: count() }).from(sources).where(eq(sources.projectId, projectId));
    const activeVersions = await db.select({
      indexId: indexes.id,
      indexName: indexes.name,
      version: indexVersions.sequence,
      documentCount: indexVersions.documentCount,
      indexedBytes: indexVersions.indexedBytes,
      activatedAt: indexVersions.activatedAt
    }).from(indexes)
      .leftJoin(indexVersions, eq(indexVersions.id, indexes.activeVersionId))
      .where(eq(indexes.projectId, projectId));

    const requests = Number(searchStats?.requests ?? 0);
    const zeros = Number(zeroResults?.value ?? 0);
    return {
      documents: Number(documentCount?.value ?? 0),
      searches: requests,
      averageLatencyMs: Number(searchStats?.averageLatencyMs ?? 0),
      zeroResultRate: requests === 0 ? 0 : zeros / requests,
      activeJobs: Number(activeJobs?.value ?? 0),
      sources: Number(sourceCount?.value ?? 0),
      indexes: activeVersions
    };
  });

  app.get("/v1/projects/:projectId/analytics", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await ensureProjectAccess(db, claims.userId, projectId);

    const topQueries = await db.select({
      query: searchEvents.query,
      searches: count(),
      averageLatencyMs: avg(searchEvents.latencyMs)
    }).from(searchEvents)
      .where(eq(searchEvents.projectId, projectId))
      .groupBy(searchEvents.query)
      .orderBy(desc(count()))
      .limit(20);

    const zeroResultQueries = await db.select({
      query: searchEvents.query,
      searches: count()
    }).from(searchEvents)
      .where(and(eq(searchEvents.projectId, projectId), eq(searchEvents.resultCount, 0)))
      .groupBy(searchEvents.query)
      .orderBy(desc(count()))
      .limit(20);

    return { topQueries, zeroResultQueries };
  });

  app.get("/v1/projects/:projectId/resources", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await ensureProjectAccess(db, claims.userId, projectId);
    const [sourceRows, indexRows, jobRows, scheduleRows] = await Promise.all([
      db.select().from(sources).where(eq(sources.projectId, projectId)).orderBy(desc(sources.updatedAt)),
      db.select().from(indexes).where(eq(indexes.projectId, projectId)).orderBy(desc(indexes.updatedAt)),
      db.select().from(jobs).where(eq(jobs.projectId, projectId)).orderBy(desc(jobs.createdAt)).limit(25),
      db.select({ schedule: crawlSchedules }).from(crawlSchedules).innerJoin(sources, eq(sources.id, crawlSchedules.sourceId)).where(eq(sources.projectId, projectId))
    ]);
    return { sources: sourceRows, indexes: indexRows, jobs: jobRows, schedules: scheduleRows.map(row => row.schedule) };
  });
}
