import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@searchforge/shared";
import { authRoutes } from "./auth.js";
import type { AuthService } from "../auth.js";
import type { Mailer } from "../mailer.js";

async function fixture() {
  const app = Fastify();
  await app.register(cookie);
  const auth = {
    login: vi.fn().mockResolvedValue({ user: { id: "u" }, accessToken: "access", refreshToken: "refresh" }),
    refresh: vi.fn().mockResolvedValue({ user: { id: "u" }, accessToken: "next-access", refreshToken: "next-refresh" }),
    verifyAccess: vi.fn(), logout: vi.fn(), logoutAll: vi.fn(), findUserByEmail: vi.fn().mockResolvedValue(undefined),
    createOneTimeToken: vi.fn(), consumeOneTimeToken: vi.fn().mockResolvedValue("u"), resetPassword: vi.fn(), verifyEmail: vi.fn()
  };
  const mailer = { sendPasswordReset: vi.fn(), sendVerification: vi.fn() };
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof AppError ? error.statusCode : 400;
    return reply.code(status).send({ error: { code: error instanceof AppError ? error.code : "VALIDATION_ERROR" } });
  });
  await authRoutes(app, auth as unknown as AuthService, mailer as unknown as Mailer, true);
  await app.ready();
  return { app, auth, mailer };
}

describe("auth route contracts", () => {
  it("sets a secure HTTP-only refresh cookie without exposing it in the response", async () => {
    const { app } = await fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "user@example.com", password: "correct-horse-battery" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty("refreshToken");
      expect(response.headers["set-cookie"]).toContain("HttpOnly");
      expect(response.headers["set-cookie"]).toContain("Secure");
      expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    } finally { await app.close(); }
  });
  it("refuses refresh without a cookie and issues the rotated cookie on success", async () => {
    const { app, auth } = await fixture();
    try {
      expect((await app.inject({ method: "POST", url: "/v1/auth/refresh" })).statusCode).toBe(401);
      expect(auth.refresh).not.toHaveBeenCalled();
      const response = await app.inject({ method: "POST", url: "/v1/auth/refresh", cookies: { sf_refresh: "refresh" } });
      expect(response.json().accessToken).toBe("next-access");
      expect(response.headers["set-cookie"]).toContain("sf_refresh=next-refresh");
    } finally { await app.close(); }
  });
  it("returns the same forgot-password response for known and unknown accounts", async () => {
    const { app, auth, mailer } = await fixture();
    try {
      const send = () => app.inject({ method: "POST", url: "/v1/auth/forgot-password", payload: { email: "user@example.com" } });
      const unknown = await send();
      auth.findUserByEmail.mockResolvedValueOnce({ id: "u", email: "user@example.com" } as never);
      auth.createOneTimeToken.mockResolvedValueOnce("reset-secret");
      const known = await send();
      expect(unknown.statusCode).toBe(202);
      expect(known.json()).toEqual(unknown.json());
      expect(mailer.sendPasswordReset).toHaveBeenCalledExactlyOnceWith("user@example.com", "reset-secret");
    } finally { await app.close(); }
  });
  it("requires authentication to log out all devices", async () => {
    const { app, auth } = await fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/v1/auth/logout-all" });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("UNAUTHENTICATED");
      expect(auth.logoutAll).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
