import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth.js";

const credentials = z.object({
  email: z.string().email().max(320),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(120).optional()
});

function bearer(header: string | undefined): string {
  if (!header?.startsWith("Bearer ")) throw new Error("Missing bearer token");
  return header.slice(7);
}

export async function authRoutes(app: FastifyInstance, auth: AuthService, production: boolean) {
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
    setRefresh(reply, session.refreshToken);
    return reply.code(201).send({ user: session.user, accessToken: session.accessToken });
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
