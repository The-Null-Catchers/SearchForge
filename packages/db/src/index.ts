import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as baseSchema from "./schema.js";
import * as quotaSchema from "./quota-schema.js";

const schema = { ...baseSchema, ...quotaSchema };

export function createDatabase(connectionString = process.env.POSTGRES_URL) {
  if (!connectionString) throw new Error("POSTGRES_URL is required");
  const pool = new Pool({ connectionString, max: 20 });
  return {
    db: drizzle(pool, { schema }),
    pool
  };
}

export * from "./schema.js";
export * from "./quota-schema.js";
