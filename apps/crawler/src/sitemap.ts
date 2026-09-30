import { gunzipSync } from "node:zlib";
import { XMLParser } from "fast-xml-parser";

export type SitemapEntry = {
  url: string;
  lastmod?: string;
  priority?: number;
};

export type ParsedSitemap = {
  urls: SitemapEntry[];
  nested: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true
});

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseSitemap(body: Uint8Array, gzipped = false): ParsedSitemap {
  const bytes = gzipped ? gunzipSync(body) : Buffer.from(body);
  const xml = bytes.toString("utf8");
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const urls: SitemapEntry[] = [];
  const nested: string[] = [];

  const urlset = parsed.urlset as { url?: Array<Record<string, unknown>> | Record<string, unknown> } | undefined;
  for (const entry of arrayify(urlset?.url)) {
    if (typeof entry.loc !== "string") continue;
    urls.push({
      url: entry.loc,
      ...(typeof entry.lastmod === "string" ? { lastmod: entry.lastmod } : {}),
      ...(entry.priority !== undefined && Number.isFinite(Number(entry.priority)) ? { priority: Number(entry.priority) } : {})
    });
  }

  const index = parsed.sitemapindex as { sitemap?: Array<Record<string, unknown>> | Record<string, unknown> } | undefined;
  for (const entry of arrayify(index?.sitemap)) {
    if (typeof entry.loc === "string") nested.push(entry.loc);
  }

  return { urls, nested };
}
