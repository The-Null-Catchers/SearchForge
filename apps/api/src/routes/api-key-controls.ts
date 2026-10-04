import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { apiKeys, auditLogs, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import { z } from "zod";
import type { ApiKeyService, KeyKind } from "../api-keys.js";
import type { AuthService } from "../auth.js";
import { bearer, projectAccess } from "./management.js";

type Db = ReturnType<typeof createDatabase>["db"];
const ipAddressSchema = z.string().refine(value => isIP(value) !== 0, "Use a valid IPv4 or IPv6 address");

const controlsSchema = z.object({
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  ipRestrictions: z.array(ipAddressSchema).max(20).default([]),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).nullable().optional()
});

function parseExpiry(value: string | null | undefined) {
  if (value === undefined || value === null) return value ?? null;
  const date = new Date(value);
  if (date.getTime() <= Date.now()) throw new AppError("VALIDATION_ERROR", "API key expiration must be in the future", 400);
  return date;
}

export async function apiKeyControlRoutes(app: FastifyInstance, db: Db, auth: AuthService, keyService: ApiKeyService) {
  app.get("/v1/projects/:projectId/api-key-controls", async request => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await projectAccess(db, claims.userId, projectId, "admin");
    const rows = await db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      kind: apiKeys.kind,
      prefix: apiKeys.prefix,
      expiresAt: apiKeys.expiresAt,
      ipRestrictions: apiKeys.ipRestrictions,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt
    }).from(apiKeys).where(eq(apiKeys.projectId, projectId)).orderBy(desc(apiKeys.createdAt));
    return { keys: rows };
  });

  app.post("/v1/projects/:projectId/api-keys/configured", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, projectId, "admin");
    const body = z.object({
      kind: z.enum(["search", "indexing", "admin"]),
      name: z.string().min(1).max(120),
      expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
      ipRestrictions: z.array(ipAddressSchema).max(20).default([]),
      rateLimitPerMinute: z.number().int().min(1).max(10_000).nullable().optional()
    }).strict().parse(request.body);
    const expiresAt = parseExpiry(body.expiresAt);
    const created = await keyService.create(projectId, body.kind as KeyKind, body.name, {
      expiresAt,
      ipRestrictions: body.ipRestrictions,
      rateLimitPerMinute: body.rateLimitPerMinute ?? null
    });
    await db.insert(auditLogs).values({
      organizationId: access.organizationId,
      projectId,
      actorUserId: claims.userId,
      action: "api_key.created",
      targetType: "api_key",
      targetId: created.prefix,
      requestId: request.id,
      ip: request.ip,
      metadata: {
        kind: body.kind,
        expiresAt: expiresAt?.toISOString() ?? null,
        ipRestrictionCount: body.ipRestrictions.length,
        rateLimitPerMinute: body.rateLimitPerMinute ?? null
      }
    });
    return reply.code(201).send(created);
  });

  app.patch("/v1/projects/:projectId/api-keys/:keyId", async request => {
    const claims = await auth.verifyAccess(bearer(request));
    const params = z.object({ projectId: z.string().uuid(), keyId: z.string().uuid() }).parse(request.params);
    const access = await projectAccess(db, claims.userId, params.projectId, "admin");
    const body = controlsSchema.strict().parse(request.body);
    const expiresAt = parseExpiry(body.expiresAt);
    return db.transaction(async tx => {
      const [current] = await tx.select().from(apiKeys).where(and(eq(apiKeys.id, params.keyId), eq(apiKeys.projectId, params.projectId))).for("update");
      if (!current) throw new AppError("VALIDATION_ERROR", "API key not found", 404);
      if (current.revokedAt) throw new AppError("VALIDATION_ERROR", "Revoked API keys cannot be changed", 409);
      const [updated] = await tx.update(apiKeys).set({
        expiresAt,
        ipRestrictions: body.ipRestrictions,
        rateLimitPerMinute: body.rateLimitPerMinute ?? null,
        updatedAt: new Date()
      }).where(eq(apiKeys.id, params.keyId)).returning({
        id: apiKeys.id,
        expiresAt: apiKeys.expiresAt,
        ipRestrictions: apiKeys.ipRestrictions,
        rateLimitPerMinute: apiKeys.rateLimitPerMinute
      });
      await tx.insert(auditLogs).values({
        organizationId: access.organizationId,
        projectId: params.projectId,
        actorUserId: claims.userId,
        action: "api_key.controls_updated",
        targetType: "api_key",
        targetId: params.keyId,
        requestId: request.id,
        ip: request.ip,
        metadata: {
          previous: {
            expiresAt: current.expiresAt?.toISOString() ?? null,
            ipRestrictionCount: current.ipRestrictions.length,
            rateLimitPerMinute: current.rateLimitPerMinute
          },
          current: {
            expiresAt: expiresAt?.toISOString() ?? null,
            ipRestrictionCount: body.ipRestrictions.length,
            rateLimitPerMinute: body.rateLimitPerMinute ?? null
          }
        }
      });
      return updated;
    });
  });
}
