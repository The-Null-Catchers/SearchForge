import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../scripts/verify-release-evidence.mjs", import.meta.url));
function run(changes = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sf-evidence-"));
  try {
    const manifest = {
      target: { baseUrl: "https://search.example.org", indexSlug: "docs" },
      corpus: { documentCount: 10 },
      load: { requests: 3, concurrency: 2, warmupRequests: 1, maxErrorRate: 0, maxP95Ms: null }
    };
    const report = {
      target: { ...manifest.target },
      configuration: { requests: 3, concurrency: 2, warmupRequests: 1 },
      measurement: { successes: 3, failures: 0 },
      thresholds: { maxErrorRate: 0, maxP95Ms: null, passed: true }
    };
    Object.assign(report, changes);
    const a = join(dir, "manifest.json"), b = join(dir, "load.json");
    writeFileSync(a, JSON.stringify(manifest));
    writeFileSync(b, JSON.stringify(report));
    return spawnSync(process.execPath, [script, a, b], { encoding: "utf8" }).status;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("valid measurement passes", () => assert.equal(run(), 0));
test("mismatched count fails", () => assert.notEqual(run({ configuration: { requests: 4, concurrency: 2, warmupRequests: 1 } }), 0));
test("failed measurement fails", () => assert.notEqual(run({ thresholds: { maxErrorRate: 0, maxP95Ms: null, passed: false } }), 0));
test("missing successful requests fails", () => assert.notEqual(run({ measurement: { successes: 0, failures: 3 } }), 0));
