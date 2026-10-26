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

test("failure cleanup removes temporary volumes but success retains them", () => {
  assert.match(content, /trap cleanup EXIT/);
  assert.match(content, /if \[\[ "\$RESTORE_SUCCEEDED" -ne 1 \]\]/);
  assert.match(content, /docker volume rm -f "\$INDEX_VOLUME" "\$MINIO_VOLUME"/);
  assert.match(content, /RESTORE_SUCCEEDED=1\s+echo "\[restore-test\] rehearsal succeeded"/);
});

test("resource collision checks precede cleanup trap", () => {
  assert.match(content, /docker container inspect "\$PG_CONTAINER"/);
  assert.match(content, /docker volume inspect "\$INDEX_VOLUME"/);
  assert.match(content, /docker volume inspect "\$MINIO_VOLUME"/);
  assert.ok(content.indexOf('docker volume inspect "$MINIO_VOLUME"') < content.indexOf("trap cleanup EXIT"));
});



test("restore names include the actual Bash PID", () => {
  assert.ok(content.includes('STAMP="$(date -u +%Y%m%dT%H%M%SZ)-${BASHPID}"'));
  assert.equal(content.includes('STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$"'), false);
});

test("archive member paths are checked before restoring resources", () => {
  assert.match(content, /tar -tzf/);
  assert.match(content, /awk -F\//);
  assert.match(content, /rejected unsafe or unreadable archive/);
  assert.ok(content.indexOf("for archive in index-data.tar.gz") < content.indexOf("docker volume create"));
  assert.ok(content.indexOf("for archive in index-data.tar.gz") < content.indexOf("docker run -d --name"));
});
