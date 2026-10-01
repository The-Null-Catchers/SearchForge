import { Queue, type JobsOptions } from "bullmq";
import { Redis as IORedis } from "ioredis";
export * from "./lifecycle.js";

export const queueNames = [
  "crawl",
  "fetch",
  "extract",
  "normalize",
  "index",
  "merge",
  "analytics",
  "cleanup"
] as const;

export type QueueName = (typeof queueNames)[number];

export type CrawlJobData = {
  databaseJobId: string;
  projectId: string;
  sourceId: string;
};

export type IndexJobData = {
  databaseJobId: string;
  projectId: string;
  indexId: string;
};

export type CleanupJobData = {
  databaseJobId: string;
  projectId: string;
  targetType: "project" | "source" | "index";
  targetId: string;
};

export const defaultJobOptions: JobsOptions = {
  attempts: 4,
  backoff: { type: "exponential", delay: 1500 },
  removeOnComplete: { age: 86_400, count: 10_000 },
  removeOnFail: { age: 604_800, count: 20_000 }
};

export function createRedisConnection(url: string): IORedis {
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false
  });
}

export function createQueues(connection: IORedis) {
  return Object.fromEntries(
    queueNames.map((name) => [
      name,
      new Queue(name, { connection, defaultJobOptions })
    ])
  ) as Record<QueueName, Queue>;
}
