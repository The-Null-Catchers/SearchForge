import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { indexSettingsSchema } from "@searchforge/shared";
import { buildSegment, FileSegmentStore } from "./segment.js";

const settings = indexSettingsSchema.parse({});
describe("immutable segment publication", () => {
  it("round-trips a segment and refuses to overwrite an existing version", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-segment-"));
    try {
      const store = new FileSegmentStore(root);
      const first = buildSegment([{ id: "a", title: "البحث search" }], settings, { version: "17" });
      await store.write("index", first);
      const stored = await store.read("index", "17");
      expect(stored.checksum).toBe(first.checksum);
      expect(stored.typoDeletes?.search).toContain("search");
      const replacement = buildSegment([{ id: "b" }], settings, { version: "17" });
      await expect(store.write("index", replacement)).rejects.toThrow();
      expect((await store.read("index", "17")).documents.a).toBeDefined();
      await expect(store.read("../escape", "17")).rejects.toThrow("Invalid index storage identifier");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("detects corruption instead of returning unverified postings", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-corrupt-"));
    try {
      const store = new FileSegmentStore(root);
      const segment = buildSegment([{ id: "a", title: "search" }], settings, { version: "18" });
      const path = await store.write("index", segment);
      await writeFile(path, JSON.stringify({ ...segment, documentCount: 99 }));
      await expect(store.read("index", "18")).rejects.toThrow("checksum");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
