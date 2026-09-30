import type { IndexSettings } from "@searchforge/shared";
import { SegmentSearchEngine } from "./engine.js";
import { buildSegment, type FileSegmentStore, validateSegment } from "./segment.js";
import type { SearchDocument, Segment } from "./types.js";

type VersionState = "building" | "ready" | "active" | "retired" | "failed";

type VersionRecord = {
  segment: Segment;
  state: VersionState;
};

export class IndexRegistry {
  private readonly versions = new Map<string, Map<string, VersionRecord>>();
  private readonly activeVersions = new Map<string, string>();

  constructor(private readonly store?: FileSegmentStore) {}

  async build(
    indexId: string,
    documents: SearchDocument[],
    settings: IndexSettings,
    version: string,
    searchableFields?: string[]
  ): Promise<Segment> {
    const segment = buildSegment(documents, settings, { version, ...(searchableFields ? { searchableFields } : {}) });
    validateSegment(segment);
    if (this.store) await this.store.write(indexId, segment);
    const map = this.versions.get(indexId) ?? new Map<string, VersionRecord>();
    map.set(version, { segment, state: "ready" });
    this.versions.set(indexId, map);
    return segment;
  }

  activate(indexId: string, version: string): void {
    const map = this.versions.get(indexId);
    const next = map?.get(version);
    if (!next || next.state !== "ready") throw new Error("Index version is not ready for activation");

    const currentVersion = this.activeVersions.get(indexId);
    if (currentVersion) {
      const current = map?.get(currentVersion);
      if (current) current.state = "retired";
    }
    next.state = "active";
    this.activeVersions.set(indexId, version);
  }

  rollback(indexId: string, version: string): void {
    const map = this.versions.get(indexId);
    const target = map?.get(version);
    if (!target || !["retired", "ready"].includes(target.state)) throw new Error("Rollback target is unavailable");

    const currentVersion = this.activeVersions.get(indexId);
    if (currentVersion) {
      const current = map?.get(currentVersion);
      if (current) current.state = "retired";
    }
    target.state = "active";
    this.activeVersions.set(indexId, version);
  }

  getActive(indexId: string): SegmentSearchEngine {
    const active = this.activeVersions.get(indexId);
    const record = active ? this.versions.get(indexId)?.get(active) : undefined;
    if (!record || record.state !== "active") throw new Error("Index has no active version");
    return new SegmentSearchEngine(record.segment);
  }

  list(indexId: string): Array<{ version: string; state: VersionState; documentCount: number; checksum?: string }> {
    return [...(this.versions.get(indexId)?.entries() ?? [])]
      .map(([version, record]) => ({
        version,
        state: record.state,
        documentCount: record.segment.documentCount,
        ...(record.segment.checksum ? { checksum: record.segment.checksum } : {})
      }))
      .sort((a, b) => b.version.localeCompare(a.version));
  }
}
