import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, isNull } from "drizzle-orm";
import { refreshSessions, users, type createDatabase } from "@searchforge/db";
import { AppError } from "@searchforge/shared";
import type { Config } from "./config.js";

type Db = ReturnType<typeof createDatabase>["db"];

export type AccessClaims = {
  userId: string;
};

export class AuthService {
  private readonly accessSecret: Uint8Array;

  constructor(
    private readonly db: Db,
    private readonly config: Config
  ) {
    this.accessSecret = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
  }

  private digest(token: string): string {
    return createHmac("sha256", this.config.JWT_REFRESH_SECRET).update(token).digest("hex");
  }

  private async accessToken(userId: string): Promise<string> {
    return new SignJWT({ scope: "dashboard" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("searchforge")
      .setAudience("searchforge-api")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(this.accessSecret);
  }

  private makeRefreshToken(): string {
    return randomBytes(48).toString("base64url");
  }

  async register(email: string, password: string, displayName?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) throw new AppError("VALIDATION_ERROR", "An account with this email already exists", 409);

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1
    });
    const [user] = await this.db.insert(users).values({
      email: normalizedEmail,
      passwordHash,
      ...(displayName ? { displayName } : {})
    }).returning({ id: users.id, email: users.email, displayName: users.displayName });
    if (!user) throw new Error("User insert failed");
    return this.startSession(user, undefined, undefined);
  }

  async login(email: string, password: string, userAgent?: string, ip?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const [user] = await this.db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new AppError("UNAUTHENTICATED", "Invalid email or password", 401);
    }
    return this.startSession(
      { id: user.id, email: user.email, displayName: user.displayName },
      userAgent,
      ip
    );
  }

  private async startSession(
    user: { id: string; email: string; displayName: string | null },
    userAgent?: string,
    ip?: string
  ) {
    const refreshToken = this.makeRefreshToken();
    const tokenDigest = this.digest(refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await this.db.insert(refreshSessions).values({
      userId: user.id,
      familyId: randomUUID(),
      tokenDigest,
      ...(userAgent ? { userAgent } : {}),
      ...(ip ? { ip } : {}),
      expiresAt
    });
    return {
      user,
      accessToken: await this.accessToken(user.id),
      refreshToken,
      refreshExpiresAt: expiresAt
    };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.accessSecret, {
        issuer: "searchforge",
        audience: "searchforge-api"
      });
      if (!payload.sub) throw new Error("Missing subject");
      return { userId: payload.sub };
    } catch {
      throw new AppError("UNAUTHENTICATED", "Invalid or expired access token", 401);
    }
  }

  async refresh(token: string, userAgent?: string, ip?: string) {
    const digest = this.digest(token);
    const [session] = await this.db.select().from(refreshSessions).where(eq(refreshSessions.tokenDigest, digest)).limit(1);
    if (!session) throw new AppError("UNAUTHENTICATED", "Invalid refresh token", 401);

    if (session.revokedAt || session.rotatedAt) {
      await this.db.update(refreshSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshSessions.familyId, session.familyId), isNull(refreshSessions.revokedAt)));
      throw new AppError("UNAUTHENTICATED", "Refresh token reuse detected; session family revoked", 401);
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new AppError("UNAUTHENTICATED", "Refresh token expired", 401);
    }

    const [user] = await this.db.select({
      id: users.id,
      email: users.email,
      displayName: users.displayName
    }).from(users).where(eq(users.id, session.userId)).limit(1);
    if (!user) throw new AppError("UNAUTHENTICATED", "User no longer exists", 401);

    const nextToken = this.makeRefreshToken();
    const nextDigest = this.digest(nextToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await this.db.transaction(async (tx) => {
      await tx.update(refreshSessions)
        .set({ rotatedAt: new Date() })
        .where(and(eq(refreshSessions.id, session.id), isNull(refreshSessions.rotatedAt)));
      await tx.insert(refreshSessions).values({
        userId: session.userId,
        familyId: session.familyId,
        tokenDigest: nextDigest,
        parentTokenDigest: digest,
        ...(userAgent ? { userAgent } : {}),
        ...(ip ? { ip } : {}),
        expiresAt
      });
    });

    return {
      user,
      accessToken: await this.accessToken(user.id),
      refreshToken: nextToken,
      refreshExpiresAt: expiresAt
    };
  }

  async logout(token: string): Promise<void> {
    await this.db.update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshSessions.tokenDigest, this.digest(token)), isNull(refreshSessions.revokedAt)));
  }

  async logoutAll(userId: string): Promise<void> {
    await this.db.update(refreshSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshSessions.userId, userId), isNull(refreshSessions.revokedAt)));
  }
}
