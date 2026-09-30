import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { auditLogs, indexes, memberships, organizations, projects, type createDatabase } from "@searchforge/db";
import { AppError, indexSettingsSchema } from "@searchforge/shared";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import type { ApiKeyService } from "../api-keys.js";

type Db = ReturnType<typeof createDatabase>["db"];
const roleWeight = { viewer: 0, developer: 1, admin: 2, owner: 3 } as const;

function bearer(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw new AppError("UNAUTHENTICATED", "Bearer access token required", 401);
  return header.slice(7);
}

async function requireRole(db: Db, userId: string, organizationId: string, minimum: keyof typeof roleWeight) {
  const [membership] = await db.select().from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)))
    .limit(1);
  if (!membership || roleWeight[membership.role] < roleWeight[minimum]) {
    throw new AppError("FORBIDDEN", "Insufficient organization role", 403);
  }
  return membership;
}

export async function projectRoutes(app: FastifyInstance, db: Db, auth: AuthService, keys: ApiKeyService) {
  app.post("/v1/organizations", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const body = z.object({ name: z.string().min(2).max(140), slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/) }).parse(request.body);
    const organizationId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(organizations).values({ id: organizationId, ...body });
      await tx.insert(memberships).values({ organizationId, userId: claims.userId, role: "owner" });
      await tx.insert(auditLogs).values({
        organizationId,
        actorUserId: claims.userId,
        action: "organization.created",
        targetType: "organization",
        targetId: organizationId,
        requestId: request.id,
        ip: request.ip
      });
    });
    return reply.code(201).send({ id: organizationId, ...body });
  });

  app.post("/v1/organizations/:organizationId/projects", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request));
    const params = z.object({ organizationId: z.string().uuid() }).parse(request.params);
    await requireRole(db, claims.userId, params.organizationId, "developer");
    const body = z.object({
      name: z.string().min(2).max(140),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/),
      description: z.string().max(2000).optional(),
      defaultLanguage: z.enum(["en", "ar", "auto"]).default("auto"),
      supportedLanguages: z.array(z.enum(["en", "ar"])).min(1).default(["en", "ar"])
    }).parse(request.body);

    const projectId = randomUUID();
    const indexId = randomUUID();
    const settings = indexSettingsSchema.parse({ defaultLanguage: body.defaultLanguage, supportedLanguages: body.supportedLanguages });

    await db.transaction(async (tx) => {
      await tx.insert(projects).values({
        id: projectId,
        organizationId: params.organizationId,
        name: body.name,
        slug: body.slug,
        ...(body.description ? { description: body.description } : {}),
        defaultLanguage: body.defaultLanguage,
        supportedLanguages: body.supportedLanguages,
        indexSettings: settings
      });
      await tx.insert(indexes).values({
        id: indexId,
        projectId,
        name: "Documents",
        slug: "docs",
        settings
      });
      await tx.insert(auditLogs).values({
        organizationId: params.organizationId,
        projectId,
        actorUserId: claims.userId,
        action: "project.created",
        targetType: "project",
        targetId: projectId,
        requestId: request.id,
        ip: request.ip
      });
    });

    const [searchKey, adminKey] = await Promise.all([
      keys.create(projectId, "search", "Default search key"),
      keys.create(projectId, "admin", "Default admin key")
    ]);
    return reply.code(201).send({
      id: projectId,
      index: { id: indexId, slug: "docs" },
      searchKey: searchKey.key,
      adminKey: adminKey.key
    });
  });
}
