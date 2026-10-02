import { describe, expect, it } from "vitest";
import { buildDeletionDictionary, deletionVariants } from "./distance.js";

describe("typo deletion dictionary", () => {
  it("generates bounded unique deletion variants", () => {
    const variants = deletionVariants("search", 2);
    expect(new Set(variants).size).toBe(variants.length);
    expect(variants).toContain("search");
    expect(variants).toContain("searc");
    expect(variants).toContain("sear");
    expect(variants.every((value) => value.length >= 4)).toBe(true);
  });

  it("maps missing-character query forms directly to indexed terms", () => {
    const dictionary = buildDeletionDictionary(["algorithm", "javascript", "search"], 2);
    expect(dictionary.algoritm).toContain("algorithm");
    expect(dictionary.javscript).toContain("javascript");
    expect(dictionary.search).toContain("search");
  });
});
