import Fastify from "fastify";
import { Worker } from "bullmq";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { eq } from "drizzle-orm";
import { createDatabase, jobs } from "@searchforge/db";
import { createQueues, createRedisConnection, type CrawlJobData } from "@searchforge/queue";
import { CrawlRunner } from "./crawler.js";

const postgresUrl = process.env.POSTGRES_URL;
const redisUrl = process.env.REDIS_URL;
if (!postgresUrl || !redisUrl) throw new Error("POSTGRES_URL and REDIS_URL are required");

const { db, pool } = createDatabase(postgresUrl);
const redis = createRedisConnection(redisUrl);
const queues = createQueues(redis);
const userAgent = process.env.CRAWLER_USER_AGENT ?? "SearchForgeBot/1.0";
const allowPrivateNetworks = process.env.CRAWLER_ALLOW_PRIVATE_NETWORKS === "true";
const runner = new CrawlRunner(db, redis, queues.index, userAgent, allowPrivateNetworks);

const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "searchforge_crawler_" });
const completed = new Counter({ name: "searchforge_crawler_jobs_completed_total", help: "Completed crawl jobs", registers: [metrics] });
const failed = new Counter({ name: "searchforge_crawler_jobs_failed_total", help: "Failed crawl jobs", registers: [metrics] });
const active = new Gauge({ name: "searchforge_crawler_jobs_active", help: "Active crawl jobs", registers: [metrics] });

const worker = new Worker<CrawlJobData>("crawl", async (job) => {
  active.inc();
  try {
    const result = await runner.run(job.data.databaseJobId, job.data.sourceId, job.data.projectId);
    completed.inc();
    return result;
  } catch (error) {
    failed.inc();
    await db.update(jobs).set({
      state: "failed",
      phase: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown crawl failure",
      finishedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(jobs.id, job.data.databaseJobId));
    await redis.publish(`job:${job.data.databaseJobId}`, JSON.stringify({
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown crawl failure"
    }));
    throw error;
  } finally {
    active.dec();
  }
}, {
  connection: redis,
  concurrency: Number(process.env.CRAWLER_JOB_CONCURRENCY ?? "2"),
  lockDuration: 120_000
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

await server.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? "4010") });

async function shutdown() {
  await worker.close();
  await server.close();
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
  await redis.quit();
  await pool.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
