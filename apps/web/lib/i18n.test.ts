import { describe, expect, it } from "vitest";
import { translate } from "./i18n";

describe("interface localization", () => {
  it("translates core navigation and search controls into Arabic", () => {
    expect(translate("ar", "Search Playground")).toBe("مختبر البحث");
    expect(translate("ar", "Run search")).toBe("تنفيذ البحث");
    expect(translate("ar", "Analytics")).toBe("التحليلات");
  });

  it("localizes the secondary synonym editor and its feedback", () => {
    expect(translate("ar", "Terms (comma separated)")).toBe("المصطلحات (مفصولة بفواصل)");
    expect(translate("ar", "Save synonym set")).toBe("حفظ مجموعة المرادفات");
    expect(translate("ar", "Synonym set saved. New searches use it immediately.")).toContain("حُفظت");
    expect(translate("en", "Save synonym set")).toBe("Save synonym set");
  });

  it("keeps English strings unchanged and safely falls back for untranslated labels", () => {
    expect(translate("en", "Search Playground")).toBe("Search Playground");
    expect(translate("ar", "A newly added label")).toBe("A newly added label");
  });
});
