import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth.js";
import type { Mailer } from "../mailer.js";

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(120).optional()
});

function bearer(header: string | undefined): string {
  if (!header?.startsWith("Bearer ")) throw new Error("Missing bearer token");
  return header.slice(7);
}

export async function authRoutes(app: FastifyInstance, auth: AuthService, mailer: Mailer, production: boolean) {
  const setRefresh = (reply: FastifyReply, token: string) => {
    reply.setCookie("sf_refresh", token, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      path: "/v1/auth",
      maxAge: 30 * 24 * 60 * 60
    });
  };

  app.post("/v1/auth/register", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = credentials.parse(request.body);
    const session = await auth.register(body.email, body.password, body.displayName);
    const verificationToken = await auth.createOneTimeToken(session.user.id, "verify_email", 24 * 60);
    await mailer.sendVerification(session.user.email, verificationToken);
    setRefresh(reply, session.refreshToken);
    return reply.code(201).send({ user: session.user, accessToken: session.accessToken, emailVerificationSent: true });
  });

  app.post("/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = credentials.pick({ email: true, password: true }).parse(request.body);
    const session = await auth.login(body.email, body.password, request.headers["user-agent"], request.ip);
    setRefresh(reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken };
  });

  app.post("/v1/auth/refresh", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const token = request.cookies.sf_refresh;
    if (!token) return reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Refresh token missing", requestId: request.id } });
    const session = await auth.refresh(token, request.headers["user-agent"], request.ip);
    setRefresh(reply, session.refreshToken);
    return { user: session.user, accessToken: session.accessToken };
  });

  app.post("/v1/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = z.object({ email: z.string().email().max(320) }).parse(request.body);
    const user = await auth.findUserByEmail(body.email);
    if (user) {
      const resetToken = await auth.createOneTimeToken(user.id, "reset_password", 30);
      await mailer.sendPasswordReset(user.email, resetToken);
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/v1/auth/reset-password", { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const body = z.object({ token: z.string().min(20).max(256), password: z.string().min(10).max(200) }).parse(request.body);
    const userId = await auth.consumeOneTimeToken(body.token, "reset_password");
    await auth.resetPassword(userId, body.password);
    reply.clearCookie("sf_refresh", { path: "/v1/auth" });
    return reply.code(204).send();
  });

  app.post("/v1/auth/verify-email", async (request, reply) => {
    const body = z.object({ token: z.string().min(20).max(256) }).parse(request.body);
    const userId = await auth.consumeOneTimeToken(body.token, "verify_email");
    await auth.verifyEmail(userId);
    return reply.code(204).send();
  });

  app.post("/v1/auth/resend-verification", { config: { rateLimit: { max: 3, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request.headers.authorization));
    const body = z.object({ email: z.string().email().max(320) }).parse(request.body);
    const user = await auth.findUserByEmail(body.email);
    if (user && user.id === claims.userId && !user.emailVerifiedAt) {
      const verificationToken = await auth.createOneTimeToken(user.id, "verify_email", 24 * 60);
      await mailer.sendVerification(user.email, verificationToken);
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const token = request.cookies.sf_refresh;
    if (token) await auth.logout(token);
    reply.clearCookie("sf_refresh", { path: "/v1/auth" });
    return reply.code(204).send();
  });

  app.post("/v1/auth/logout-all", async (request, reply) => {
    const claims = await auth.verifyAccess(bearer(request.headers.authorization));
    await auth.logoutAll(claims.userId);
    reply.clearCookie("sf_refresh", { path: "/v1/auth" });
    return reply.code(204).send();
  });
}
