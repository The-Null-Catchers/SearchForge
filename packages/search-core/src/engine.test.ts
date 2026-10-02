import { describe, expect, it } from "vitest";
import { indexSettingsSchema, searchRequestSchema } from "@searchforge/shared";
import { SegmentSearchEngine } from "./engine.js";
import { buildSegment } from "./segment.js";

const settings = indexSettingsSchema.parse({
  fieldBoosts: { title: 4, content: 1 },
  typoTolerance: { enabled: true, maxDistance: 2, minTokenLength: 4 }
});

const segment = buildSegment([
  { id: "a", title: "JavaScript search engine", content: "Build fast lexical search and ranking systems.", publishedAt: "2026-08-01T10:00:00Z", metadata: { category: "docs" } },
  { id: "b", title: "Building search systems", content: "Distributed systems and information retrieval.", publishedAt: "2025-12-15T10:00:00Z", metadata: { category: "blog" } },
  { id: "c", title: "Introduction to databases", content: "Relational database fundamentals.", publishedAt: "2026-02-10T10:00:00Z", metadata: { category: "docs" } },
  { id: "ar", title: "مُحَرِّك بحث عربي", content: "بناء محركات البحث ومعالجة اللغة العربية.", publishedAt: "2026-09-01T10:00:00Z", metadata: { category: "docs" } }
], settings, { version: "v1", searchableFields: ["title", "content"] });

const engine = new SegmentSearchEngine(segment);

describe("SegmentSearchEngine", () => {
  it("ranks a title match above unrelated content", () => {
    const result = engine.search(searchRequestSchema.parse({ query: "javascript search", limit: 10 }));
    expect(result.hits[0]?.id).toBe("a");
    expect(result.hits.some((hit) => hit.id === "c")).toBe(false);
  });

  it("verifies quoted phrases using positions", () => {
    const result = engine.search(searchRequestSchema.parse({ query: '"distributed systems"', debug: true }));
    expect(result.hits[0]?.id).toBe("b");
    expect(result.debug?.matchedPhrases).toContain("distribut system");
  });

  it("uses bounded typo candidates", () => {
    const result = engine.search(searchRequestSchema.parse({ query: "javscript", typoTolerance: true }));
    expect(result.hits[0]?.id).toBe("a");
  });

  it("searches normalized Arabic", () => {
    const result = engine.search(searchRequestSchema.parse({ query: "مُحَرِّكات البحث" }));
    expect(result.hits.some((hit) => hit.id === "ar")).toBe(true);
  });

  it("returns facet counts", () => {
    const result = engine.search(searchRequestSchema.parse({ query: "search", facets: ["metadata.category"] }));
    expect(result.facets["metadata.category"]).toBeDefined();
  });

  it("supports nested AND/OR filters with ISO date comparisons", () => {
    const request = searchRequestSchema.parse({
      query: "",
      filters: {
        and: [
          { "metadata.category": "docs" },
          {
            or: [
              { publishedAt: { op: "gte", value: "2026-07-01T00:00:00Z" } },
              { id: "c" }
            ]
          }
        ]
      }
    });
    const result = engine.search(request);
    expect(result.hits.map((hit) => hit.id).sort()).toEqual(["a", "ar", "c"]);
  });

  it("supports date ranges", () => {
    const result = engine.search(searchRequestSchema.parse({
      query: "",
      filters: {
        publishedAt: {
          op: "range",
          value: { min: "2026-01-01T00:00:00Z", max: "2026-06-01T00:00:00Z" }
        }
      }
    }));
    expect(result.hits.map((hit) => hit.id)).toEqual(["c"]);
  });

  it("binds cursors to the original search request", () => {
    const first = engine.search(searchRequestSchema.parse({ query: "search", limit: 1 }));
    expect(first.nextCursor).toBeDefined();
    expect(() => engine.search(searchRequestSchema.parse({
      query: "database",
      limit: 1,
      cursor: first.nextCursor
    }))).toThrow("different search request");
  });

  it("highlights analyzer-normalized Arabic surface ranges", () => {
    const result = engine.search(searchRequestSchema.parse({ query: "محرك" }));
    const hit = result.hits.find((entry) => entry.id === "ar");
    const titleHighlight = hit?.highlights.find((entry) => entry.field === "title");
    expect(titleHighlight).toBeDefined();
    expect(hit?.document.title?.slice(titleHighlight!.start, titleHighlight!.end)).toBe("مُحَرِّك");
  });

  it("highlights typo-expanded terms using indexed analyzer tokens", () => {
    const result = engine.search(searchRequestSchema.parse({ query: "javscript", typoTolerance: true }));
    const hit = result.hits.find((entry) => entry.id === "a");
    const titleHighlight = hit?.highlights.find((entry) => entry.field === "title");
    expect(titleHighlight).toBeDefined();
    expect(hit?.document.title?.slice(titleHighlight!.start, titleHighlight!.end)).toBe("JavaScript");
  });
});
