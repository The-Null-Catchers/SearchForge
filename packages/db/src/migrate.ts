import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is required");
const pool = new Pool({ connectionString: process.env.POSTGRES_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(734018236)");
  await client.query("CREATE TABLE IF NOT EXISTS searchforge_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const directory = fileURLToPath(new URL("../migrations/", import.meta.url));
  for (const name of (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
    const sql = await readFile(`${directory}/${name}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await client.query<{ checksum: string }>("SELECT checksum FROM searchforge_migrations WHERE name = $1", [name]);
    if (applied.rows[0]) {
      if (applied.rows[0].checksum !== checksum) throw new Error(`Applied migration was modified: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO searchforge_migrations(name, checksum) VALUES ($1, $2)", [name, checksum]);
      await client.query("COMMIT");
      console.log(JSON.stringify({ event: "migration.applied", name }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  // Session locks are released by connection closure even after failure.
  client.release(true);
  await pool.end();
}
