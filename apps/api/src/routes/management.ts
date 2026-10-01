import type { FastifyInstance, FastifyRequest } from "fastify";
import { enqueueCrawl } from "@searchforge/queue";
import { and, desc, eq, getTableColumns, lt, or, sql } from "drizzle-orm";
import {
  apiKeys,
  auditLogs,
  crawlPages,
  indexVersions,
  indexes,
  jobs,
  memberships,
  projects,
  sources,
  synonymSets,
  type createDatabase
} from "@searchforge/db";
import { AppError, crawlConfigSchema } from "@searchforge/shared";
import { z } from "zod";
import type { ApiKeyService, KeyKind } from "../api-keys.js";
import type { AuthService } from "../auth.js";
import { crawlCursorScope, decodeCrawlCursor, encodeCrawlCursor } from "../crawl-cursor.js";

type Db = ReturnType<typeof createDatabase>["db"];
const roleWeight = { viewer: 0, developer: 1, admin: 2, owner: 3 } as const;

export function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Access token required", 401);
  return header.slice(7);
}

export async function projectAccess(db: Db, userId: string, projectId: string, minimum: keyof typeof roleWeight) {
  const [row] = await db.select({
    projectId: projects.id,
    organizationId: projects.organizationId,
    role: memberships.role
  })
    .from(projects)
    .innerJoin(memberships, eq(memberships.organizationId, projects.organizationId))
    .where(and(eq(projects.id, projectId), eq(memberships.userId, userId)))
    .limit(1);
  if (!row || roleWeight[row.role] < roleWeight[minimum]) throw new AppError("FORBIDDEN", "Insufficient project permissions", 403);
  return row;
}

export async function managementRoutes(
  app: FastifyInstance,
  db: Db,
  auth: AuthService,
  keyService: ApiKeyService
) {
  app.put("/v1/sources/:sourceId", async request => {
    const claims = await auth.verifyAccess(bearer(request));
    const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
    const body = z.object({ name: z.string().min(1).max(140), config: crawlConfigSchema }).strict().parse(request.body);
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!source || source.deletionRequestedAt || source.kind !== "website") throw new AppError("SOURCE_NOT_FOUND", "Website source not found", 404);
    const access = await projectAccess(db, claims.userId, source.projectId, "developer");
    return db.transaction(async tx => {
      const [current] = await tx.select().from(sources).where(eq(sources.id, sourceId)).for("update");
      if (!current || current.deletionRequestedAt) throw new AppError("SOURCE_NOT_FOUND", "Website source not found", 404);
      const [updated] = await tx.update(sources).set({ name: body.name, config: body.config, updatedAt: new Date() })
        .where(eq(sources.id, sourceId)).returning();
      await tx.insert(auditLogs).values({ organizationId: access.organizationId, projectId: source.projectId,
        actorUserId: claims.userId, action: "source.rules_updated", targetType: "source", targetId: sourceId,
        requestId: request.id, ip: request.ip, metadata: { previous: current.config, current: body.config } });
      return updated;
    });
  });

  app.post("/v1/projects/:projectId/sources", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, projectId, "developer");
    const body = z.object({
      name: z.string().min(1).max(140),
      config: crawlConfigSchema
    }).parse(request.body);
    const [source] = await db.insert(sources).values({
      projectId,
      kind: "website",
      name: body.name,
      config: body.config
    }).returning();
    await db.insert(auditLogs).values({
      organizationId: access.organizationId,
      projectId,
      actorUserId: claims.userId,
      action: "source.created",
      targetType: "source",
      targetId: source!.id,
      requestId: request.id,
      ip: request.ip
    });
    return reply.code(201).send(source);
  });

  app.post("/v1/sources/:sourceId/crawl", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!source || source.deletionRequestedAt) throw new AppError("SOURCE_NOT_FOUND", "Source not found", 404);
    await projectAccess(db, claims.userId, source.projectId, "developer");

    const databaseJobId = await db.transaction(tx => enqueueCrawl(tx, source.projectId, sourceId));
    return reply.code(202).send({ jobId: databaseJobId });
  });

  app.get("/v1/sources/:sourceId/pages", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { sourceId } = z.object({ sourceId: z.string().uuid() }).parse(request.params);
    const query = z.object({
      status: z.enum(["indexed", "unchanged", "blocked", "failed", "duplicate", "skipped"]).optional(),
      q: z.string().max(200).default(""),
      jobId: z.string().uuid().optional(),
      cursor: z.string().max(1000).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50)
    }).parse(request.query);
    const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!source || source.deletionRequestedAt) throw new AppError("SOURCE_NOT_FOUND", "Source not found", 404);
    await projectAccess(db, claims.userId, source.projectId, "viewer");
    const scope = crawlCursorScope(sourceId, query.status, query.q, query.jobId);
    const cursor = query.cursor ? decodeCrawlCursor(query.cursor, scope) : null;
    const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await db.select({ ...getTableColumns(crawlPages),
      cursorTime: sql<string>`to_char(${crawlPages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    }).from(crawlPages)
      .where(and(eq(crawlPages.sourceId, sourceId),
        query.status ? eq(crawlPages.status, query.status) : undefined,
        query.jobId ? eq(crawlPages.jobId, query.jobId) : undefined,
        query.q ? sql`${crawlPages.url} ilike ${pattern}` : undefined,
        cursor ? or(sql`${crawlPages.createdAt} < ${cursor.createdAt}::timestamptz`, and(sql`${crawlPages.createdAt} = ${cursor.createdAt}::timestamptz`, lt(crawlPages.id, cursor.id))) : undefined))
      .orderBy(desc(crawlPages.createdAt), desc(crawlPages.id))
      .limit(query.limit + 1);
    const last = rows[query.limit - 1];
    return { pages: rows.slice(0, query.limit).map(({ cursorTime, ...page }) => page),
      nextCursor: rows.length > query.limit && last ? encodeCrawlCursor(last.cursorTime, last.id, scope) : null };
  });

  app.post("/v1/projects/:projectId/synonyms", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await projectAccess(db, claims.userId, projectId, "developer");
    const body = z.object({
      name: z.string().min(1).max(120),
      terms: z.array(z.string().min(1).max(200)).min(2).max(50),
      oneWay: z.boolean().default(false)
    }).parse(request.body);
    const [row] = await db.insert(synonymSets).values({ projectId, ...body }).returning();
    return reply.code(201).send(row);
  });

  app.get("/v1/projects/:projectId/api-keys", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await projectAccess(db, claims.userId, projectId, "admin");
    const rows = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      kind: apiKeys.kind,
      prefix: apiKeys.prefix,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt
    }).from(apiKeys).where(eq(apiKeys.projectId, projectId));
    return { keys: rows };
  });

  app.post("/v1/projects/:projectId/api-keys", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, projectId, "admin");
    const body = z.object({
      kind: z.enum(["search", "indexing", "admin"]),
      name: z.string().min(1).max(120)
    }).parse(request.body);
    const created = await keyService.create(projectId, body.kind as KeyKind, body.name);
    await db.insert(auditLogs).values({
      organizationId: access.organizationId,
      projectId,
      actorUserId: claims.userId,
      action: "api_key.created",
      targetType: "api_key",
      targetId: created.prefix,
      requestId: request.id,
      ip: request.ip,
      metadata: { kind: body.kind }
    });
    return reply.code(201).send(created);
  });

  app.delete("/v1/projects/:projectId/api-keys/:keyId", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const params = z.object({ projectId: z.string().uuid(), keyId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, params.projectId, "admin");
    await db.update(apiKeys).set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(apiKeys.id, params.keyId), eq(apiKeys.projectId, params.projectId)));
    await db.insert(auditLogs).values({
      organizationId: access.organizationId,
      projectId: params.projectId,
      actorUserId: claims.userId,
      action: "api_key.revoked",
      targetType: "api_key",
      targetId: params.keyId,
      requestId: request.id,
      ip: request.ip
    });
    return reply.code(204).send();
  });

  app.get("/v1/indexes/:indexId/versions", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { indexId } = z.object({ indexId: z.string().uuid() }).parse(request.params);
    const [index] = await db.select().from(indexes).where(and(eq(indexes.id, indexId), sql`${indexes.deletionRequestedAt} is null`)).limit(1);
    if (!index) throw new AppError("INDEX_NOT_FOUND", "Index not found", 404);
    await projectAccess(db, claims.userId, index.projectId, "viewer");
    const versions = await db.select().from(indexVersions)
      .where(eq(indexVersions.indexId, indexId))
      .orderBy(desc(indexVersions.sequence));
    return { versions, activeVersionId: index.activeVersionId };
  });

  app.post("/v1/indexes/:indexId/versions/:versionId/activate", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const params = z.object({ indexId: z.string().uuid(), versionId: z.string().uuid() }).parse(request.params);
    const [index] = await db.select().from(indexes).where(and(eq(indexes.id, params.indexId), sql`${indexes.deletionRequestedAt} is null`)).limit(1);
    if (!index) throw new AppError("INDEX_NOT_FOUND", "Index not found", 404);
    const access = await projectAccess(db, claims.userId, index.projectId, "developer");
    const sequence = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${params.indexId}, 0))`);
      const [current] = await tx.select().from(indexes).where(eq(indexes.id, params.indexId)).for("update");
      if (!current || current.deletionRequestedAt) throw new AppError("INDEX_NOT_FOUND", "Index not found", 404);
      const [target] = await tx.select().from(indexVersions)
        .where(and(eq(indexVersions.id, params.versionId), eq(indexVersions.indexId, params.indexId))).limit(1);
      if (!target || !["ready", "retired", "active"].includes(target.state) || target.sequence < current.minimumVersionSequence) {
        throw new AppError("VALIDATION_ERROR", "Version is unavailable or predates a source deletion", 409);
      }
      await tx.update(indexVersions).set({ state: "retired", updatedAt: new Date() })
        .where(and(eq(indexVersions.indexId, params.indexId), eq(indexVersions.state, "active")));
      await tx.update(indexVersions).set({ state: "active", activatedAt: new Date(), updatedAt: new Date() })
        .where(eq(indexVersions.id, params.versionId));
      await tx.update(indexes).set({ activeVersionId: params.versionId, updatedAt: new Date() })
        .where(eq(indexes.id, params.indexId));
      await tx.insert(auditLogs).values({
        organizationId: access.organizationId,
        projectId: index.projectId,
        actorUserId: claims.userId,
        action: "index_version.activated",
        targetType: "index_version",
        targetId: params.versionId,
        requestId: request.id,
        ip: request.ip,
        metadata: { sequence: target.sequence }
      });
      return target.sequence;
    });
    return { activeVersionId: params.versionId, sequence };
  });
}
