import {
  bigint,
  boolean,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
};

export const orgRole = pgEnum("org_role", ["owner", "admin", "developer", "viewer"]);
export const apiKeyKind = pgEnum("api_key_kind", ["search", "indexing", "admin"]);
export const sourceKind = pgEnum("source_kind", ["website", "api"]);
export const jobState = pgEnum("job_state", ["queued", "running", "completed", "failed", "cancelled"]);
export const indexVersionState = pgEnum("index_version_state", ["building", "ready", "active", "retired", "failed"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  displayName: varchar("display_name", { length: 120 }),
  ...timestamps
}, (t) => ({
  emailUnique: uniqueIndex("users_email_uq").on(t.email)
}));

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 140 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  ...timestamps
}, (t) => ({
  slugUnique: uniqueIndex("organizations_slug_uq").on(t.slug)
}));

export const memberships = pgTable("memberships", {
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: orgRole("role").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  pk: primaryKey({ columns: [t.organizationId, t.userId] }),
  userIndex: index("memberships_user_idx").on(t.userId)
}));

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 140 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  description: text("description"),
  defaultLanguage: varchar("default_language", { length: 16 }).notNull().default("auto"),
  supportedLanguages: jsonb("supported_languages").notNull().$type<string[]>().default(["en", "ar"]),
  indexSettings: jsonb("index_settings").notNull().$type<Record<string, unknown>>().default({}),
  crawlSettings: jsonb("crawl_settings").notNull().$type<Record<string, unknown>>().default({}),
  rankingSettings: jsonb("ranking_settings").notNull().$type<Record<string, unknown>>().default({}),
  autocompleteSettings: jsonb("autocomplete_settings").notNull().$type<Record<string, unknown>>().default({}),
  analyticsEnabled: boolean("analytics_enabled").notNull().default(true),
  ...timestamps
}, (t) => ({
  orgSlugUnique: uniqueIndex("projects_org_slug_uq").on(t.organizationId, t.slug),
  orgIndex: index("projects_org_idx").on(t.organizationId)
}));

export const indexes = pgTable("indexes", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  slug: varchar("slug", { length: 80 }).notNull(),
  schema: jsonb("schema").notNull().$type<Record<string, unknown>>().default({}),
  settings: jsonb("settings").notNull().$type<Record<string, unknown>>().default({}),
  activeVersionId: uuid("active_version_id"),
  minimumVersionSequence: integer("minimum_version_sequence").notNull().default(0),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  ...timestamps
}, (t) => ({
  projectSlugUnique: uniqueIndex("indexes_project_slug_uq").on(t.projectId, t.slug),
  projectIndex: index("indexes_project_idx").on(t.projectId)
}));

export const indexVersions = pgTable("index_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  indexId: uuid("index_id").notNull().references(() => indexes.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  state: indexVersionState("state").notNull().default("building"),
  manifestKey: text("manifest_key"),
  documentCount: integer("document_count").notNull().default(0),
  indexedBytes: bigint("indexed_bytes", { mode: "number" }).notNull().default(0),
  checksum: varchar("checksum", { length: 128 }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  ...timestamps
}, (t) => ({
  indexSequenceUnique: uniqueIndex("index_versions_index_sequence_uq").on(t.indexId, t.sequence),
  stateIndex: index("index_versions_state_idx").on(t.indexId, t.state)
}));

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: sourceKind("kind").notNull(),
  name: varchar("name", { length: 140 }).notNull(),
  config: jsonb("config").notNull().$type<Record<string, unknown>>(),
  enabled: boolean("enabled").notNull().default(true),
  lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
  deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
  ...timestamps
}, (t) => ({
  projectIndex: index("sources_project_idx").on(t.projectId)
}));

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: apiKeyKind("kind").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  prefix: varchar("prefix", { length: 32 }).notNull(),
  secretDigest: varchar("secret_digest", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ipRestrictions: jsonb("ip_restrictions").notNull().$type<string[]>().default([]),
  rateLimitPerMinute: integer("rate_limit_per_minute"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  ...timestamps
}, (t) => ({
  prefixUnique: uniqueIndex("api_keys_prefix_uq").on(t.prefix),
  projectIndex: index("api_keys_project_idx").on(t.projectId)
}));

export const refreshSessions = pgTable("refresh_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  familyId: uuid("family_id").notNull(),
  tokenDigest: varchar("token_digest", { length: 128 }).notNull(),
  parentTokenDigest: varchar("parent_token_digest", { length: 128 }),
  userAgent: text("user_agent"),
  ip: inet("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  digestUnique: uniqueIndex("refresh_sessions_digest_uq").on(t.tokenDigest),
  userIndex: index("refresh_sessions_user_idx").on(t.userId),
  familyIndex: index("refresh_sessions_family_idx").on(t.familyId)
}));

export const oneTimeTokens = pgTable("one_time_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: varchar("purpose", { length: 32 }).notNull(),
  tokenDigest: varchar("token_digest", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  digestUnique: uniqueIndex("one_time_tokens_digest_uq").on(t.tokenDigest)
}));

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
  indexId: uuid("index_id").references(() => indexes.id, { onDelete: "set null" }),
  externalJobId: varchar("external_job_id", { length: 160 }),
  type: varchar("type", { length: 40 }).notNull(),
  state: jobState("state").notNull().default("queued"),
  phase: varchar("phase", { length: 80 }).notNull().default("queued"),
  progress: jsonb("progress").notNull().$type<Record<string, unknown>>().default({}),
  errorCode: varchar("error_code", { length: 80 }),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
  ...timestamps
}, (t) => ({
  projectStateIndex: index("jobs_project_state_idx").on(t.projectId, t.state),
  sourceStateIndex: index("jobs_source_state_idx").on(t.sourceId, t.state),
  externalUnique: uniqueIndex("jobs_external_job_uq").on(t.externalJobId)
}));

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 120 }).notNull(),
  targetType: varchar("target_type", { length: 80 }),
  targetId: varchar("target_id", { length: 160 }),
  requestId: varchar("request_id", { length: 80 }),
  ip: inet("ip"),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  projectCreatedIndex: index("audit_project_created_idx").on(t.projectId, t.createdAt)
}));

export const searchEvents = pgTable("search_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  indexId: uuid("index_id").references(() => indexes.id, { onDelete: "set null" }),
  query: text("query").notNull(),
  language: varchar("language", { length: 16 }),
  resultCount: integer("result_count").notNull(),
  latencyMs: real("latency_ms").notNull(),
  anonymousUserHash: varchar("anonymous_user_hash", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  projectCreatedIndex: index("search_events_project_created_idx").on(t.projectId, t.createdAt)
}));

export const searchClicks = pgTable("search_clicks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  documentId: varchar("document_id", { length: 200 }).notNull(),
  position: integer("position").notNull(),
  searchEventId: uuid("search_event_id").references(() => searchEvents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  projectCreatedIndex: index("search_clicks_project_created_idx").on(t.projectId, t.createdAt)
}));

export const usageCounters = pgTable("usage_counters", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  period: varchar("period", { length: 16 }).notNull(),
  searches: bigint("searches", { mode: "number" }).notNull().default(0),
  apiRequests: bigint("api_requests", { mode: "number" }).notNull().default(0),
  crawlPages: bigint("crawl_pages", { mode: "number" }).notNull().default(0),
  indexedBytes: bigint("indexed_bytes", { mode: "number" }).notNull().default(0),
  documents: bigint("documents", { mode: "number" }).notNull().default(0)
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.period] })
}));


export const documents = pgTable("documents", {
  indexId: uuid("index_id").notNull().references(() => indexes.id, { onDelete: "cascade" }),
  documentId: varchar("document_id", { length: 200 }).notNull(),
  sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
  body: jsonb("body").notNull().$type<Record<string, unknown>>(),
  contentHash: varchar("content_hash", { length: 128 }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps
}, (t) => ({
  pk: primaryKey({ columns: [t.indexId, t.documentId] }),
  sourceIndex: index("documents_source_idx").on(t.sourceId),
  updatedIndex: index("documents_updated_idx").on(t.indexId, t.updatedAt)
}));

export const synonymSets = pgTable("synonym_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  terms: jsonb("terms").notNull().$type<string[]>(),
  oneWay: boolean("one_way").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  ...timestamps
}, (t) => ({
  projectIndex: index("synonym_sets_project_idx").on(t.projectId)
}));

export const crawlPages = pgTable("crawl_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  sourceId: uuid("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  normalizedUrl: text("normalized_url").notNull(),
  depth: integer("depth").notNull().default(0),
  status: varchar("status", { length: 32 }).notNull(),
  httpStatus: integer("http_status"),
  responseTimeMs: integer("response_time_ms"),
  contentType: varchar("content_type", { length: 160 }),
  canonicalUrl: text("canonical_url"),
  contentHash: varchar("content_hash", { length: 128 }),
  links: jsonb("links").notNull().default([]).$type<string[]>(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  error: text("error"),
  crawledAt: timestamp("crawled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => ({
  jobUrlUnique: uniqueIndex("crawl_pages_job_url_uq").on(t.jobId, t.normalizedUrl),
  sourceStatusIndex: index("crawl_pages_source_status_idx").on(t.sourceId, t.status),
  sourceCreatedIndex: index("crawl_pages_source_created_idx").on(t.sourceId, t.createdAt, t.id)
}));


export const crawlSchedules = pgTable("crawl_schedules", {
  sourceId: uuid("source_id").primaryKey().references(() => sources.id, { onDelete: "cascade" }),
  intervalSeconds: integer("interval_seconds").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  ...timestamps
}, t => ({ dueIndex: index("crawl_schedules_due_idx").on(t.enabled, t.nextRunAt) }));

export const jobOutbox = pgTable("job_outbox", {
  jobId: uuid("job_id").primaryKey().references(() => jobs.id, { onDelete: "cascade" }),
  queue: varchar("queue", { length: 40 }).notNull(),
  name: varchar("name", { length: 80 }).notNull(),
  payload: jsonb("payload").notNull().$type<Record<string, string>>(),
  priority: integer("priority").notNull().default(5),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  ...timestamps
}, t => ({
  pendingIndex: index("job_outbox_pending_idx").on(t.dispatchedAt, t.createdAt),
  recoveryIndex: index("job_outbox_recovery_idx").on(t.updatedAt, t.jobId)
}));
