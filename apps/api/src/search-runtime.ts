import { FileSegmentStore, SegmentSearchEngine, type Segment } from "@searchforge/search-core";

export class SearchRuntime {
  private readonly store: FileSegmentStore;
  private readonly cache = new Map<string, Segment>();

  constructor(root: string) {
    this.store = new FileSegmentStore(root);
  }

  async segment(indexId: string, version: string, checksum?: string | null): Promise<Segment> {
    const key = `${indexId}:${version}:${checksum ?? "unknown"}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const segment = await this.store.read(indexId, version);
    if (checksum && checksum !== segment.checksum) throw new Error("Index manifest checksum mismatch");
    this.cache.set(key, segment);
    if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value as string);
    return segment;
  }

  async engine(
    indexId: string,
    version: string,
    checksum: string | null | undefined,
    synonyms: Array<{ terms: string[]; oneWay?: boolean }>
  ): Promise<SegmentSearchEngine> {
    return new SegmentSearchEngine(await this.segment(indexId, version, checksum), synonyms);
  }
}
