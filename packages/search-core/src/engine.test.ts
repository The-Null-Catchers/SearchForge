import { describe, expect, it } from "vitest";
import { indexSettingsSchema, searchRequestSchema } from "@searchforge/shared";
import { SegmentSearchEngine } from "./engine.js";
import { buildSegment } from "./segment.js";

const settings = indexSettingsSchema.parse({
  fieldBoosts: { title: 4, content: 1 },
  typoTolerance: { enabled: true, maxDistance: 2, minTokenLength: 4 }
});

const segment = buildSegment([
  { id: "a", title: "JavaScript search engine", content: "Build fast lexical search and ranking systems.", metadata: { category: "docs" } },
  { id: "b", title: "Building search systems", content: "Distributed systems and information retrieval.", metadata: { category: "blog" } },
  { id: "c", title: "Introduction to databases", content: "Relational database fundamentals.", metadata: { category: "docs" } },
  { id: "ar", title: "محرك بحث عربي", content: "بناء محركات البحث ومعالجة اللغة العربية.", metadata: { category: "docs" } }
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
    expect(result.debug?.matchedPhrases).toContain("distributed system");
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
});
