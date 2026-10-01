import type { FastifyInstance } from "fastify";
import { and, asc, eq, gt, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { auditLogs, documents, indexes, indexVersions, type createDatabase } from "@searchforge/db";
import { enqueueIndex } from "@searchforge/queue";
import { AppError, type ConsoleDocumentsPage, type ConsoleDocumentDetail, type DocumentTerm } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import type { SearchRuntime } from "../search-runtime.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];
export async function explorerRoutes(app: FastifyInstance, db: Db, auth: AuthService, runtime: SearchRuntime) {
  async function access(request: Parameters<typeof bearer>[0], minimum: "viewer" | "developer") {
    const claims = await auth.verifyAccess(bearer(request));
    const { indexId } = z.object({ indexId: z.string().uuid() }).parse(request.params);
    const [index] = await db.select().from(indexes).where(and(eq(indexes.id, indexId), sql`${indexes.deletionRequestedAt} is null`)).limit(1);
    if (!index) throw new AppError("INDEX_NOT_FOUND", "Index not found", 404);
    const permission = await projectAccess(db, claims.userId, index.projectId, minimum);
    return { index, permission, claims };
  }

  app.get("/v1/console/indexes/:indexId/documents", async request => {
    const { index } = await access(request, "viewer");
    const query = z.object({ q: z.string().max(200).default(""), after: z.string().min(1).max(200).optional(),
      sourceId: z.string().uuid().optional(), status: z.enum(["live", "deleted", "all"]).default("live"),
      limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await db.select({ id: documents.documentId, documentId: documents.documentId, body: documents.body,
      sourceId: documents.sourceId, deletedAt: documents.deletedAt, updatedAt: documents.updatedAt }).from(documents)
      .where(and(eq(documents.indexId, index.id),
        query.after ? gt(documents.documentId, query.after) : undefined,
        query.sourceId ? eq(documents.sourceId, query.sourceId) : undefined,
        query.status === "live" ? isNull(documents.deletedAt) : query.status === "deleted" ? isNotNull(documents.deletedAt) : undefined,
        query.q ? or(ilike(documents.documentId, pattern), sql`${documents.body}->>'title' ilike ${pattern}`, sql`${documents.body}->>'content' ilike ${pattern}`) : undefined))
      .orderBy(asc(documents.documentId)).limit(query.limit + 1);
    return { documents: rows.slice(0, query.limit).map(row => ({ id: row.id, documentId: row.documentId,
      title: typeof row.body.title === "string" ? row.body.title : row.documentId,
      language: typeof row.body.language === "string" ? row.body.language : null,
      url: typeof row.body.url === "string" ? row.body.url : null,
      sourceId: row.sourceId, deletedAt: row.deletedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() })),
      nextAfter: rows.length > query.limit ? rows[query.limit - 1]!.id : null } satisfies ConsoleDocumentsPage;
  });

  app.get("/v1/console/indexes/:indexId/documents/:documentId", async request => {
    const { index } = await access(request, "viewer");
    const { documentId } = z.object({ documentId: z.string().min(1).max(200) }).parse(request.params);
    const [row] = await db.select().from(documents).where(and(eq(documents.indexId, index.id), eq(documents.documentId, documentId))).limit(1);
    if (!row) throw new AppError("DOCUMENT_NOT_FOUND", "Document not found", 404);
    const [version] = index.activeVersionId ? await db.select().from(indexVersions).where(eq(indexVersions.id, index.activeVersionId)).limit(1) : [];
    const segment = version ? await runtime.segment(index.id, String(version.sequence), version.checksum) : null;
    const activeDocument = segment && Object.hasOwn(segment.documents, documentId) ? segment.documents[documentId]! : null;
    const matchesActive = !!activeDocument && JSON.stringify(activeDocument) === JSON.stringify(row.body);
    const terms: DocumentTerm[] = [];
    let truncated = false;
    if (activeDocument && segment) {
      outer: for (const [field, dictionary] of Object.entries(segment.postings)) {
        for (const [term, entry] of Object.entries(dictionary)) {
          const posting = entry.postings.find(value => value.documentId === documentId);
          if (!posting) continue;
          if (terms.length >= 500) { truncated = true; break outer; }
          terms.push({ field, term, frequency: posting.termFrequency, positions: posting.positions.slice(0, 100), documentFrequency: entry.documentFrequency });
        }
      }
    }
    return { documentId, body: row.body, sourceId: row.sourceId, deletedAt: row.deletedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString(),
      state: row.deletedAt ? "deleted" : matchesActive ? "indexed" : "pending",
      activeVersion: version ? String(version.sequence) : null, inActiveVersion: !!activeDocument,
      activeDocument, terms, termsTruncated: truncated } satisfies ConsoleDocumentDetail;
  });

  app.post("/v1/console/indexes/:indexId/rebuild", async (request, reply) => {
    const { index, permission, claims } = await access(request, "developer");
    const jobId = await db.transaction(async tx => {
      const id = await enqueueIndex(tx, index.projectId, index.id);
      await tx.insert(auditLogs).values({ organizationId: permission.organizationId, projectId: index.projectId,
        actorUserId: claims.userId, action: "index.rebuild_requested", targetType: "index", targetId: index.id,
        requestId: request.id, ip: request.ip, metadata: { jobId: id } });
      return id;
    });
    return reply.code(202).send({ jobId });
  });

  app.delete("/v1/console/indexes/:indexId/documents/:documentId", async (request, reply) => {
    const { index, permission, claims } = await access(request, "developer");
    const { documentId } = z.object({ documentId: z.string().min(1).max(200) }).parse(request.params);
    const jobId = await db.transaction(async tx => {
      const [row] = await tx.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(documents.indexId, index.id), eq(documents.documentId, documentId), isNull(documents.deletedAt))).returning({ id: documents.documentId });
      if (!row) throw new AppError("DOCUMENT_NOT_FOUND", "Live document not found", 404);
      const id = await enqueueIndex(tx, index.projectId, index.id);
      await tx.insert(auditLogs).values({ organizationId: permission.organizationId, projectId: index.projectId,
        actorUserId: claims.userId, action: "document.deleted", targetType: "document", targetId: documentId,
        requestId: request.id, ip: request.ip, metadata: { indexId: index.id, jobId: id } });
      return id;
    });
    return reply.code(202).send({ documentId, jobId });
  });
}
