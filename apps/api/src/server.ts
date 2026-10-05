import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { Counter, Registry, collectDefaultMetrics, Histogram } from "prom-client";
import { sql } from "drizzle-orm";
import { createDatabase } from "@searchforge/db";
import { createQueues, createRedisConnection } from "@searchforge/queue";
import { AppError } from "@searchforge/shared";
import { ApiKeyService } from "./api-keys.js";
import { AuthService } from "./auth.js";
import { config } from "./config.js";
import { SearchRuntime } from "./search-runtime.js";
import { Mailer } from "./mailer.js";
import { NotificationService } from "./notifications.js";
import { OtlpHttpTelemetry, type HttpSpan } from "./telemetry.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { searchRoutes } from "./routes/search.js";
import { documentRoutes } from "./routes/documents.js";
import { jobRoutes } from "./routes/jobs.js";
import { managementRoutes } from "./routes/management.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { scheduleRoutes } from "./routes/schedules.js";
import { deletionRoutes } from "./routes/deletion.js";
import { JobCancelled, SourceUnavailable } from "@searchforge/queue";
import { explorerRoutes } from "./routes/explorer.js";
import { rankingRoutes } from "./routes/ranking.js";
import { logRoutes } from "./routes/logs.js";
import { apiKeyControlRoutes } from "./routes/api-key-controls.js";
import { quotaRoutes } from "./routes/quotas.js";

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: config.NODE_ENV === "production" ? "info" : "debug"
    },
    genReqId: () => randomUUID(),
    bodyLimit: 5 * 1024 * 1024,
    trustProxy: (_address, hop) => hop < config.TRUST_PROXY_HOPS
  });

  const { db, pool } = createDatabase(config.POSTGRES_URL);
  const redis = createRedisConnection(config.REDIS_URL);
  const queues = createQueues(redis);
  const auth = new AuthService(db, config);
  const keys = new ApiKeyService(db, config, redis);
  const runtime = new SearchRuntime(config.INDEX_STORAGE_PATH);
  const mailer = new Mailer(config);
  const notificationService = new NotificationService(pool, mailer, config.PUBLIC_WEB_URL);
  const telemetry = new OtlpHttpTelemetry({
    serviceName: config.OTEL_SERVICE_NAME,
    sampleRatio: config.OTEL_TRACE_SAMPLE_RATIO,
    exportTimeoutMs: config.OTEL_EXPORT_TIMEOUT_MS,
    ...(config.OTEL_EXPORTER_OTLP_ENDPOINT ? { endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
    ...(config.GIT_SHA ? { serviceVersion: config.GIT_SHA } : {})
  });
  const requestSpans = new WeakMap<object, HttpSpan>();

  await app.register(cookie);
  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposedHeaders: ["traceparent"]
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    redis,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true
    }
  });

  const metrics = new Registry();
  collectDefaultMetrics({ register: metrics, prefix: "searchforge_" });
  const requestLatency = new Histogram({
    name: "searchforge_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [metrics]
  });
  const operationalNotifications = new Counter({
    name: "searchforge_operational_notifications_total",
    help: "Operational email notifications queued and delivered",
    labelNames: ["result"],
    registers: [metrics]
  });

  let notificationTimer: NodeJS.Timeout | undefined;
  let notificationSweepInFlight: Promise<void> | undefined;
  const runNotificationSweep = () => {
    if (!mailer.configured || notificationSweepInFlight) return;
    notificationSweepInFlight = notificationService.sweep()
      .then((result) => {
        if (result.queued > 0) operationalNotifications.inc({ result: "queued" }, result.queued);
        if (result.sent > 0) operationalNotifications.inc({ result: "sent" }, result.sent);
        if (result.failed > 0) operationalNotifications.inc({ result: "failed" }, result.failed);
        if (result.queued > 0 || result.sent > 0 || result.failed > 0) {
          app.log.info(result, "Operational notification sweep completed");
        }
      })
      .catch((error) => app.log.error({ err: error }, "Operational notification sweep failed; will retry"))
      .finally(() => { notificationSweepInFlight = undefined; });
  };

  app.addHook("onRequest", async (request, reply) => {
    (request as typeof request & { startedAt?: number }).startedAt = performance.now();
    const path = request.url.split("?")[0] ?? "/";
    const span = telemetry.startHttpSpan(request.method, path, headerValue(request.headers.traceparent));
    requestSpans.set(request, span);
    reply.header("traceparent", telemetry.traceparent(span));
  });
  app.addHook("onError", async (request, _reply, error) => {
    const span = requestSpans.get(request);
    if (span) telemetry.recordError(span, error);
  });
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unknown";
    const startedAt = (request as typeof request & { startedAt?: number }).startedAt ?? performance.now();
    requestLatency.observe(
      {
        method: request.method,
        route,
        status: String(reply.statusCode)
      },
      Math.max(0, performance.now() - startedAt) / 1000
    );
    const span = requestSpans.get(request);
    if (span) {
      telemetry.finishHttpSpan(span, route, reply.statusCode);
      requestSpans.delete(request);
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "searchforge-api", tracing: telemetry.enabled }));
  app.get("/health/live", async () => ({ status: "live" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      const pong = await redis.ping();
      await runtime.ready();
      if (pong !== "PONG") throw new Error("Redis ping failed");
      return { status: "ready", dependencies: { postgres: true, redis: true, indexStorage: true } };
    } catch (error) {
      return reply.code(503).send({
        status: "not_ready",
        error: "Required dependency is unavailable"
      });
    }
  });
  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", metrics.contentType);
    return metrics.metrics();
  });

  await authRoutes(app, auth, mailer, config.NODE_ENV === "production");
  await projectRoutes(app, db, auth, keys);
  await searchRoutes(app, db, redis, keys, runtime);
  await documentRoutes(app, db, keys);
  await jobRoutes(app, db, redis, auth);
  await managementRoutes(app, db, auth, keys);
  await apiKeyControlRoutes(app, db, auth, keys);
  await quotaRoutes(app, db, auth);
  await dashboardRoutes(app, db, auth);
  await scheduleRoutes(app, db, auth);
  await explorerRoutes(app, db, auth, runtime);
  await rankingRoutes(app, db, auth);
  await logRoutes(app, db, auth);
  await deletionRoutes(app, db, auth);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed",
          requestId: request.id,
          details: error.issues
        }
      });
    }
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
          ...(error.details !== undefined ? { details: error.details } : {})
        }
      });
    }
    const cause = (error instanceof Error ? error.cause : undefined) as { code?: string; message?: string } | undefined;
    if (cause?.code === "55000" && cause.message === "SearchForge project unavailable") {
      return reply.code(409).send({ error: { code: "PROJECT_UNAVAILABLE", message: "Project is being deleted", requestId: request.id } });
    }
    if (error instanceof SourceUnavailable || (cause?.code === "55000" && cause.message === "SearchForge source unavailable")) {
      return reply.code(409).send({ error: { code: "SOURCE_UNAVAILABLE", message: "Source is being deleted", requestId: request.id } });
    }
    if (error instanceof JobCancelled || (cause?.code === "55000" && cause.message === "SearchForge index unavailable")) {
      return reply.code(409).send({ error: { code: "INDEX_UNAVAILABLE", message: "Index is unavailable for writes", requestId: request.id } });
    }
    request.log.error({ err: error, requestId: request.id }, "request failed");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: request.id
      }
    });
  });

  app.addHook("onClose", async () => {
    if (notificationTimer) clearInterval(notificationTimer);
    await notificationSweepInFlight;
    await telemetry.close();
    await Promise.all(Object.values(queues).map((queue) => queue.close()));
    await redis.quit();
    await mailer.close();
    await pool.end();
  });

  if (mailer.configured) {
    notificationTimer = setInterval(runNotificationSweep, 5 * 60 * 1000);
    notificationTimer.unref();
    runNotificationSweep();
  }

  return app;
}