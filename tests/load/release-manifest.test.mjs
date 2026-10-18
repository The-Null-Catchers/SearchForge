import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = readFileSync(fileURLToPath(new URL("../../scripts/release-evidence.sh", import.meta.url)), "utf8");
const match = script.match(/node <<'NODE' > "\$OUT_DIR\/manifest\.json"\n([\s\S]*?)\nNODE/);
assert.ok(match, "release manifest builder must exist");
const builder = match[1];

function manifest(overrides = {}) {
  const result = spawnSync(process.execPath, ["-e", builder], {
    env: {
      ...process.env,
      GIT_SHA: "test-sha",
      GENERATED_AT: "2026-10-17T00:00:00Z",
      SEARCHFORGE_LOAD_BASE_URL: "https://example.test",
      SEARCHFORGE_RELEASE_CORPUS: "test corpus",
      SEARCHFORGE_RELEASE_DOCUMENT_COUNT: "10",
      SEARCHFORGE_LOAD_REQUESTS: "3",
      SEARCHFORGE_LOAD_MAX_ERROR_RATE: "0",
      ...overrides
    },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("manifest preserves strict zero-error threshold", () => {
  assert.equal(manifest().load.maxErrorRate, 0);
});

test("manifest uses the harness's bounded warmup default", () => {
  assert.equal(manifest().load.warmupRequests, 3);
});

test("manifest preserves an explicit warmup", () => {
  assert.equal(manifest({ SEARCHFORGE_LOAD_WARMUP: "8" }).load.warmupRequests, 8);
});
