import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const base = new URL(process.env.SEARCHFORGE_URL ?? "http://127.0.0.1");
assert(["http:", "https:"].includes(base.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  && !base.username && !base.password && base.pathname === "/" && !base.search && !base.hash,
"Use a clean loopback origin for the disposable benchmark");
const output = process.env.SEARCHFORGE_BENCHMARK_OUTPUT ?? "artifacts/benchmark-demo";
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert(!execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(),
  "Benchmark a committed revision");
const fixture = JSON.parse(await readFile(new URL("../fixtures/demo-documents.json", import.meta.url), "utf8"));
const queries = ["javascript", "distributed systems", "محرك بحث", "تطبيع النص العربي"];
const environment = process.env.SEARCHFORGE_BENCHMARK_ENVIRONMENT ?? "Disposable loopback service";
const id = randomUUID().slice(0, 8);

async function call(method, route, key, data) {
  const response = await fetch(new URL(route, base), {
    method, redirect: "error", signal: AbortSignal.timeout(30_000),
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(data ? { "content-type": "application/json" } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  assert(response.ok, `${method} ${route} returned HTTP ${response.status}`);
  return response.json();
}

async function ingest(documents, project, accessToken) {
  const started = performance.now();
  const accepted = await call("POST", "/v1/indexes/docs/documents/batch", project.adminKey, { documents });
  assert.equal(accepted.accepted, documents.length);
  for (let attempt = 0; attempt < 300; attempt++) {
    const job = await call("GET", `/v1/jobs/${accepted.jobId}`, accessToken);
    if (job.state === "completed") {
      return {
        ingestToCompletionMs: Math.round(performance.now() - started),
        workerJobMs: Date.parse(job.finishedAt) - Date.parse(job.startedAt)
      };
    }
    assert(["queued", "running"].includes(job.state), `Indexing finished in state ${job.state}`);
    await delay(250);
  }
  throw new Error("Indexing did not complete within the polling window");
}

await mkdir(output, { recursive: true });
const { accessToken } = await call("POST", "/v1/auth/login", null, {
  email: process.env.SEARCHFORGE_BENCHMARK_EMAIL ?? "owner@searchforge.local",
  password: process.env.SEARCHFORGE_DEMO_PASSWORD ?? "SearchForgeDemo123!"
});
const org = await call("POST", "/v1/organizations", accessToken, { name: "Synthetic benchmark", slug: `benchmark-${id}` });
const report = {
  gitSha: sha, environment, generatedAt: new Date().toISOString(),
  runner: { platform: platform(), release: release(), cpu: cpus()[0]?.model, logicalCpuCount: cpus().length, memoryBytes: totalmem(), node: process.version },
  queries, scenarios: []
};

for (const copies of [1, 100]) {
  const documents = copies === 1 ? fixture : Array.from({ length: copies }, (_, i) =>
    fixture.map(doc => ({ ...doc, id: `${doc.id}-${i}`, title: `${doc.title} ${i}` }))).flat();
  const project = await call("POST", `/v1/organizations/${org.id}/projects`, accessToken, {
    name: `Synthetic ${documents.length} documents`, slug: `synthetic-${documents.length}`
  });
  const timings = await ingest(documents, project, accessToken);
  const { versions } = await call("GET", `/v1/indexes/${project.index.id}/versions`, accessToken);
  const version = versions.find(entry => entry.state === "active");
  assert.equal(version?.documentCount, documents.length);
  assert(version.indexedBytes > 0 && Number.isFinite(timings.workerJobMs));
  for (const concurrency of [1, 12]) {
    const file = `search-${documents.length}-c${concurrency}.json`;
    const run = spawnSync(process.execPath, ["tests/load/search-load.mjs"], {
      stdio: "inherit",
      env: {
        ...process.env,
        SEARCHFORGE_LOAD_API_KEY: project.searchKey, SEARCHFORGE_LOAD_BASE_URL: base.origin, SEARCHFORGE_LOAD_INDEX: "docs",
        SEARCHFORGE_LOAD_QUERIES: queries.join(","), SEARCHFORGE_LOAD_REQUESTS: "45",
        SEARCHFORGE_LOAD_WARMUP: "8", SEARCHFORGE_LOAD_CONCURRENCY: String(concurrency), SEARCHFORGE_LOAD_MAX_ERROR_RATE: "0",
        SEARCHFORGE_LOAD_OUTPUT: join(output, file), SEARCHFORGE_LOAD_SOURCE_SHA: sha,
        SEARCHFORGE_LOAD_CORPUS: `${copies} copies of the eight-document bilingual fixture`,
        SEARCHFORGE_LOAD_ENVIRONMENT: environment
      }
    });
    assert.equal(run.status, 0, `Load harness failed for ${file}`);
    report.scenarios.push({ documentCount: documents.length, indexBytes: version.indexedBytes, concurrency, ...timings, file });
  }
}
await writeFile(join(output, "summary.json"), JSON.stringify(report, null, 2) + "\n");
