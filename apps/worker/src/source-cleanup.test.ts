import { describe, expect, it } from "vitest";
import { obsoleteSegmentFile, SourceCleanup } from "./source-cleanup.js";
import type { createDatabase } from "@searchforge/db";
import type { CleanupJobData } from "@searchforge/queue";

describe("source segment purge", () => {
  it("purges old published and temporary files while preserving the safe version", () => {
    expect(obsoleteSegmentFile("1.segment.json", 3)).toBe(true);
    expect(obsoleteSegmentFile("2.segment.json.tmp-aaaaaaaa-bbbb-cccc", 3)).toBe(true);
    for (const name of ["3.segment.json", "4.segment.json", "notes.json", "../1.segment.json", "1.segment.json/other", "NaN.segment.json", "9007199254740993.segment.json"]) {
      expect(obsoleteSegmentFile(name, 3)).toBe(false);
    }
  });
  it("rejects malformed identities and unsupported targets before side effects", async () => {
    const cleanup = new SourceCleanup({} as ReturnType<typeof createDatabase>["db"], "/storage");
    await expect(cleanup.run({ targetType: "project" } as CleanupJobData)).rejects.toThrow("Unsupported");
    await expect(cleanup.run({ targetType: "source", targetId: "../source", projectId: "bad", databaseJobId: "bad" })).rejects.toThrow("identity");
  });
});
