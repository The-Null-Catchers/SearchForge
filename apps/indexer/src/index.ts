import Fastify from "fastify";
import { Worker } from "bullmq";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { eq } from "drizzle-orm";
import { createDatabase, jobs } from "@searchforge/db";
import { createRedisConnection, type IndexJobData } from "@searchforge/queue";
import { IndexBuilder } from "./index-builder.js";

const postgresUrl = process.env.POSTGRES_URL;
const redisUrl = process.env.REDIS_URL;
if (!postgresUrl || !redisUrl) throw new Error("POSTGRES_URL and REDIS_URL are required");
const storagePath = process.env.INDEX_STORAGE_PATH ?? "./storage/indexes";

const { db, pool } = createDatabase(postgresUrl);
const redis = createRedisConnection(redisUrl);
const builder = new IndexBuilder(db, redis, storagePath);

const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "searchforge_worker_" });
const completed = new Counter({ name: "searchforge_index_jobs_completed_total", help: "Completed index jobs", registers: [metrics] });
const failed = new Counter({ name: "searchforge_index_jobs_failed_total", help: "Failed index jobs", registers: [metrics] });
const active = new Gauge({ name: "searchforge_index_jobs_active", help: "Active index jobs", registers: [metrics] });

const indexWorker = new Worker<IndexJobData>("index", async (job) => {
  active.inc();
  try {
    const result = await builder.build(job.data.databaseJobId, job.data.projectId, job.data.indexId);
    completed.inc();
    return result;
  } catch (error) {
    failed.inc();
    await db.update(jobs).set({
      state: "failed",
      phase: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown indexing failure",
      finishedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(jobs.id, job.data.databaseJobId));
    await redis.publish(`job:${job.data.databaseJobId}`, JSON.stringify({
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown indexing failure"
    }));
    throw error;
  } finally {
    active.dec();
  }
}, {
  connection: redis,
  concurrency: Number(process.env.INDEX_WORKER_CONCURRENCY ?? "2"),
  lockDuration: 180_000
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
await server.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? "4020") });

async function shutdown() {
  await indexWorker.close();
  await server.close();
  await redis.quit();
  await pool.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
