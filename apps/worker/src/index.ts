import { rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify from "fastify";
import { Worker } from "bullmq";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
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

const cleanupWorker = new Worker<CleanupJobData>("cleanup", async (job) => {
  active.inc();
  try {
    if (job.data.targetType === "index") {
      await rm(join(storagePath, job.data.targetId), { recursive: true, force: true });
    }
    completed.inc();
    return { cleaned: true, targetType: job.data.targetType, targetId: job.data.targetId };
  } catch (error) {
    failed.inc();
    throw error;
  } finally {
    active.dec();
  }
}, {
  connection: redis,
  concurrency: Number(process.env.CLEANUP_WORKER_CONCURRENCY ?? "2")
});

const server = Fastify({ logger: true });
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
let tickInFlight: Promise<void> | undefined;
function tick() {
  if (tickInFlight) return tickInFlight;
  tickInFlight = (async () => {
    try {
      await dispatcher.schedule();
      await dispatcher.dispatch();
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
