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
  const handler = source.slice(source.indexOf("resume() {"), source.indexOf("trap resume EXIT"));
  assert.ok(handler.includes('echo "[backup] complete:'));
  assert.ok(handler.includes("if ((status == 0)); then"));
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

test("exit handler reports service restart errors instead of masking them", () => {
  assert.match(source, /local status=\$\?/);
  assert.match(source, /trap - EXIT/);
  assert.match(source, /if ! docker compose start "\$\{WAS_RUNNING\[@\]\}"/);
  assert.match(source, /could not restart previously running writer services/);
  assert.match(source, /exit "\$status"/);
  assert.equal(source.includes('docker compose start "${WAS_RUNNING[@]}" >/dev/null || true'), false);
});

test("backup success message only appears in successful exit handler", () => {
  const handler = source.slice(source.indexOf("resume() {"), source.indexOf("trap resume EXIT"));
  assert.match(handler, /if \(\(status == 0\)\); then[\s\S]*\[backup\] complete:/);
  assert.equal(source.split("[backup] complete:").length - 1, 1);
  assert.ok(source.indexOf("[backup] complete:") < source.indexOf("trap resume EXIT"));
});

test("backup success requires each previously running writer to be running again", () => {
  const handler = source.slice(source.indexOf("resume() {"), source.indexOf("trap resume EXIT"));
  assert.match(handler, /docker compose ps --services --status running/);
  assert.match(handler, /for service in "\$\{WAS_RUNNING\[@\]\}"/);
  assert.match(handler, /grep -Fxq -- "\$service"/);
  assert.match(handler, /writer service not running after restart/);
  assert.ok(handler.indexOf("docker compose ps --services --status running") < handler.indexOf('echo "[backup] complete:'));
});

test("backup validates archive readability before final checksum signoff", () => {
  assert.match(source, /pg_restore --list/);
  assert.match(source, /tar -tzf \/backup\/index-data\.tar\.gz/);
  assert.match(source, /tar -tzf \/backup\/minio-data\.tar\.gz/);
  assert.ok(source.indexOf("pg_restore --list") < source.lastIndexOf("sha256sum -c checksums.sha256"));
});

test("backup preflights required volumes before stopping writers", () => {
  const check = source.indexOf('docker volume inspect "${PROJECT}_${volume}"');
  assert.ok(check !== -1);
  assert.ok(check < source.indexOf("trap resume EXIT"));
  assert.ok(check < source.indexOf("docker compose stop"));
});
