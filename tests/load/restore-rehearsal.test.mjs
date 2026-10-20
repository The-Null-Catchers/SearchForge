import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../scripts/restore-rehearsal.sh", import.meta.url));
const content = readFileSync(script, "utf8");
test("restore script parses as Bash", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
});
test("restore refuses empty table and archive counts", () => {
  for (const name of ["PG_TABLE_COUNT", "INDEX_COUNT", "MINIO_COUNT"]) {
    assert.match(content, new RegExp('\\[\\[ "\\$' + name + '" =~ \\^\\[1-9\\]\\[0-9\\]\\*\\$ \\]\\]'));
  }
});
