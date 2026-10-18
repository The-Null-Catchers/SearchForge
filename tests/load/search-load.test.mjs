import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const harness = fileURLToPath(new URL("./search-load.mjs", import.meta.url));

async function runHarness(status, payload, maxErrorRate = "0") {
  const outputDir = await mkdtemp(join(tmpdir(), "searchforge-load-test-"));
  const server = createServer((request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const outputPath = join(outputDir, "report.json");

  try {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [harness], {
        env: {
          ...process.env,
          SEARCHFORGE_LOAD_BASE_URL: `http://127.0.0.1:${address.port}`,
          SEARCHFORGE_LOAD_API_KEY: "test-only-secret",
          SEARCHFORGE_LOAD_REQUESTS: "3",
          SEARCHFORGE_LOAD_WARMUP: "1",
          SEARCHFORGE_LOAD_CONCURRENCY: "2",
          SEARCHFORGE_LOAD_MAX_ERROR_RATE: maxErrorRate,
          SEARCHFORGE_LOAD_OUTPUT: outputPath
        },
        stdio: "ignore"
      });
      child.once("error", reject);
      child.once("close", resolve);
    });
    return { exitCode, report: JSON.parse(await readFile(outputPath, "utf8")) };
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(outputDir, { recursive: true, force: true });
  }
}

test("accepts valid search responses", async () => {
  const { exitCode, report } = await runHarness(200, { hits: [], total: 0, processingTimeMs: 1 });
  assert.equal(exitCode, 0);
  assert.equal(report.measurement.successes, 3);
  assert.equal(report.thresholds.passed, true);
  assert.equal(JSON.stringify(report).includes("test-only-secret"), false);
});

test("counts malformed HTTP 200 payloads as failures", async () => {
  const { exitCode, report } = await runHarness(200, { message: "unexpected response" });
  assert.equal(exitCode, 1);
  assert.equal(report.measurement.failures, 3);
  assert.equal(report.measurement.errorCounts.INVALID_SEARCH_RESPONSE, 3);
});

test("never passes a run without successes even with a 100% error allowance", async () => {
  const { exitCode, report } = await runHarness(503, { error: { code: "UNAVAILABLE" } }, "1");
  assert.equal(exitCode, 1);
  assert.equal(report.thresholds.passed, false);
  assert.equal(report.measurement.successes, 0);
});

test("never persists untrusted HTTP error details", async () => {
  const sensitive = "private-token-should-not-appear";
  const { exitCode, report } = await runHarness(503, {
    error: { code: sensitive, message: sensitive }
  });
  assert.equal(exitCode, 1);
  assert.deepEqual(report.measurement.errorCounts, { HTTP_ERROR: 3 });
  assert.equal(JSON.stringify(report).includes(sensitive), false);
});
