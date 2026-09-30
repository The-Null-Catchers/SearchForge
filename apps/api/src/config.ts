import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  POSTGRES_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  API_KEY_PEPPER: z.string().min(16),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  INDEX_STORAGE_PATH: z.string().default("./storage/indexes")
});

export type Config = z.infer<typeof schema>;
export const config = schema.parse(process.env);
