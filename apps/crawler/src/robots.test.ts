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

  it("ignores empty rules without merging the following user-agent group", () => {
    const empty = RobotsPolicy.parse("User-agent: *\nDisallow:  # nothing blocked\nUser-agent: OtherBot\nDisallow: /");
    expect(empty.allows(new URL("https://example.com/page"), "SearchForgeBot")).toBe(true);
    expect(empty.allows(new URL("https://example.com/page"), "OtherBot")).toBe(false);
  });

  it.each([
    ["/*.pdf$", "/guide.pdf", false],
    ["/*.pdf$", "/docs/guide.pdf", false],
    ["/*.pdf$", "/guide.pdf.html", true],
    ["/*.pdf$", "/guide.pdf?download=1", true],
    ["/private/*/draft", "/private/team/notes/draft/next", false],
    ["/private/*/draft", "/private//draft", false],
    ["/private/*/draft", "/private/team/final", true],
    ["/only$", "/only", false],
    ["/only$", "/only/more", true],
    ["/only$", "/only?query=1", true],
    ["/a*b*cd$", "/axbycd", false],
    ["/a*b*cd$", "/axbycd/more", true],
    ["/a*b*cd$", "/acd", true],
    ["/literal/a+b[1].txt", "/literal/a+b[1].txt", false],
    ["/literal/a+b[1].txt", "/literal/ab1Xtxt", true],
  ])("matches rule %s against %s", (rule, path, allowed) => {
    const rules = RobotsPolicy.parse(`User-agent: *\nDisallow: ${rule}`);
    expect(rules.allows(new URL(`https://example.com${path}`), "SearchForgeBot")).toBe(allowed);
  });

  it("lets a specific allow rule override a matching wildcard disallow", () => {
    const rules = RobotsPolicy.parse("User-agent: *\nDisallow: /*.pdf$\nAllow: /public/*.pdf$");
    expect(rules.allows(new URL("https://example.com/public/guide.pdf"), "SearchForgeBot")).toBe(true);
    expect(rules.allows(new URL("https://example.com/private/guide.pdf"), "SearchForgeBot")).toBe(false);
  });
});
