import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  POSTGRES_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  API_KEY_PEPPER: z.string().min(16),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  INDEX_STORAGE_PATH: z.string().default("./storage/indexes"),
  PUBLIC_WEB_URL: z.string().url().default("http://localhost:3000"),
  SMTP_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  MAIL_FROM: z.string().default("SearchForge <no-reply@localhost>"),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  OTEL_SERVICE_NAME: z.string().min(1).max(128).default("searchforge-api"),
  OTEL_TRACE_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.1),
  OTEL_EXPORT_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
  GIT_SHA: z.string().max(128).optional()
});

export type Config = z.infer<typeof schema>;
export const config = schema.superRefine((value, ctx) => {
  if (value.NODE_ENV === "production" && !value.SMTP_URL) {
    ctx.addIssue({ code: "custom", path: ["SMTP_URL"], message: "SMTP_URL is required in production for verification and password reset" });
  }
}).parse(process.env);
