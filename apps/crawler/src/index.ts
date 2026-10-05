import Fastify from "fastify";
import { Worker } from "bullmq";
import { Counter, Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createDatabase, jobs } from "@searchforge/db";
import { claimJobRun, createQueues, createRedisConnection, finishCancelled, heartbeatJobRun, JobCancelled, JobFenced, type CrawlJobData } from "@searchforge/queue";
import { CrawlRunner } from "./crawler.js";

const postgresUrl = process.env.POSTGRES_URL;
const redisUrl = process.env.REDIS_URL;
if (!postgresUrl || !redisUrl) throw new Error("POSTGRES_URL and REDIS_URL are required");

const { db, pool } = createDatabase(postgresUrl);
const redis = createRedisConnection(redisUrl);
const queues = createQueues(redis);
const userAgent = process.env.CRAWLER_USER_AGENT ?? "SearchForgeBot/1.0";
const allowPrivateNetworks = process.env.CRAWLER_ALLOW_PRIVATE_NETWORKS === "true";
const runner = new CrawlRunner(db, redis, userAgent, allowPrivateNetworks);

const metrics = new Registry();
collectDefaultMetrics({ register: metrics, prefix: "searchforge_crawler_" });
const completed = new Counter({ name: "searchforge_crawler_jobs_completed_total", help: "Completed crawl jobs", registers: [metrics] });
const failed = new Counter({ name: "searchforge_crawler_jobs_failed_total", help: "Failed crawl jobs", registers: [metrics] });
const fenced = new Counter({ name: "searchforge_crawler_jobs_fenced_total", help: "Crawler deliveries ignored after execution fencing", registers: [metrics] });
const active = new Gauge({ name: "searchforge_crawler_jobs_active", help: "Active crawl jobs", registers: [metrics] });

const worker = new Worker<CrawlJobData>("crawl", async (job) => {
  active.inc();
  const executionId = typeof job.id === "string" ? job.id : String(job.id ?? "");
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    if (!executionId || !(await claimJobRun(db, job.data.databaseJobId, executionId))) {
      fenced.inc();
      return { fenced: true };
    }
    heartbeat = setInterval(() => {
      void heartbeatJobRun(db, job.data.databaseJobId, executionId)
        .catch(error => server.log.error({ err: error, databaseJobId: job.data.databaseJobId }, "Crawler heartbeat failed"));
    }, 15_000);
    const result = await runner.run(job.data.databaseJobId, job.data.sourceId, job.data.projectId);
    completed.inc();
    return result;
  } catch (error) {
    const [current] = await db.select().from(jobs).where(eq(jobs.id, job.data.databaseJobId)).limit(1);
    if (current?.state === "completed") return current.progress;
    if (current?.externalJobId !== executionId || error instanceof JobFenced) {
      fenced.inc();
      return { fenced: true };
    }
    if (error instanceof JobCancelled || current?.cancelRequestedAt) {
      await finishCancelled(db, job.data.databaseJobId, executionId);
      await redis.publish(`job:${job.data.databaseJobId}`, JSON.stringify({ status: "cancelled", phase: "cancelled" }));
      return { cancelled: true };
    }
    failed.inc();
    await db.update(jobs).set({
      state: "failed",
      phase: "failed",
      errorMessage: error instanceof Error ? error.message : "Unknown crawl failure",
      finishedAt: new Date(),
      updatedAt: new Date()
    }).where(and(eq(jobs.id, job.data.databaseJobId), eq(jobs.externalJobId, executionId), inArray(jobs.state, ["queued", "running", "failed"]), isNull(jobs.cancelRequestedAt)));
    await redis.publish(`job:${job.data.databaseJobId}`, JSON.stringify({
      status: "failed",
      message: error instanceof Error ? error.message : "Unknown crawl failure"
    }));
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    active.dec();
  }
}, {
  connection: redis,
  concurrency: Number(process.env.CRAWLER_JOB_CONCURRENCY ?? "2"),
  lockDuration: 120_000
});

const server = Fastify({ logger: true });
worker.on("error", error => server.log.error({ err: error }, "Queue worker error"));
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
