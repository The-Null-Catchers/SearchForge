import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, avg, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import {
  documents,
  indexes,
  indexVersions,
  jobs,
  memberships,
  projects,
  searchClicks,
  searchEvents,
  sources,
  crawlSchedules,
  type createDatabase
} from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";

type Db = ReturnType<typeof createDatabase>["db"];
const ANALYTICS_PRIVACY_THRESHOLD = 3;

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
    .where(and(
      eq(projects.id, projectId),
      eq(memberships.userId, userId),
      isNull(projects.deletionRequestedAt),
      isNull(projects.deletedAt)
    ))
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
      .where(and(
        eq(memberships.userId, claims.userId),
        isNull(projects.deletionRequestedAt),
        isNull(projects.deletedAt)
      ))
      .orderBy(desc(projects.updatedAt));
    return { projects: rows };
  });

  app.get("/v1/projects/:projectId/overview", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await ensureProjectAccess(db, claims.userId, projectId);

    const [documentCount] = await db.select({ value: count() }).from(documents)
      .innerJoin(indexes, eq(indexes.id, documents.indexId))
      .where(and(eq(indexes.projectId, projectId), sql`${documents.deletedAt} is null`, sql`${indexes.deletionRequestedAt} is null`));
    const [searchStats] = await db.select({
      requests: count(),
      averageLatencyMs: avg(searchEvents.latencyMs)
    }).from(searchEvents).where(eq(searchEvents.projectId, projectId));
    const [zeroResults] = await db.select({ value: count() }).from(searchEvents)
      .where(and(eq(searchEvents.projectId, projectId), eq(searchEvents.resultCount, 0)));
    const [activeJobs] = await db.select({ value: count() }).from(jobs)
      .where(and(eq(jobs.projectId, projectId), sql`${jobs.state} in ('queued','running')`));
    const [sourceCount] = await db.select({ value: count() }).from(sources).where(and(eq(sources.projectId, projectId), sql`${sources.deletionRequestedAt} is null`));
    const activeVersions = await db.select({
      indexId: indexes.id,
      indexName: indexes.name,
      version: indexVersions.sequence,
      documentCount: indexVersions.documentCount,
      indexedBytes: indexVersions.indexedBytes,
      activatedAt: indexVersions.activatedAt
    }).from(indexes)
      .leftJoin(indexVersions, eq(indexVersions.id, indexes.activeVersionId))
      .where(and(eq(indexes.projectId, projectId), sql`${indexes.deletionRequestedAt} is null`));

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
    const { days } = z.object({ days: z.coerce.number().int().refine(value => [7, 30, 90].includes(value)).default(30) }).parse(request.query);
    const project = await ensureProjectAccess(db, claims.userId, projectId);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const dayExpression = sql<string>`to_char(date_trunc('day', ${searchEvents.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
    const clickDayExpression = sql<string>`to_char(date_trunc('day', ${searchClicks.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;

    const [searchSummary, zeroSummary, clickSummary, timelineRows, clickTimelineRows, topQueries, zeroResultQueries] = await Promise.all([
      db.select({ searches: count(), averageLatencyMs: avg(searchEvents.latencyMs) }).from(searchEvents)
        .where(and(eq(searchEvents.projectId, projectId), gte(searchEvents.createdAt, since))),
      db.select({ zeroResults: count() }).from(searchEvents)
        .where(and(eq(searchEvents.projectId, projectId), gte(searchEvents.createdAt, since), eq(searchEvents.resultCount, 0))),
      db.select({ clicks: count() }).from(searchClicks)
        .where(and(eq(searchClicks.projectId, projectId), gte(searchClicks.createdAt, since))),
      db.select({
        day: dayExpression,
        searches: count(),
        zeroResults: sql<number>`count(*) filter (where ${searchEvents.resultCount} = 0)`,
        averageLatencyMs: avg(searchEvents.latencyMs)
      }).from(searchEvents)
        .where(and(eq(searchEvents.projectId, projectId), gte(searchEvents.createdAt, since)))
        .groupBy(sql`date_trunc('day', ${searchEvents.createdAt} at time zone 'UTC')`)
        .orderBy(sql`date_trunc('day', ${searchEvents.createdAt} at time zone 'UTC')`),
      db.select({ day: clickDayExpression, clicks: count() }).from(searchClicks)
        .where(and(eq(searchClicks.projectId, projectId), gte(searchClicks.createdAt, since)))
        .groupBy(sql`date_trunc('day', ${searchClicks.createdAt} at time zone 'UTC')`)
        .orderBy(sql`date_trunc('day', ${searchClicks.createdAt} at time zone 'UTC')`),
      db.select({ query: searchEvents.query, searches: count(), averageLatencyMs: avg(searchEvents.latencyMs) }).from(searchEvents)
        .where(and(eq(searchEvents.projectId, projectId), gte(searchEvents.createdAt, since)))
        .groupBy(searchEvents.query)
        .having(sql`count(*) >= ${ANALYTICS_PRIVACY_THRESHOLD}`)
        .orderBy(desc(count()))
        .limit(20),
      db.select({ query: searchEvents.query, searches: count(), averageLatencyMs: avg(searchEvents.latencyMs) }).from(searchEvents)
        .where(and(eq(searchEvents.projectId, projectId), gte(searchEvents.createdAt, since), eq(searchEvents.resultCount, 0)))
        .groupBy(searchEvents.query)
        .having(sql`count(*) >= ${ANALYTICS_PRIVACY_THRESHOLD}`)
        .orderBy(desc(count()))
        .limit(20)
    ]);

    const searches = Number(searchSummary[0]?.searches ?? 0);
    const clicks = Number(clickSummary[0]?.clicks ?? 0);
    const zeroResults = Number(zeroSummary[0]?.zeroResults ?? 0);
    const clicksByDay = new Map(clickTimelineRows.map(row => [row.day, Number(row.clicks)]));
    const timeline = timelineRows.map(row => ({
      day: row.day,
      searches: Number(row.searches),
      clicks: clicksByDay.get(row.day) ?? 0,
      zeroResultRate: Number(row.searches) === 0 ? 0 : Number(row.zeroResults) / Number(row.searches),
      averageLatencyMs: Number(row.averageLatencyMs ?? 0)
    }));

    return {
      days,
      analyticsEnabled: project.analyticsEnabled,
      privacyThreshold: ANALYTICS_PRIVACY_THRESHOLD,
      summary: {
        searches,
        clicks,
        clickThroughRate: searches === 0 ? 0 : clicks / searches,
        zeroResultRate: searches === 0 ? 0 : zeroResults / searches,
        averageLatencyMs: Number(searchSummary[0]?.averageLatencyMs ?? 0)
      },
      timeline,
      topQueries,
      zeroResultQueries
    };
  });

  app.get("/v1/projects/:projectId/resources", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await ensureProjectAccess(db, claims.userId, projectId);
    const [sourceRows, indexRows, jobRows, scheduleRows] = await Promise.all([
      db.select().from(sources).where(eq(sources.projectId, projectId)).orderBy(desc(sources.updatedAt)),
      db.select().from(indexes).where(and(eq(indexes.projectId, projectId), sql`${indexes.deletionRequestedAt} is null`)).orderBy(desc(indexes.updatedAt)),
      db.select().from(jobs).where(eq(jobs.projectId, projectId)).orderBy(desc(jobs.createdAt)).limit(25),
      db.select({ schedule: crawlSchedules }).from(crawlSchedules).innerJoin(sources, eq(sources.id, crawlSchedules.sourceId)).where(eq(sources.projectId, projectId))
    ]);
    return { sources: sourceRows, indexes: indexRows, jobs: jobRows, schedules: scheduleRows.map(row => row.schedule) };
  });
}
