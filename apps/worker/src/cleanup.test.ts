import { describe, expect, it } from "vitest";
import { cleanupIndexPath, IndexCleanup } from "./cleanup.js";
import type { createDatabase } from "@searchforge/db";
import type { CleanupJobData } from "@searchforge/queue";

describe("cleanup admission", () => {
  it("rejects traversal and non-UUID index paths", () => {
    for (const id of ["../secrets", "/etc", "", "..", "indexes/other", "123", "00000000-0000-0000-0000-000000000000/../other"]) {
      expect(() => cleanupIndexPath("/storage/indexes", id)).toThrow("UUID");
    }
    expect(cleanupIndexPath("/storage/indexes", "00000000-0000-0000-0000-000000000001"))
      .toBe("/storage/indexes/00000000-0000-0000-0000-000000000001");
  });
  it("rejects unsupported targets before database or filesystem work", async () => {
    const cleanup = new IndexCleanup({} as ReturnType<typeof createDatabase>["db"], "/storage");
    for (const targetType of ["source", "project"] as const) {
      await expect(cleanup.run({ targetType } as CleanupJobData)).rejects.toThrow("Unsupported");
    }
  });
  it("rejects malformed job identities before database work", async () => {
    const cleanup = new IndexCleanup({} as ReturnType<typeof createDatabase>["db"], "/storage");
    await expect(cleanup.run({ targetType: "index", targetId: "00000000-0000-0000-0000-000000000001",
      projectId: "../project", databaseJobId: "bad" })).rejects.toThrow("identity");
  });
});
