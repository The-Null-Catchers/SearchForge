import { ProjectCleanup } from "./project-cleanup.js";
import { SourceCleanup } from "./source-cleanup.js";
import { IndexCleanup } from "./cleanup.js";
import Fastify from "fastify";
import { Worker } from "bullmq";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { eq } from "drizzle-orm";
import { jobs } from "@searchforge/db";
import { createDatabase } from "@searchforge/db";
import { createQueues, createRedisConnection, JobDispatcher, type CleanupJobData } from "@searchforge/queue";

const postgresUrl = process.env.POSTGRES_URL;
const redisUrl = process.env.REDIS_URL;
if (!postgresUrl || !redisUrl) throw new Error("POSTGRES_URL and REDIS_URL are required");
const storagePath = process.env.INDEX_STORAGE_PATH ?? "./storage/indexes";

const { db, pool } = createDatabase(postgresUrl);
const redis = createRedisConnection(redisUrl);
const dispatchRedis = redis.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
const queues = createQueues(dispatchRedis);
const dispatcher = new JobDispatcher(db, queues);

const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "searchforge_worker_" });
const completed = new Counter({ name: "searchforge_cleanup_jobs_completed_total", help: "Completed cleanup jobs", registers: [metrics] });
const failed = new Counter({ name: "searchforge_cleanup_jobs_failed_total", help: "Failed cleanup jobs", registers: [metrics] });
const active = new Gauge({ name: "searchforge_cleanup_jobs_active", help: "Active cleanup jobs", registers: [metrics] });
const outboxPurged = new Counter({ name: "searchforge_outbox_rows_purged_total", help: "Terminal outbox rows purged after retention", registers: [metrics] });
const runningRecovered = new Counter({ name: "searchforge_running_jobs_recovered_total", help: "Stale running crawl/index jobs fenced and requeued", registers: [metrics] });

const cleanup = new IndexCleanup(db, storagePath);
const sourceCleanup = new SourceCleanup(db, storagePath);
const projectCleanup = new ProjectCleanup(db, storagePath);
const cleanupWorker = new Worker<CleanupJobData>("cleanup", async (job) => {
  active.inc();
  try {
    const result = job.data.targetType === "project"
      ? await projectCleanup.run(job.data)
      : job.data.targetType === "source"
        ? await sourceCleanup.run(job.data)
        : await cleanup.run(job.data);
    completed.inc();
    return result;
  } catch (error) {
    failed.inc();
    // Keep the durable receipt actionable even when automatic retries exhaust.
    await db.update(jobs).set({
      state: job.attemptsMade + 1 >= (job.opts.attempts ?? 1) ? "failed" : "queued",
      phase: "cleanup_retry", errorCode: "CLEANUP_FAILED", errorMessage: "Cleanup failed; retry deletion after resolving the worker error",
      updatedAt: new Date()
    }).where(eq(jobs.id, job.data.databaseJobId));
    throw error;
  } finally {
    active.dec();
  }
}, {
  connection: redis,
  concurrency: Number(process.env.CLEANUP_WORKER_CONCURRENCY ?? "2")
});

const server = Fastify({ logger: true });
cleanupWorker.on("error", error => server.log.error({ err: error }, "Queue worker error"));
cleanupWorker.on("failed", (job, error) => server.log.error({ err: error, jobId: job?.id }, "Cleanup attempt failed"));
server.get("/health/live", async () => ({ status: "live" }));
server.get("/health/ready", async (_request, reply) => {
  try {
    await redis.ping();
    await pool.query("select 1");
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "not_ready" });
  }
});
server.get("/metrics", async (_request, reply) => {
  reply.header("Content-Type", metrics.contentType);
  return metrics.metrics();
});
const configuredRetentionDays = Number(process.env.OUTBOX_RETENTION_DAYS ?? "7");
const outboxRetentionMs = (Number.isFinite(configuredRetentionDays) && configuredRetentionDays >= 1
  ? configuredRetentionDays : 7) * 24 * 60 * 60 * 1000;
const configuredRunningStaleSeconds = Number(process.env.RUNNING_JOB_STALE_SECONDS ?? "120");
const runningStaleMs = (Number.isFinite(configuredRunningStaleSeconds) && configuredRunningStaleSeconds >= 30
  ? configuredRunningStaleSeconds : 120) * 1000;
let nextOutboxPurgeAt = 0;
let tickInFlight: Promise<void> | undefined;
function tick() {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    try {
      await dispatcher.schedule();
      const runningRecovery = await dispatcher.recoverStaleRunning(new Date(), runningStaleMs);
      if (runningRecovery.recovered) {
        runningRecovered.inc(runningRecovery.recovered);
        server.log.warn(runningRecovery, "Recovered stale running jobs after execution lock release");
      }
      await dispatcher.dispatch();
      const recovery = await dispatcher.reconcile();
      if (recovery.recovered) server.log.warn(recovery, "Recovered missing queued Redis jobs");
      const now = Date.now();
      if (now >= nextOutboxPurgeAt) {
        nextOutboxPurgeAt = now + 5 * 60 * 1000;
        const purged = await dispatcher.purgeTerminalOutbox(new Date(now), outboxRetentionMs);
        if (purged > 0) {
          outboxPurged.inc(purged);
          server.log.info({ purged, retentionDays: outboxRetentionMs / 86_400_000 }, "Purged retained terminal outbox rows");
        }
      }
    } catch (error) { server.log.error({ err: error }, "Job dispatch/schedule tick failed; will retry"); }
  })().finally(() => { tickInFlight = undefined; });
  return tickInFlight;
}
const timer = setInterval(() => void tick(), 2000);
void tick();
await server.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? "4030") });

async function shutdown() {
  clearInterval(timer);
  await tickInFlight;
  await cleanupWorker.close();
  await Promise.all(Object.values(queues).map(queue => queue.close()));
  await server.close();
  await dispatchRedis.quit();
  await redis.quit();
  await pool.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
