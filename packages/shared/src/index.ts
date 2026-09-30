import { z } from "zod";

export const languageSchema = z.enum(["en", "ar", "mixed", "auto"]);
export type SearchLanguage = z.infer<typeof languageSchema>;

export const fieldTypeSchema = z.enum(["text", "keyword", "number", "boolean", "date", "array"]);
export type FieldType = z.infer<typeof fieldTypeSchema>;

export const arabicAnalyzerSettingsSchema = z.object({
  normalizeAlef: z.boolean().default(true),
  normalizeYa: z.boolean().default(true),
  normalizeTaaMarbuta: z.boolean().default(false),
  removeTatweel: z.boolean().default(true),
  removeDiacritics: z.boolean().default(true),
  lightStem: z.boolean().default(true)
});

export const indexSettingsSchema = z.object({
  defaultLanguage: languageSchema.default("auto"),
  supportedLanguages: z.array(languageSchema).default(["en", "ar"]),
  stopWords: z.record(z.string(), z.array(z.string())).default({}),
  fieldBoosts: z.record(z.string(), z.number().positive()).default({
    title: 4,
    headings: 2.5,
    content: 1
  }),
  bm25: z.object({
    k1: z.number().min(0.1).max(4).default(1.2),
    b: z.number().min(0).max(1).default(0.75)
  }).default({ k1: 1.2, b: 0.75 }),
  arabic: arabicAnalyzerSettingsSchema.default({
    normalizeAlef: true,
    normalizeYa: true,
    normalizeTaaMarbuta: false,
    removeTatweel: true,
    removeDiacritics: true,
    lightStem: true
  }),
  typoTolerance: z.object({
    enabled: z.boolean().default(true),
    maxDistance: z.number().int().min(0).max(2).default(2),
    minTokenLength: z.number().int().min(2).max(12).default(4)
  }).default({ enabled: true, maxDistance: 2, minTokenLength: 4 }),
  prefixSearch: z.boolean().default(true)
});
export type IndexSettings = z.infer<typeof indexSettingsSchema>;

const scalarFilterValue = z.union([z.string(), z.number(), z.boolean()]);
export const filterConditionSchema = z.object({
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "range"]),
  value: z.union([
    scalarFilterValue,
    z.array(scalarFilterValue),
    z.object({ min: z.number().optional(), max: z.number().optional() })
  ])
});
export const filtersSchema = z.record(z.string(), z.union([scalarFilterValue, filterConditionSchema]));

export const searchRequestSchema = z.object({
  query: z.string().max(1000).default(""),
  filters: filtersSchema.optional(),
  facets: z.array(z.string()).max(20).optional(),
  sort: z.object({
    field: z.string(),
    direction: z.enum(["asc", "desc"])
  }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(10000).default(0),
  cursor: z.string().optional(),
  typoTolerance: z.boolean().optional(),
  debug: z.boolean().default(false)
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

export type HighlightRange = {
  field: string;
  start: number;
  end: number;
  term: string;
};

export type SearchHit<T = Record<string, unknown>> = {
  id: string;
  score: number;
  document: T;
  highlights: HighlightRange[];
  explanation?: Record<string, number>;
};

export type SearchResponse<T = Record<string, unknown>> = {
  query: string;
  processingTimeMs: number;
  total: number;
  indexVersion: string;
  hits: SearchHit<T>[];
  facets: Record<string, Record<string, number>>;
  nextCursor?: string;
};

export const crawlConfigSchema = z.object({
  startUrls: z.array(z.string().url()).min(1).max(100),
  maxDepth: z.number().int().min(0).max(50).default(5),
  maxPages: z.number().int().min(1).max(1_000_000).default(10_000),
  include: z.array(z.string()).default(["/**"]),
  exclude: z.array(z.string()).default([]),
  allowedDomains: z.array(z.string()).default([]),
  requestTimeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
  concurrency: z.number().int().min(1).max(64).default(8),
  perDomainConcurrency: z.number().int().min(1).max(16).default(2),
  respectRobots: z.boolean().default(true),
  storeRawHtml: z.boolean().default(false)
});
export type CrawlConfig = z.infer<typeof crawlConfigSchema>;

export const jobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export const jobProgressSchema = z.object({
  status: jobStatusSchema,
  phase: z.string(),
  discovered: z.number().int().nonnegative().default(0),
  processed: z.number().int().nonnegative().default(0),
  failed: z.number().int().nonnegative().default(0),
  total: z.number().int().nonnegative().optional(),
  message: z.string().optional()
});
export type JobProgress = z.infer<typeof jobProgressSchema>;

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "PROJECT_NOT_FOUND"
  | "INDEX_NOT_FOUND"
  | "SOURCE_NOT_FOUND"
  | "JOB_NOT_FOUND"
  | "CRAWL_BLOCKED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}
