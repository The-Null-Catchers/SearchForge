import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("../../scripts/backup.sh", import.meta.url));
const source = readFileSync(script, "utf8");
test("backup Bash script has valid syntax", () => {
  assert.equal(spawnSync("bash", ["-n", script]).status, 0);
});
test("existing backup files are rejected before writers are stopped", () => {
  assert.match(source, /\[\[ -e "\$OUT_DIR\/\$file" \|\| -L "\$OUT_DIR\/\$file" \]\]/);
  assert.ok(source.indexOf("for file in postgres.dump") < source.indexOf("docker compose stop"));
  for (const name of ["postgres.dump", "index-data.tar.gz", "minio-data.tar.gz", "manifest.txt", "checksums.sha256"]) {
    assert.ok(source.includes(name));
  }
});

test("backup completion requires nonempty artifacts and verified checksums", () => {
  assert.match(source, /\[\[ ! -s "\$OUT_DIR\/\$file" \]\]/);
  assert.match(source, /sha256sum -c checksums\.sha256/);
  assert.ok(source.indexOf("sha256sum -c checksums.sha256") < source.indexOf('echo "[backup] complete:'));
});

test("backup and release scripts set private umask before creating artifacts", () => {
  const releaseScript = fileURLToPath(new URL("../../scripts/release-evidence.sh", import.meta.url));
  for (const path of [script, releaseScript]) {
    const body = readFileSync(path, "utf8");
    assert.equal(spawnSync("bash", ["-n", path]).status, 0);
    assert.match(body, /^umask 077$/m);
    assert.ok(body.indexOf("umask 077") < body.indexOf('mkdir -p "$OUT_DIR"'));
  }
});
