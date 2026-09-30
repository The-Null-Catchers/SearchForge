import { describe, expect, it } from "vitest";
import { RobotsPolicy } from "./robots.js";

describe("robots.txt", () => {
  const policy = RobotsPolicy.parse(`
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 2
Sitemap: https://example.com/sitemap.xml

User-agent: SearchForgeBot
Disallow: /bot-only
  `);

  it("uses the most specific matching user-agent group", () => {
    expect(policy.allows(new URL("https://example.com/bot-only"), "SearchForgeBot/1.0")).toBe(false);
    expect(policy.allows(new URL("https://example.com/private"), "SearchForgeBot/1.0")).toBe(true);
  });

  it("discovers sitemap URLs", () => {
    expect(policy.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
  });
});
