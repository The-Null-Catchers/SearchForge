import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
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
    .where(and(eq(indexes.projectId, projectId), eq(indexes.slug, slug)))
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
  app.post("/v1/indexes/:indexSlug/search", async (request) => {
    const auth = await keys.authenticate(apiToken(request), ["search", "indexing", "admin"], request.ip);
    const { indexSlug } = z.object({ indexSlug: z.string().min(1).max(80) }).parse(request.params);
    const query = searchRequestSchema.parse(request.body);
    const { index, version } = await resolveIndex(db, auth.projectId, indexSlug);
    const synonymRows = await db.select().from(synonymSets)
      .where(and(eq(synonymSets.projectId, auth.projectId), eq(synonymSets.enabled, true)));
    const engine = await runtime.engine(
      index.id,
      String(version.sequence),
      version.checksum,
      synonymRows.map((row) => ({ terms: row.terms, ...(row.oneWay ? { oneWay: true } : {}) }))
    );
    const result = engine.search(query);

    const [event] = await db.insert(searchEvents).values({
      projectId: auth.projectId,
      indexId: index.id,
      query: query.query,
      resultCount: result.total,
      latencyMs: result.processingTimeMs
    }).returning({ id: searchEvents.id });

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
    const engine = await runtime.engine(index.id, String(version.sequence), version.checksum, []);
    return { documentId, components: engine.explain(documentId, query), indexVersion: String(version.sequence) };
  });

  app.post("/v1/analytics/click", async (request, reply) => {
    const auth = await keys.authenticate(apiToken(request), ["search", "indexing", "admin"], request.ip);
    const body = z.object({
      query: z.string().max(1000),
      documentId: z.string().max(200),
      position: z.number().int().min(1).max(10_000),
      searchEventId: z.string().uuid().optional()
    }).parse(request.body);
    await db.insert(searchClicks).values({ projectId: auth.projectId, ...body });
    return reply.code(202).send({ accepted: true });
  });
}
