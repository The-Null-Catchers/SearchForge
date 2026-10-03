import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { auditLogs, indexes, memberships, organizations, projects, type createDatabase } from "@searchforge/db";
import { enqueueIndex } from "@searchforge/queue";
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

  app.get("/v1/projects/:projectId/settings", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletionRequestedAt), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "Project not found", 404);
    const membership = await requireRole(db, claims.userId, project.organizationId, "viewer");
    return {
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description ?? "",
      defaultLanguage: project.defaultLanguage,
      supportedLanguages: project.supportedLanguages,
      analyticsEnabled: project.analyticsEnabled,
      role: membership.role
    };
  });

  app.put("/v1/projects/:projectId/settings", async (request) => {
    const claims = await auth.verifyAccess(bearer(request));
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      name: z.string().min(2).max(140),
      description: z.string().max(2000).default(""),
      defaultLanguage: z.enum(["en", "ar", "auto"]),
      supportedLanguages: z.array(z.enum(["en", "ar"])).min(1).max(2),
      analyticsEnabled: z.boolean()
    }).strict().parse(request.body);
    const [project] = await db.select().from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletionRequestedAt), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "Project not found", 404);
    await requireRole(db, claims.userId, project.organizationId, "admin");

    return db.transaction(async tx => {
      const [current] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
      if (!current || current.deletionRequestedAt || current.deletedAt) throw new AppError("PROJECT_NOT_FOUND", "Project not found", 404);
      const [index] = await tx.select().from(indexes)
        .where(and(eq(indexes.projectId, projectId), eq(indexes.slug, "docs"), isNull(indexes.deletionRequestedAt)))
        .for("update").limit(1);
      if (!index) throw new AppError("INDEX_NOT_FOUND", "Default docs index not found", 404);

      const languagesChanged = current.defaultLanguage !== body.defaultLanguage
        || JSON.stringify(current.supportedLanguages) !== JSON.stringify(body.supportedLanguages);
      const nextIndexSettings = indexSettingsSchema.parse({
        ...(current.indexSettings ?? {}),
        ...(index.settings ?? {}),
        defaultLanguage: body.defaultLanguage,
        supportedLanguages: body.supportedLanguages
      });

      await tx.update(projects).set({
        name: body.name,
        description: body.description || null,
        defaultLanguage: body.defaultLanguage,
        supportedLanguages: body.supportedLanguages,
        analyticsEnabled: body.analyticsEnabled,
        indexSettings: nextIndexSettings,
        updatedAt: new Date()
      }).where(eq(projects.id, projectId));
      await tx.update(indexes).set({ settings: nextIndexSettings, updatedAt: new Date() }).where(eq(indexes.id, index.id));

      const rebuildJobId = languagesChanged ? await enqueueIndex(tx, projectId, index.id) : undefined;
      await tx.insert(auditLogs).values({
        organizationId: current.organizationId,
        projectId,
        actorUserId: claims.userId,
        action: "project.settings_updated",
        targetType: "project",
        targetId: projectId,
        requestId: request.id,
        ip: request.ip,
        metadata: {
          previous: {
            name: current.name,
            description: current.description,
            defaultLanguage: current.defaultLanguage,
            supportedLanguages: current.supportedLanguages,
            analyticsEnabled: current.analyticsEnabled
          },
          current: body,
          rebuildJobId: rebuildJobId ?? null
        }
      });
      return { ...body, rebuildJobId: rebuildJobId ?? null };
    });
  });
}
