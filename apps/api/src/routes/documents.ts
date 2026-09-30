import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { documents, indexes, jobs, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { Queue } from "bullmq";
import type { ApiKeyService } from "../api-keys.js";

type Db = ReturnType<typeof createDatabase>["db"];

function token(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "API key required", 401);
  return header.slice(7);
}

async function resolveIndex(db: Db, projectId: string, slug: string) {
  const [index] = await db.select().from(indexes)
    .where(and(eq(indexes.projectId, projectId), eq(indexes.slug, slug)))
    .limit(1);
  if (!index) throw new AppError("INDEX_NOT_FOUND", "Index not found", 404);
  return index;
}

function normalizedBody(id: string, body: unknown) {
  const parsed = z.record(z.string(), z.unknown()).parse(body);
  return { ...parsed, id };
}

function hashDocument(document: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(document)).digest("hex");
}

async function enqueueRebuild(db: Db, queue: Queue, projectId: string, indexId: string) {
  const databaseJobId = randomUUID();
  const externalJobId = randomUUID();
  await db.insert(jobs).values({
    id: databaseJobId,
    projectId,
    indexId,
    externalJobId,
    type: "index",
    state: "queued",
    phase: "queued",
    progress: { processed: 0, failed: 0 }
  });
  await queue.add(
    "build-index",
    { databaseJobId, projectId, indexId },
    { jobId: externalJobId, priority: 5 }
  );
  return databaseJobId;
}

export async function documentRoutes(app: FastifyInstance, db: Db, keys: ApiKeyService, indexQueue: Queue) {
  app.put("/v1/indexes/:indexSlug/documents/:documentId", async (request, reply) => {
    const auth = await keys.authenticate(token(request), ["indexing", "admin"], request.ip);
    const params = z.object({ indexSlug: z.string(), documentId: z.string().min(1).max(200) }).parse(request.params);
    const index = await resolveIndex(db, auth.projectId, params.indexSlug);
    const document = normalizedBody(params.documentId, request.body);
    await db.insert(documents).values({
      indexId: index.id,
      documentId: params.documentId,
      body: document,
      contentHash: hashDocument(document)
    }).onConflictDoUpdate({
      target: [documents.indexId, documents.documentId],
      set: {
        body: document,
        contentHash: hashDocument(document),
        deletedAt: null,
        updatedAt: new Date()
      }
    });
    const jobId = await enqueueRebuild(db, indexQueue, auth.projectId, index.id);
    return reply.code(202).send({ documentId: params.documentId, jobId });
  });

  app.post("/v1/indexes/:indexSlug/documents/batch", async (request, reply) => {
    const auth = await keys.authenticate(token(request), ["indexing", "admin"], request.ip);
    const { indexSlug } = z.object({ indexSlug: z.string() }).parse(request.params);
    const body = z.object({
      documents: z.array(z.record(z.string(), z.unknown()).and(z.object({ id: z.string().min(1).max(200) }))).min(1).max(5000)
    }).parse(request.body);
    const index = await resolveIndex(db, auth.projectId, indexSlug);
    const values = body.documents.map((document) => ({
      indexId: index.id,
      documentId: document.id,
      body: document,
      contentHash: hashDocument(document)
    }));
    await db.insert(documents).values(values).onConflictDoUpdate({
      target: [documents.indexId, documents.documentId],
      set: {
        body: sql`excluded.body`,
        contentHash: sql`excluded.content_hash`,
        deletedAt: null,
        updatedAt: new Date()
      }
    });
    const jobId = await enqueueRebuild(db, indexQueue, auth.projectId, index.id);
    return reply.code(202).send({ accepted: values.length, jobId });
  });

  app.delete("/v1/indexes/:indexSlug/documents/:documentId", async (request, reply) => {
    const auth = await keys.authenticate(token(request), ["indexing", "admin"], request.ip);
    const params = z.object({ indexSlug: z.string(), documentId: z.string().min(1).max(200) }).parse(request.params);
    const index = await resolveIndex(db, auth.projectId, params.indexSlug);
    await db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(documents.indexId, index.id), eq(documents.documentId, params.documentId)));
    const jobId = await enqueueRebuild(db, indexQueue, auth.projectId, index.id);
    return reply.code(202).send({ documentId: params.documentId, jobId });
  });
}
