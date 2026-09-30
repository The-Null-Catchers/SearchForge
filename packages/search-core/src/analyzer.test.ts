import { describe, expect, it } from "vitest";
import { indexSettingsSchema } from "@searchforge/shared";
import { Analyzer, normalizeArabic } from "./analyzer.js";

const settings = indexSettingsSchema.parse({});

describe("Arabic analyzer", () => {
  it("normalizes Alef variants, Ya and diacritics", () => {
    expect(normalizeArabic("إِختِبار آلِيّ على", settings.arabic)).toBe("اختبار الي علي");
  });

  it("keeps taa marbuta by default", () => {
    expect(normalizeArabic("مدرسة", settings.arabic)).toBe("مدرسة");
  });

  it("supports mixed Arabic and English tokenization", () => {
    const analyzer = new Analyzer(settings);
    const terms = analyzer.analyze("Search محركات البحث JavaScript").map((token) => token.term);
    expect(terms).toContain("search");
    expect(terms.some((term) => term.includes("محرك"))).toBe(true);
    expect(terms).toContain("javascript");
  });
});
