import { crawlConfigSchema, type CrawlConfig } from "@searchforge/shared";
const lines = (value: FormDataEntryValue | null) => String(value ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
export function readCrawlForm(fields: FormData, previous: CrawlConfig) {
  return crawlConfigSchema.parse({ ...previous, startUrls: lines(fields.get("startUrls")), include: lines(fields.get("include")),
    exclude: lines(fields.get("exclude")), allowedDomains: lines(fields.get("allowedDomains")),
    maxDepth: Number(fields.get("maxDepth")), maxPages: Number(fields.get("maxPages")),
    concurrency: Number(fields.get("concurrency")), perDomainConcurrency: Number(fields.get("perDomainConcurrency")),
    requestTimeoutMs: Number(fields.get("requestTimeoutMs")),
    retryMaxAttempts: Number(fields.get("retryMaxAttempts") ?? previous.retryMaxAttempts ?? 3),
    retryBaseDelayMs: Number(fields.get("retryBaseDelayMs") ?? previous.retryBaseDelayMs ?? 500),
    retryMaxDelayMs: Number(fields.get("retryMaxDelayMs") ?? previous.retryMaxDelayMs ?? 30000), respectRobots: true });
}
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
