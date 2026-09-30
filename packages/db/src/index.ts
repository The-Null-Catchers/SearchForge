import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export function createDatabase(connectionString = process.env.POSTGRES_URL) {
  if (!connectionString) throw new Error("POSTGRES_URL is required");
  const pool = new Pool({ connectionString, max: 20 });
  return {
    db: drizzle(pool, { schema }),
    pool
  };
}

export * from "./schema.js";
