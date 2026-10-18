import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("../../scripts/validate-release-target.mjs", import.meta.url));
function validate(target) {
  return spawnSync(process.execPath, [validator, target], { encoding: "utf8" });
}

test("accepts a clean HTTPS origin", () => {
  assert.equal(validate("https://search.example.com").status, 0);
});
for (const target of [
  "http://search.example.com",
  "https://user:password@search.example.com",
  "https://search.example.com/private",
  "https://search.example.com/?key=hidden",
  "https://search.example.com/#secret",
  "http://localhost:8080",
  "https://localhost",
  "https://127.0.0.1",
  "https://192.168.1.10",
  "https://169.254.169.254",
  "https://[::1]",
  "https://[2001:db8::1]",
  "https://internal",
  "https://search.local",
  "https://search.internal",
  "https://search.test",
  "https://search.invalid",
  "https://search.example",
  "https://search.onion",
  "https://search.home.arpa",
  "https://search.example.com.",
  "not a URL"
]) {
  test(`rejects unsafe release target: ${target}`, () => {
    assert.notEqual(validate(target).status, 0);
  });
}
