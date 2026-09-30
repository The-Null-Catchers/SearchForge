import { describe, expect, it } from "vitest";
import { crawlCursorScope, decodeCrawlCursor, encodeCrawlCursor } from "./crawl-cursor.js";

const id = "3c0afc95-6ebf-45b3-acab-c560d6d7252e";
describe("crawl pagination", () => {
  it("preserves exact timestamps and tie-break IDs", () => {
    const time = new Date("2026-01-01T12:00:00.123Z");
    const scope = crawlCursorScope(id, "indexed", "docs");
    expect(decodeCrawlCursor(encodeCrawlCursor(time, id, scope), scope)).toEqual({ createdAt: time.toISOString(), id });
    const microseconds = "2026-01-01T12:00:00.123456Z";
    expect(decodeCrawlCursor(encodeCrawlCursor(microseconds, id, scope), scope).createdAt).toBe(microseconds);
  });
  it("rejects cross-source, changed-filter and changed-job cursors", () => {
    const scope = crawlCursorScope(id, "indexed", "docs", id);
    const cursor = encodeCrawlCursor(new Date(), id, scope);
    for (const other of [crawlCursorScope("other", "indexed", "docs", id), crawlCursorScope(id, "failed", "docs", id),
      crawlCursorScope(id, "indexed", "other", id), crawlCursorScope(id, "indexed", "docs")]) {
      expect(() => decodeCrawlCursor(cursor, other)).toThrow("Invalid cursor or changed crawl filters");
    }
  });
  it("returns a validation error for malformed or oversized cursors", () => {
    for (const value of ["?", "a".repeat(1001), Buffer.from('{"createdAt":"never","id":1}').toString("base64url")]) {
      expect(() => decodeCrawlCursor(value, "scope")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR", statusCode: 400 }));
    }
  });
});
