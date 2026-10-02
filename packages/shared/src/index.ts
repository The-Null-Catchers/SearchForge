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

export type ScalarFilterValue = string | number | boolean;
export type FilterCondition = {
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "range";
  value: ScalarFilterValue | ScalarFilterValue[] | {
    min?: number | string | undefined;
    max?: number | string | undefined;
  };
};
export type FlatFilters = Record<string, ScalarFilterValue | FilterCondition>;
export type FilterExpression = FlatFilters | { and: FilterExpression[] } | { or: FilterExpression[] };

const scalarFilterValue = z.union([z.string(), z.number(), z.boolean()]);
const rangeBoundary = z.union([z.number(), z.string()]);
export const filterConditionSchema: z.ZodType<FilterCondition> = z.object({
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "range"]),
  value: z.union([
    scalarFilterValue,
    z.array(scalarFilterValue),
    z.object({ min: rangeBoundary.optional(), max: rangeBoundary.optional() })
  ])
});
const flatFiltersSchema: z.ZodType<FlatFilters> = z.record(
  z.string(),
  z.union([scalarFilterValue, filterConditionSchema])
);
export const filtersSchema: z.ZodType<FilterExpression> = z.lazy(() => z.union([
  flatFiltersSchema,
  z.object({ and: z.array(filtersSchema).min(1).max(50) }).strict(),
  z.object({ or: z.array(filtersSchema).min(1).max(50) }).strict()
]));

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
  startUrls: z.array(z.string().url().max(2048).refine(value => {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password; }
    catch { return false; }
  }, "Use an HTTP(S) URL without credentials")).min(1).max(100),
  maxDepth: z.number().int().min(0).max(50).default(5),
  maxPages: z.number().int().min(1).max(1_000_000).default(10_000),
  include: z.array(z.string().min(1).max(256)).max(100).default(["/**"]),
  exclude: z.array(z.string().min(1).max(256)).max(100).default([]),
  allowedDomains: z.array(z.string().min(1).max(253).refine(value => {
    try { const url = new URL(`https://${value}`); return url.hostname === value.toLowerCase() && url.host === value.toLowerCase() && url.pathname === "/" && !url.username && !url.password; }
    catch { return false; }
  }, "Use a hostname without a scheme, port or path")).max(100).default([]),
  requestTimeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
  concurrency: z.number().int().min(1).max(64).default(8),
  perDomainConcurrency: z.number().int().min(1).max(16).default(2),
  retryMaxAttempts: z.number().int().min(1).max(5).default(3),
  retryBaseDelayMs: z.number().int().min(100).max(10_000).default(500),
  retryMaxDelayMs: z.number().int().min(100).max(30_000).default(30_000),
  respectRobots: z.literal(true).default(true),
  storeRawHtml: z.boolean().default(false)
});
export type CrawlConfig = z.infer<typeof crawlConfigSchema>;

export type ConsoleDocumentSummary = {
  id: string; documentId: string; title: string; url: string | null; language: string | null;
  sourceId: string | null; deletedAt: string | null; updatedAt: string;
};
export type ConsoleDocumentsPage = { documents: ConsoleDocumentSummary[]; nextAfter: string | null };
export type DocumentTerm = { field: string; term: string; frequency: number; positions: number[]; documentFrequency: number };
export type ConsoleDocumentDetail = {
  documentId: string; body: Record<string, unknown>; activeDocument: Record<string, unknown> | null;
  sourceId: string | null; deletedAt: string | null; updatedAt: string;
  state: "deleted" | "indexed" | "pending"; activeVersion: string | null; inActiveVersion: boolean;
  terms: DocumentTerm[]; termsTruncated: boolean;
};
export type CrawlPageView = {
  id: string; jobId: string; url: string; status: string; httpStatus: number | null;
  responseTimeMs: number | null; contentType: string | null; canonicalUrl: string | null;
  crawledAt: string | null; error: string | null; depth: number;
};
export type CrawlPagesResponse = { pages: CrawlPageView[]; nextCursor: string | null };

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
  | "JOB_FINISHED"
  | "JOB_NOT_CANCELLABLE"
  | "CONFIRMATION_REQUIRED"
  | "INDEX_UNAVAILABLE"
  | "SOURCE_UNAVAILABLE"
  | "DOCUMENT_NOT_FOUND"
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
