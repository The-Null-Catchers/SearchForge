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

  it("localizes developer logs and filter states", () => {
    expect(translate("ar", "Developer logs")).toBe("سجلات المطورين");
    expect(translate("ar", "No matching events.")).toBe("لا توجد أحداث مطابقة.");
    expect(translate("ar", "Retry")).toBe("إعادة المحاولة");
    expect(translate("en", "Developer logs")).toBe("Developer logs");
  });

  it("localizes ranking configuration and rebuild states", () => {
    expect(translate("ar", "Ranking configuration")).toBe("إعدادات ترتيب النتائج");
    expect(translate("ar", "Save ranking & rebuild index")).toBe("حفظ الترتيب وإعادة بناء الفهرس");
    expect(translate("ar", "Failed to save ranking settings")).toBe("تعذّر حفظ إعدادات الترتيب");
    expect(translate("en", "Ranking configuration")).toBe("Ranking configuration");
  });

  it("localizes quota management and threshold statuses", () => {
    expect(translate("ar", "Quota notifications")).toBe("إشعارات حدود الاستخدام");
    expect(translate("ar", "Monthly API requests")).toBe("طلبات API الشهرية");
    expect(translate("ar", "exceeded")).toBe("تم تجاوز الحد");
    expect(translate("ar", "Select a project to view usage.")).toBe("اختر مشروعًا لعرض الاستخدام.");
    expect(translate("en", "Save quota policy")).toBe("Save quota policy");
    expect(translate("ar", "Usage")).toBe("الاستخدام");
    expect(translate("ar", "Maximum documents")).toBe("الحد الأقصى للمستندات");
    expect(translate("ar", "Loading usage…")).toBe("جارٍ تحميل بيانات الاستخدام…");
  });

  it("keeps English strings unchanged and safely falls back for untranslated labels", () => {
    expect(translate("en", "Search Playground")).toBe("Search Playground");
    expect(translate("ar", "A newly added label")).toBe("A newly added label");
  });
});
