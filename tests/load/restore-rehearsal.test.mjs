import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assert.match(content, /tarfile\.open/);
  assert.match(content, /pathlib\.PurePosixPath/);
  assert.match(content, /rejected unsafe or unreadable archive/);
  assert.ok(content.indexOf("for archive in index-data.tar.gz") < content.indexOf("docker volume create"));
  assert.ok(content.indexOf("for archive in index-data.tar.gz") < content.indexOf("docker run -d --name"));
});

test("restore rejects symlink hardlink and special archive entries", () => {
  assert.match(content, /not \(member\.isfile\(\) or member\.isdir\(\)\)/);
  assert.match(content, /name\.is_absolute\(\)/);
  assert.match(content, /"\.\." in name\.parts/);
  assert.ok(content.indexOf("python:3.12-alpine") < content.indexOf("docker volume create"));
});

test("tar archive validator accepts normal files and rejects links and traversal", () => {
  const pythonCheck = content.match(/python -c '\n([\s\S]*?)\n' "\$archive"/);
  assert.ok(pythonCheck, "Python archive validator should remain discoverable");
  const root = mkdtempSync(join(tmpdir(), "searchforge-tar-"));
  try {
    const py = [
      "import io, pathlib, tarfile, sys",
      "root = pathlib.Path(sys.argv[1])",
      "for name, member_name, kind, accepted in [",
      " ('valid','data/file.txt','file',True),",
      " ('traversal','../escape','file',False),",
      " ('absolute','/tmp/escape','file',False),",
      " ('symlink','data/link','symlink',False),",
      " ('hardlink','data/hard','hardlink',False),",
      "]:",
      " path = root / (name + '.tar.gz')",
      " with tarfile.open(path, 'w:gz') as tf:",
      "  info = tarfile.TarInfo(member_name)",
      "  info.type = {'file':tarfile.REGTYPE, 'symlink':tarfile.SYMTYPE, 'hardlink':tarfile.LNKTYPE}[kind]",
      "  info.linkname = 'data/file.txt' if kind != 'file' else ''",
      "  info.size = 1 if kind == 'file' else 0",
      "  tf.addfile(info, io.BytesIO(b'x') if kind == 'file' else None)",
    ].join("\n");
    const created = spawnSync("python3", ["-c", py, root], { encoding: "utf8" });
    assert.equal(created.status, 0, created.stderr);
    for (const [name, accepted] of [["valid",true],["traversal",false],["absolute",false],["symlink",false],["hardlink",false]]) {
      const scriptBody = pythonCheck[1].replace('"/backup/" + sys.argv[1]', 'sys.argv[1]');
      const result = spawnSync("python3", ["-c", scriptBody, join(root, name + ".tar.gz")], { encoding: "utf8" });
      assert.equal(result.status === 0, accepted, name + ": " + result.stderr);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
