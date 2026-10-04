import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { indexVersions, indexes, projects, searchClicks, searchEvents, synonymSets, type createDatabase } from "@searchforge/db";
import { AppError, searchRequestSchema } from "@searchforge/shared";
import { z } from "zod";
import type { Redis as IORedis } from "ioredis";
import type { ApiKeyService } from "../api-keys.js";
import type { SearchRuntime } from "../search-runtime.js";

type Db = ReturnType<typeof createDatabase>["db"];

function apiToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "API key required", 401);
  return header.slice(7);
}

async function resolveIndex(db: Db, projectId: string, slug: string) {
  const [index] = await db.select().from(indexes)
    .where(and(eq(indexes.projectId, projectId), eq(indexes.slug, slug), sql`${indexes.deletionRequestedAt} is null`))
    .limit(1);
  if (!index) throw new AppError("INDEX_NOT_FOUND", "The requested index does not exist", 404);
  if (!index.activeVersionId) throw new AppError("INDEX_NOT_FOUND", "The index does not have an active version yet", 409);
  const [version] = await db.select().from(indexVersions).where(eq(indexVersions.id, index.activeVersionId)).limit(1);
  if (!version || version.state !== "active") throw new AppError("INDEX_NOT_FOUND", "Active index version is unavailable", 409);
  return { index, version };
}

export async function searchRoutes(
  app: FastifyInstance,
  db: Db,
  redis: IORedis,
  keys: ApiKeyService,
  runtime: SearchRuntime
) {
  async function searchEngine(index: typeof indexes.$inferSelect, version: typeof indexVersions.$inferSelect) {
    const rows = await db.select().from(synonymSets)
      .where(and(eq(synonymSets.projectId, index.projectId), eq(synonymSets.enabled, true)));
    return runtime.engine(index.id, String(version.sequence), version.checksum,
      rows.map(row => ({ terms: row.terms, oneWay: row.oneWay })));
  }
  app.post("/v1/indexes/:indexSlug/search", async (request) => {
    const auth = await keys.authenticate(apiToken(request), ["search", "indexing", "admin"], request.ip);
    await keys.consumeSearch(auth.projectId);
    const { indexSlug } = z.object({ indexSlug: z.string().min(1).max(80) }).parse(request.params);
    const query = searchRequestSchema.parse(request.body);
    const { index, version } = await resolveIndex(db, auth.projectId, indexSlug);
    const engine = await searchEngine(index, version);
    const result = engine.search(query);

    const event = await db.transaction(async tx => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, auth.projectId)).for("share");
      if (!project?.analyticsEnabled) return undefined;
      const [stored] = await tx.insert(searchEvents).values({ projectId: auth.projectId,
        indexId: index.id, query: query.query, resultCount: result.total,
        latencyMs: result.processingTimeMs }).returning({ id: searchEvents.id });
      return stored;
    });

    return { ...result, searchEventId: event?.id };
  });

  app.get("/v1/indexes/:indexSlug/autocomplete", async (request) => {
    const auth = await keys.authenticate(apiToken(request), ["search", "indexing", "admin"], request.ip);
    const { indexSlug } = z.object({ indexSlug: z.string().min(1).max(80) }).parse(request.params);
    const { q, limit } = z.object({ q: z.string().max(200), limit: z.coerce.number().int().min(1).max(20).default(8) }).parse(request.query);
    const { index, version } = await resolveIndex(db, auth.projectId, indexSlug);
    const cacheKey = `autocomplete:${index.id}:${version.sequence}:${q}:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached) return { suggestions: JSON.parse(cached) };

    const engine = await runtime.engine(index.id, String(version.sequence), version.checksum, []);
    const suggestions = engine.autocomplete(q, limit);
    await redis.set(cacheKey, JSON.stringify(suggestions), "EX", 60);
    return { suggestions };
  });

  app.post("/v1/indexes/:indexSlug/explain/:documentId", async (request) => {
    const auth = await keys.authenticate(apiToken(request), ["admin", "indexing"], request.ip);
    const { indexSlug, documentId } = z.object({ indexSlug: z.string(), documentId: z.string() }).parse(request.params);
    const query = searchRequestSchema.parse(request.body);
    const { index, version } = await resolveIndex(db, auth.projectId, indexSlug);
    const engine = await searchEngine(index, version);
    return { documentId, components: engine.explain(documentId, { ...query, offset: 0, cursor: undefined }), indexVersion: String(version.sequence) };
  });

  app.post("/v1/analytics/click", async (request, reply) => {
    const auth = await keys.authenticate(apiToken(request), ["search", "indexing", "admin"], request.ip);
    const body = z.object({
      query: z.string().max(1000),
      documentId: z.string().max(200),
      position: z.number().int().min(1).max(10_000),
      searchEventId: z.string().uuid().optional()
    }).parse(request.body);
    const stored = await db.transaction(async tx => {
      const [project] = await tx.select().from(projects).where(eq(projects.id, auth.projectId)).for("share");
      if (body.searchEventId) {
        const [event] = await tx.select().from(searchEvents).where(and(
          eq(searchEvents.id, body.searchEventId), eq(searchEvents.projectId, auth.projectId))).for("share");
        if (!event) throw new AppError("VALIDATION_ERROR", "Search event not found", 404);
        if (event.query !== body.query) throw new AppError("VALIDATION_ERROR", "Click query does not match search event", 400);
      }
      if (!project?.analyticsEnabled) return false;
      await tx.insert(searchClicks).values({ projectId: auth.projectId, ...body });
      return true;
    });
    return reply.code(202).send({ accepted: true, stored });
  });
}
