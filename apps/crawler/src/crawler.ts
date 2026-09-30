import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import picomatch from "picomatch";
import {
  crawlPages,
  documents,
  indexes,
  jobs,
  sources,
  type createDatabase
} from "@searchforge/db";
import { crawlConfigSchema, type CrawlConfig } from "@searchforge/shared";
import type { Queue } from "bullmq";
import type IORedis from "ioredis";
import { extractHtml, hammingDistance, simHash64 } from "./extract.js";
import { safeFetch } from "./fetch.js";
import { RobotsPolicy } from "./robots.js";
import { parseSitemap } from "./sitemap.js";
import { normalizeUrl, sameAllowedDomain } from "./url.js";

type Db = ReturnType<typeof createDatabase>["db"];
type FrontierItem = { url: string; depth: number };

class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try { return await fn(); }
    finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export class CrawlRunner {
  private readonly robots = new Map<string, RobotsPolicy>();
  private readonly domainSemaphores = new Map<string, Semaphore>();
  private readonly lastDomainFetch = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly redis: IORedis,
    private readonly indexQueue: Queue,
    private readonly userAgent: string,
    private readonly allowPrivateNetworks: boolean
  ) {}

  private async progress(jobId: string, phase: string, progress: Record<string, unknown>) {
    await this.db.update(jobs).set({ phase, progress, updatedAt: new Date() }).where(eq(jobs.id, jobId));
    await this.redis.publish(`job:${jobId}`, JSON.stringify({ phase, ...progress }));
  }

  private async robotsFor(url: URL, config: CrawlConfig): Promise<RobotsPolicy> {
    const origin = url.origin;
    const cached = this.robots.get(origin);
    if (cached) return cached;
    if (!config.respectRobots) {
      const policy = RobotsPolicy.parse("User-agent: *\nAllow: /");
      this.robots.set(origin, policy);
      return policy;
    }

    try {
      const response = await safeFetch(new URL("/robots.txt", origin).toString(), {
        userAgent: this.userAgent,
        timeoutMs: config.requestTimeoutMs,
        maxBytes: 1024 * 1024,
        allowPrivateNetworks: this.allowPrivateNetworks
      });
      const policy = response.status >= 200 && response.status < 300
        ? RobotsPolicy.parse(new TextDecoder().decode(response.body))
        : RobotsPolicy.parse("User-agent: *\nAllow: /");
      this.robots.set(origin, policy);
      return policy;
    } catch {
      const policy = RobotsPolicy.parse("User-agent: *\nAllow: /");
      this.robots.set(origin, policy);
      return policy;
    }
  }

  private async obeyDelay(url: URL, config: CrawlConfig, policy: RobotsPolicy) {
    const delayMs = Math.max(0, (policy.crawlDelay(this.userAgent) ?? 0) * 1000);
    if (delayMs === 0) return;
    const previous = this.lastDomainFetch.get(url.hostname) ?? 0;
    const wait = previous + delayMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastDomainFetch.set(url.hostname, Date.now());
  }

  private matchesRules(url: string, config: CrawlConfig): boolean {
    const parsed = new URL(url);
    if (!sameAllowedDomain(url, config.allowedDomains)) return false;
    const pathname = parsed.pathname;
    const included = config.include.length === 0 || config.include.some((pattern) => picomatch(pattern, { dot: true })(pathname));
    const excluded = config.exclude.some((pattern) => picomatch(pattern, { dot: true })(pathname));
    return included && !excluded;
  }

  private async sitemapSeeds(startUrl: string, config: CrawlConfig): Promise<string[]> {
    const origin = new URL(startUrl).origin;
    const policy = await this.robotsFor(new URL(startUrl), config);
    const initial = [...policy.sitemaps, new URL("/sitemap.xml", origin).toString()];
    const pending = [...new Set(initial)];
    const visited = new Set<string>();
    const seeds: string[] = [];

    while (pending.length && visited.size < 100) {
      const sitemapUrl = pending.shift()!;
      if (visited.has(sitemapUrl)) continue;
      visited.add(sitemapUrl);
      try {
        const response = await safeFetch(sitemapUrl, {
          userAgent: this.userAgent,
          timeoutMs: config.requestTimeoutMs,
          maxBytes: 10 * 1024 * 1024,
          allowPrivateNetworks: this.allowPrivateNetworks
        });
        if (response.status < 200 || response.status >= 300) continue;
        const parsed = parseSitemap(
          response.body,
          sitemapUrl.endsWith(".gz") || response.headers.get("content-type")?.includes("gzip") === true
        );
        for (const entry of parsed.urls) if (this.matchesRules(entry.url, config)) seeds.push(entry.url);
        for (const nested of parsed.nested) if (!visited.has(nested)) pending.push(nested);
      } catch {
        // Sitemap failures do not stop ordinary crawling.
      }
    }
    return seeds;
  }

  async run(databaseJobId: string, sourceId: string, projectId: string) {
    const [source] = await this.db.select().from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.projectId, projectId)))
      .limit(1);
    if (!source || source.kind !== "website") throw new Error("Website source not found");
    const config = crawlConfigSchema.parse(source.config);
    if (config.allowedDomains.length === 0) {
      config.allowedDomains = [...new Set(config.startUrls.map((url) => new URL(url).hostname.toLowerCase()))];
    }

    const [targetIndex] = await this.db.select().from(indexes)
      .where(and(eq(indexes.projectId, projectId), eq(indexes.slug, "docs")))
      .limit(1);
    if (!targetIndex) throw new Error("Default docs index not found");

    await this.db.update(jobs).set({ state: "running", phase: "discover", startedAt: new Date() }).where(eq(jobs.id, databaseJobId));
    const sitemapSeeds = (await Promise.all(config.startUrls.map((url) => this.sitemapSeeds(url, config)))).flat();
    const frontier: FrontierItem[] = [...new Set([...config.startUrls, ...sitemapSeeds])].map((url) => ({ url, depth: 0 }));
    const seen = new Set<string>();
    const contentHashes = new Set<string>();
    const nearDuplicates: bigint[] = [];
    let processed = 0;
    let failed = 0;
    let indexed = 0;

    while (frontier.length > 0 && processed < config.maxPages) {
      const batch = frontier.splice(0, Math.min(config.concurrency, config.maxPages - processed));
      await Promise.all(batch.map(async (item) => {
        let normalized: string;
        try {
          normalized = normalizeUrl(item.url);
        } catch {
          return;
        }
        if (seen.has(normalized) || !this.matchesRules(normalized, config)) return;
        seen.add(normalized);
        const url = new URL(normalized);
        const policy = await this.robotsFor(url, config);
        if (config.respectRobots && !policy.allows(url, this.userAgent)) {
          await this.db.insert(crawlPages).values({
            jobId: databaseJobId,
            sourceId,
            url: item.url,
            normalizedUrl: normalized,
            depth: item.depth,
            status: "blocked"
          }).onConflictDoNothing();
          return;
        }

        const semaphore = this.domainSemaphores.get(url.hostname) ?? new Semaphore(config.perDomainConcurrency);
        this.domainSemaphores.set(url.hostname, semaphore);

        await semaphore.run(async () => {
          try {
            await this.obeyDelay(url, config, policy);
            const response = await safeFetch(normalized, {
              userAgent: this.userAgent,
              timeoutMs: config.requestTimeoutMs,
              maxBytes: 5 * 1024 * 1024,
              allowPrivateNetworks: this.allowPrivateNetworks,
              maxRedirects: 5
            });
            processed += 1;
            const contentType = response.headers.get("content-type") ?? "";
            if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
              await this.db.insert(crawlPages).values({
                jobId: databaseJobId,
                sourceId,
                url: item.url,
                normalizedUrl: normalized,
                depth: item.depth,
                status: "skipped",
                httpStatus: response.status,
                responseTimeMs: Math.round(response.elapsedMs),
                contentType
              }).onConflictDoNothing();
              return;
            }

            if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);

            const html = new TextDecoder().decode(response.body);
            const extracted = extractHtml(html, response.url);
            const simhash = simHash64(extracted.content);
            const exactDuplicate = contentHashes.has(extracted.contentHash);
            const nearDuplicate = !exactDuplicate && nearDuplicates.some((value) => hammingDistance(value, simhash) <= 3);

            if (!exactDuplicate && !nearDuplicate) {
              contentHashes.add(extracted.contentHash);
              nearDuplicates.push(simhash);
              const canonical = extracted.canonicalUrl ? normalizeUrl(extracted.canonicalUrl) : normalized;
              const documentId = createHash("sha256").update(canonical).digest("hex").slice(0, 32);
              const document = {
                id: documentId,
                url: canonical,
                title: extracted.title,
                content: extracted.content,
                headings: extracted.headings,
                language: extracted.language ?? "auto",
                metadata: {
                  ...extracted.metadata,
                  description: extracted.description,
                  openGraph: extracted.openGraph,
                  structuredData: extracted.structuredData,
                  sourceId
                }
              };
              await this.db.insert(documents).values({
                indexId: targetIndex.id,
                documentId,
                sourceId,
                body: document,
                contentHash: extracted.contentHash
              }).onConflictDoUpdate({
                target: [documents.indexId, documents.documentId],
                set: {
                  body: document,
                  contentHash: extracted.contentHash,
                  deletedAt: null,
                  updatedAt: new Date()
                }
              });
              indexed += 1;

              if (item.depth < config.maxDepth) {
                for (const link of extracted.links) {
                  try {
                    const candidate = normalizeUrl(link, response.url);
                    if (!seen.has(candidate) && this.matchesRules(candidate, config)) frontier.push({ url: candidate, depth: item.depth + 1 });
                  } catch {
                    // Ignore malformed links.
                  }
                }
              }
            }

            await this.db.insert(crawlPages).values({
              jobId: databaseJobId,
              sourceId,
              url: item.url,
              normalizedUrl: normalized,
              depth: item.depth,
              status: exactDuplicate || nearDuplicate ? "duplicate" : "indexed",
              httpStatus: response.status,
              responseTimeMs: Math.round(response.elapsedMs),
              contentType,
              canonicalUrl: extracted.canonicalUrl,
              contentHash: extracted.contentHash,
              etag: response.headers.get("etag"),
              lastModified: response.headers.get("last-modified"),
              crawledAt: new Date()
            }).onConflictDoNothing();
          } catch (error) {
            failed += 1;
            processed += 1;
            await this.db.insert(crawlPages).values({
              jobId: databaseJobId,
              sourceId,
              url: item.url,
              normalizedUrl: normalized,
              depth: item.depth,
              status: "failed",
              error: error instanceof Error ? error.message.slice(0, 2000) : "Unknown crawl error",
              crawledAt: new Date()
            }).onConflictDoNothing();
          }
        });
      }));

      await this.progress(databaseJobId, "crawl", {
        discovered: seen.size + frontier.length,
        processed,
        failed,
        indexed,
        maxPages: config.maxPages
      });
    }

    await this.db.update(sources).set({ lastCrawledAt: new Date(), updatedAt: new Date() }).where(eq(sources.id, sourceId));
    await this.db.update(jobs).set({
      state: "completed",
      phase: "completed",
      progress: { discovered: seen.size, processed, failed, indexed },
      finishedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(jobs.id, databaseJobId));
    await this.redis.publish(`job:${databaseJobId}`, JSON.stringify({ status: "completed", processed, failed, indexed }));

    const indexJobId = randomUUID();
    const externalJobId = randomUUID();
    await this.db.insert(jobs).values({
      id: indexJobId,
      projectId,
      indexId: targetIndex.id,
      sourceId,
      externalJobId,
      type: "index",
      state: "queued",
      phase: "queued",
      progress: { processed: 0, failed: 0 }
    });
    await this.indexQueue.add("build-index", { databaseJobId: indexJobId, projectId, indexId: targetIndex.id }, { jobId: externalJobId, priority: 4 });
    return { processed, failed, indexed, indexJobId };
  }
}
