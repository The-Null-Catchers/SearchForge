import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

export type ExtractedPage = {
  title: string;
  description?: string;
  headings: string[];
  content: string;
  canonicalUrl?: string;
  language?: string;
  metadata: Record<string, unknown>;
  openGraph: Record<string, string>;
  structuredData: unknown[];
  links: string[];
  contentHash: string;
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function extractHtml(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);
  const structuredData: unknown[] = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    try {
      structuredData.push(JSON.parse($(element).text()));
    } catch {
      // Malformed third-party JSON-LD is intentionally ignored.
    }
  });

  $("script,style,noscript,nav,footer,header,aside,form,iframe,canvas,svg").remove();
  $("[hidden],[aria-hidden='true']").remove();
  $("[style*='display:none'],[style*='display: none'],[style*='visibility:hidden'],[style*='visibility: hidden']").remove();

  const title = cleanText($("title").first().text() || $("h1").first().text());
  const description = $('meta[name="description"]').attr("content");
  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonicalUrl = canonicalHref ? new URL(canonicalHref, pageUrl).toString() : undefined;
  const language = $("html").attr("lang")?.split("-")[0]?.toLowerCase();
  const headings = $("h1,h2,h3").map((_index, element) => cleanText($(element).text())).get().filter(Boolean);
  const root = $("main").first().length ? $("main").first() : $("article").first().length ? $("article").first() : $("body").first();
  const content = cleanText(root.text());

  const openGraph: Record<string, string> = {};
  $("meta[property^='og:']").each((_index, element) => {
    const property = $(element).attr("property");
    const value = $(element).attr("content");
    if (property && value) openGraph[property] = value;
  });

  const links = new Set<string>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") links.add(url.toString());
    } catch {
      // Invalid links are not crawl candidates.
    }
  });

  const metadata: Record<string, unknown> = {};
  $("meta[name]").each((_index, element) => {
    const name = $(element).attr("name");
    const value = $(element).attr("content");
    if (name && value && name.toLowerCase() !== "description") metadata[name] = value;
  });

  return {
    title,
    ...(description ? { description: cleanText(description) } : {}),
    headings,
    content,
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(language ? { language } : {}),
    metadata,
    openGraph,
    structuredData,
    links: [...links],
    contentHash: createHash("sha256").update(content).digest("hex")
  };
}

export function simHash64(text: string): bigint {
  const vector = new Array<number>(64).fill(0);
  const tokens = text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const token of tokens) {
    const digest = createHash("sha256").update(token).digest();
    for (let bit = 0; bit < 64; bit += 1) {
      const set = (digest[Math.floor(bit / 8)]! & (1 << (bit % 8))) !== 0;
      vector[bit] = vector[bit]! + (set ? 1 : -1);
    }
  }
  let value = 0n;
  for (let bit = 0; bit < 64; bit += 1) if (vector[bit]! >= 0) value |= 1n << BigInt(bit);
  return value;
}

export function hammingDistance(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}
