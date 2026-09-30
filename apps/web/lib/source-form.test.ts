import { describe, expect, it } from "vitest";
import { crawlConfigSchema } from "@searchforge/shared";
import { readCrawlForm, safeExternalUrl } from "./source-form";

function fields() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ startUrls: "https://docs.example.com\n https://example.com/help ", include: "/docs/**\n /help/**",
    exclude: "/admin/**", allowedDomains: "docs.example.com", maxDepth: "0", maxPages: "250", concurrency: "4", perDomainConcurrency: "2", requestTimeoutMs: "15000" })) data.set(key, value);
  return data;
}
describe("crawl form safety", () => {
  it("preserves zero depth and parses multiline rules", () => {
    const config = readCrawlForm(fields(), crawlConfigSchema.parse({ startUrls: ["https://example.com"] }));
    expect(config.maxDepth).toBe(0);
    expect(config.startUrls).toEqual(["https://docs.example.com", "https://example.com/help"]);
    expect(config.include).toEqual(["/docs/**", "/help/**"]);
    expect(config.respectRobots).toBe(true);
  });
  it("rejects forbidden protocols, URL credentials and invalid concurrency", () => {
    const previous = crawlConfigSchema.parse({ startUrls: ["https://example.com"] });
    for (const url of ["file:///etc/passwd", "ftp://example.com", "https://user:password@example.com", "invalid"]) {
      const data = fields(); data.set("startUrls", url);
      expect(() => readCrawlForm(data, previous)).toThrow();
    }
    const data = fields(); data.set("concurrency", "1000");
    expect(() => readCrawlForm(data, previous)).toThrow();
  });
  it("prevents disabling robots or unbounded rule lists", () => {
    expect(crawlConfigSchema.safeParse({ startUrls: ["https://example.com"], respectRobots: false }).success).toBe(false);
    expect(crawlConfigSchema.safeParse({ startUrls: ["https://example.com"], exclude: Array(101).fill("/private/**") }).success).toBe(false);
  });
  it("does not render dangerous or credential-bearing external links", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,test", "https://secret@example.com", "/relative", null]) expect(safeExternalUrl(url)).toBeNull();
    expect(safeExternalUrl("https://example.com/docs")).toBe("https://example.com/docs");
  });
});
