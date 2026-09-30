type Rule = { allow: boolean; path: string };
type Group = { agents: string[]; rules: Rule[]; crawlDelay?: number };

function stripComment(line: string): string {
  const index = line.indexOf("#");
  return (index >= 0 ? line.slice(0, index) : line).trim();
}

function matchesPath(pathname: string, rule: string): boolean {
  if (!rule) return true;
  const escaped = rule
    .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}`).test(pathname);
}

export class RobotsPolicy {
  constructor(
    private readonly groups: Group[],
    public readonly sitemaps: string[]
  ) {}

  static parse(content: string): RobotsPolicy {
    const groups: Group[] = [];
    const sitemaps: string[] = [];
    let current: Group | undefined;
    let seenRule = false;

    for (const rawLine of content.split(/\r?\n/)) {
      const line = stripComment(rawLine);
      if (!line) continue;
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();

      if (key === "sitemap") {
        if (value) sitemaps.push(value);
        continue;
      }

      if (key === "user-agent") {
        if (!current || seenRule) {
          current = { agents: [], rules: [] };
          groups.push(current);
          seenRule = false;
        }
        current.agents.push(value.toLowerCase());
        continue;
      }

      if (!current) continue;
      if (key === "allow" || key === "disallow") {
        current.rules.push({ allow: key === "allow", path: value });
        seenRule = true;
      } else if (key === "crawl-delay") {
        const delay = Number(value);
        if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
      }
    }
    return new RobotsPolicy(groups, [...new Set(sitemaps)]);
  }

  private matchingGroups(userAgent: string): Group[] {
    const ua = userAgent.toLowerCase();
    let bestLength = -1;
    const matched: Group[] = [];
    for (const group of this.groups) {
      for (const agent of group.agents) {
        if (agent === "*" || ua.includes(agent)) {
          const length = agent === "*" ? 0 : agent.length;
          if (length > bestLength) {
            bestLength = length;
            matched.length = 0;
            matched.push(group);
          } else if (length === bestLength) {
            matched.push(group);
          }
        }
      }
    }
    return matched;
  }

  allows(url: URL, userAgent: string): boolean {
    const path = url.pathname + url.search;
    const matching = this.matchingGroups(userAgent);
    let best: Rule | undefined;
    for (const group of matching) {
      for (const rule of group.rules) {
        if (!matchesPath(path, rule.path)) continue;
        if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
          best = rule;
        }
      }
    }
    return best?.allow ?? true;
  }

  crawlDelay(userAgent: string): number | undefined {
    const delays = this.matchingGroups(userAgent)
      .map((group) => group.crawlDelay)
      .filter((value): value is number => value !== undefined);
    return delays.length ? Math.max(...delays) : undefined;
  }
}
