import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

const baseUrl = (process.env.SEARCHFORGE_LOAD_BASE_URL ?? "").replace(/\/$/, "");
const apiKey = process.env.SEARCHFORGE_LOAD_API_KEY ?? "";
const indexSlug = process.env.SEARCHFORGE_LOAD_INDEX ?? "docs";
const requests = positiveInt("SEARCHFORGE_LOAD_REQUESTS", 500);
const concurrency = positiveInt("SEARCHFORGE_LOAD_CONCURRENCY", 10);
const warmupRequests = positiveInt("SEARCHFORGE_LOAD_WARMUP", Math.min(25, requests));
const timeoutMs = positiveInt("SEARCHFORGE_LOAD_TIMEOUT_MS", 10_000);
const maxErrorRate = ratio("SEARCHFORGE_LOAD_MAX_ERROR_RATE", 0.01);
const maxP95Ms = optionalPositiveNumber("SEARCHFORGE_LOAD_MAX_P95_MS");
const outputPath = process.env.SEARCHFORGE_LOAD_OUTPUT ?? "artifacts/load/search-load.json";
const queries = (process.env.SEARCHFORGE_LOAD_QUERIES ?? "search,documentation,api,بحث,توثيق")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

if (!baseUrl) fail("SEARCHFORGE_LOAD_BASE_URL is required");
if (!apiKey) fail("SEARCHFORGE_LOAD_API_KEY is required");
if (queries.length === 0) fail("SEARCHFORGE_LOAD_QUERIES must contain at least one query");

function positiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) fail(`${name} must be a positive integer`);
  return value;
}

function ratio(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(`${name} must be between 0 and 1`);
  return value;
}

function optionalPositiveNumber(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) fail(`${name} must be greater than 0`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function oneRequest(sequence) {
  const query = queries[sequence % queries.length];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}/v1/indexes/${encodeURIComponent(indexSlug)}/search`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ query, limit: 10 }),
      signal: controller.signal
    });
    const body = await response.json().catch(() => null);
    const latencyMs = performance.now() - started;
    if (!response.ok) {
      return { ok: false, status: response.status, latencyMs, error: body?.error?.code ?? body?.error?.message ?? "HTTP_ERROR" };
    }
    return {
      ok: true,
      status: response.status,
      latencyMs,
      engineMs: Number.isFinite(body?.processingTimeMs) ? body.processingTimeMs : null,
      resultCount: Number.isFinite(body?.total) ? body.total : null
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: performance.now() - started,
      error: error?.name === "AbortError" ? "TIMEOUT" : String(error?.message ?? error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runBatch(count, width) {
  const results = new Array(count);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= count) return;
      results[index] = await oneRequest(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, count) }, () => worker()));
  return results;
}

console.log(`Warming SearchForge with ${warmupRequests} requests...`);
await runBatch(warmupRequests, Math.min(concurrency, warmupRequests));

console.log(`Measuring ${requests} requests at concurrency ${concurrency}...`);
const startedAt = new Date();
const wallStarted = performance.now();
const results = await runBatch(requests, concurrency);
const wallMs = performance.now() - wallStarted;
const finishedAt = new Date();

const successes = results.filter(row => row.ok);
const failures = results.filter(row => !row.ok);
const wallLatencies = successes.map(row => row.latencyMs).sort((a, b) => a - b);
const engineLatencies = successes.map(row => row.engineMs).filter(Number.isFinite).sort((a, b) => a - b);
const statusCounts = Object.fromEntries([...new Set(results.map(row => row.status))].sort().map(status => [String(status), results.filter(row => row.status === status).length]));
const errorCounts = Object.fromEntries([...new Set(failures.map(row => row.error))].sort().map(error => [String(error), failures.filter(row => row.error === error).length]));
const errorRate = failures.length / requests;

const report = {
  generatedAt: finishedAt.toISOString(),
  target: { baseUrl, indexSlug },
  configuration: { requests, concurrency, warmupRequests, timeoutMs, queries: queries.length },
  measurement: {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: Number(wallMs.toFixed(2)),
    throughputRps: Number((requests / (wallMs / 1000)).toFixed(2)),
    successes: successes.length,
    failures: failures.length,
    errorRate: Number(errorRate.toFixed(6)),
    wallLatencyMs: {
      p50: Number(percentile(wallLatencies, 0.50).toFixed(2)),
      p95: Number(percentile(wallLatencies, 0.95).toFixed(2)),
      p99: Number(percentile(wallLatencies, 0.99).toFixed(2)),
      max: Number((wallLatencies.at(-1) ?? 0).toFixed(2))
    },
    engineLatencyMs: engineLatencies.length ? {
      p50: Number(percentile(engineLatencies, 0.50).toFixed(2)),
      p95: Number(percentile(engineLatencies, 0.95).toFixed(2)),
      p99: Number(percentile(engineLatencies, 0.99).toFixed(2)),
      max: Number((engineLatencies.at(-1) ?? 0).toFixed(2))
    } : null,
    statusCounts,
    errorCounts
  },
  thresholds: {
    maxErrorRate,
    maxP95Ms,
    passed: errorRate <= maxErrorRate && (maxP95Ms === null || percentile(wallLatencies, 0.95) <= maxP95Ms)
  }
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
console.log(`Load report written to ${outputPath}`);

if (!report.thresholds.passed) process.exitCode = 1;
