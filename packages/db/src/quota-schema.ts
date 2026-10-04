import { bigint, integer, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { projects } from "./schema.js";

export const projectQuotas = pgTable("project_quotas", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  monthlySearches: bigint("monthly_searches", { mode: "number" }),
  monthlyApiRequests: bigint("monthly_api_requests", { mode: "number" }),
  monthlyCrawlPages: bigint("monthly_crawl_pages", { mode: "number" }),
  maxDocuments: bigint("max_documents", { mode: "number" }),
  warningPercent: integer("warning_percent").notNull().default(80),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
