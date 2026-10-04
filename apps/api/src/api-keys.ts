import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, projects, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import type { Redis as IORedis } from "ioredis";
import type { Config } from "./config.js";

type Db = ReturnType<typeof createDatabase>["db"];
export type KeyKind = "search" | "indexing" | "admin";
export type ApiKeyOptions = {
  expiresAt?: Date | null;
  ipRestrictions?: string[];
  rateLimitPerMinute?: number | null;
};

export class ApiKeyService {
  constructor(private readonly db: Db, private readonly config: Config, private readonly redis?: IORedis) {}

  private digest(secret: string): string {
    return createHmac("sha256", this.config.API_KEY_PEPPER).update(secret).digest("hex");
  }

  async create(projectId: string, kind: KeyKind, name: string, options: ApiKeyOptions = {}) {
    const prefix = randomBytes(9).toString("base64url").slice(0, 12);
    const secret = randomBytes(32).toString("base64url");
    await this.db.insert(apiKeys).values({
      projectId,
      kind,
      name,
      prefix,
      secretDigest: this.digest(secret),
      expiresAt: options.expiresAt ?? null,
      ipRestrictions: options.ipRestrictions ?? [],
      rateLimitPerMinute: options.rateLimitPerMinute ?? null
    });
    return {
      key: `sf_${kind}_${prefix}_${secret}`,
      prefix,
      kind,
      name,
      expiresAt: options.expiresAt ?? null,
      ipRestrictions: options.ipRestrictions ?? [],
      rateLimitPerMinute: options.rateLimitPerMinute ?? null
    };
  }

  private async enforceRateLimit(keyId: string, limit: number | null) {
    if (!limit || !this.redis) return;
    const bucket = Math.floor(Date.now() / 60_000);
    const redisKey = `api-key-rate:${keyId}:${bucket}`;
    const result = await this.redis.multi().incr(redisKey).expire(redisKey, 120).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    if (count > limit) {
      throw new AppError("RATE_LIMITED", "API key rate limit exceeded", 429, { limitPerMinute: limit });
    }
  }

  async authenticate(raw: string, allowed: KeyKind[], ip?: string) {
    const match = /^sf_(search|indexing|admin)_([A-Za-z0-9_-]{12})_([A-Za-z0-9_-]+)$/.exec(raw);
    if (!match) throw new AppError("UNAUTHENTICATED", "Invalid API key", 401);
    const [, kindValue, prefix, secret] = match;
    const kind = kindValue as KeyKind;
    if (!allowed.includes(kind)) throw new AppError("FORBIDDEN", "API key does not have permission for this operation", 403);

    const [record] = await this.db.select({ key: apiKeys }).from(apiKeys)
      .innerJoin(projects, eq(projects.id, apiKeys.projectId))
      .where(and(
        eq(apiKeys.prefix, prefix!),
        isNull(apiKeys.revokedAt),
        isNull(projects.deletionRequestedAt),
        isNull(projects.deletedAt)
      ))
      .limit(1);
    if (!record || record.key.kind !== kind) throw new AppError("UNAUTHENTICATED", "Invalid API key", 401);
    if (record.key.expiresAt && record.key.expiresAt.getTime() <= Date.now()) {
      throw new AppError("UNAUTHENTICATED", "API key expired", 401);
    }
    if (record.key.ipRestrictions.length > 0 && (!ip || !record.key.ipRestrictions.includes(ip))) {
      throw new AppError("FORBIDDEN", "API key is not allowed from this IP address", 403);
    }

    const expected = Buffer.from(record.key.secretDigest, "hex");
    const actual = Buffer.from(this.digest(secret!), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AppError("UNAUTHENTICATED", "Invalid API key", 401);
    }

    await this.enforceRateLimit(record.key.id, record.key.rateLimitPerMinute);
    void this.db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, record.key.id));
    return {
      id: record.key.id,
      projectId: record.key.projectId,
      kind: record.key.kind,
      rateLimitPerMinute: record.key.rateLimitPerMinute
    };
  }
}
