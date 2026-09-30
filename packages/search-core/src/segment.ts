import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, link, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IndexSettings } from "@searchforge/shared";
import { Analyzer } from "./analyzer.js";
import type { BuildOptions, SearchDocument, Segment, TermPostings } from "./types.js";

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(" ");
  return "";
}

export function buildSegment(
  documents: SearchDocument[],
  settings: IndexSettings,
  options: BuildOptions
): Segment {
  const searchableFields = options.searchableFields ?? ["title", "headings", "content", "url", "tags"];
  const analyzer = new Analyzer(settings);
  const postings = new Map<string, Map<string, TermPostings>>();
  const documentLengths: Record<string, Record<string, number>> = {};
  const fieldTotals = new Map<string, number>();
  const docs: Record<string, SearchDocument> = {};
  const vocabulary = new Set<string>();

  for (const document of documents) {
    if (!document.id) throw new Error("Every search document requires a non-empty id");
    if (docs[document.id]) throw new Error(`Duplicate document id: ${document.id}`);
    docs[document.id] = structuredClone(document);
    documentLengths[document.id] = {};

    for (const field of searchableFields) {
      const text = asText(document[field]);
      if (!text) continue;
      const tokens = analyzer.analyze(text);
      documentLengths[document.id]![field] = tokens.length;
      fieldTotals.set(field, (fieldTotals.get(field) ?? 0) + tokens.length);

      const positionsByTerm = new Map<string, number[]>();
      for (const token of tokens) {
        vocabulary.add(token.term);
        const positions = positionsByTerm.get(token.term) ?? [];
        positions.push(token.position);
        positionsByTerm.set(token.term, positions);
      }

      let fieldIndex = postings.get(field);
      if (!fieldIndex) {
        fieldIndex = new Map();
        postings.set(field, fieldIndex);
      }

      for (const [term, positions] of positionsByTerm) {
        const termPostings = fieldIndex.get(term) ?? { documentFrequency: 0, postings: [] };
        termPostings.documentFrequency += 1;
        termPostings.postings.push({
          documentId: document.id,
          termFrequency: positions.length,
          positions
        });
        fieldIndex.set(term, termPostings);
      }
    }
  }

  const serializedPostings: Segment["postings"] = {};
  for (const [field, terms] of postings) {
    serializedPostings[field] = Object.fromEntries(terms);
  }

  const averageFieldLength: Record<string, number> = {};
  for (const [field, total] of fieldTotals) {
    averageFieldLength[field] = documents.length === 0 ? 0 : total / documents.length;
  }

  const segment: Segment = {
    id: randomUUID(),
    version: options.version,
    createdAt: new Date().toISOString(),
    documentCount: documents.length,
    settings,
    documents: docs,
    postings: serializedPostings,
    documentLengths,
    averageFieldLength,
    vocabulary: [...vocabulary].sort()
  };
  segment.checksum = checksumSegment(segment);
  return segment;
}

export function checksumSegment(segment: Segment): string {
  const clone = { ...segment, checksum: undefined };
  return createHash("sha256").update(JSON.stringify(clone)).digest("hex");
}

export function validateSegment(segment: Segment): void {
  const expected = segment.checksum;
  if (!expected) throw new Error("Segment checksum is missing");
  const actual = checksumSegment(segment);
  if (actual !== expected) throw new Error("Segment checksum validation failed");
  if (segment.documentCount !== Object.keys(segment.documents).length) {
    throw new Error("Segment document count does not match manifest");
  }
}

export class FileSegmentStore {
  constructor(private readonly root: string) {}

  private file(indexId: string, version: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(indexId) || !/^[A-Za-z0-9_-]+$/.test(version)) {
      throw new Error("Invalid index storage identifier");
    }
    return join(this.root, indexId, `${version}.segment.json`);
  }

  async write(indexId: string, segment: Segment): Promise<string> {
    validateSegment(segment);
    const target = this.file(indexId, segment.version);
    const temp = `${target}.tmp-${randomUUID()}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temp, JSON.stringify(segment), { encoding: "utf8", flag: "wx" });
    try {
      // Atomic exclusive publication: an existing immutable version is never replaced.
      await link(temp, target);
    } finally {
      await unlink(temp);
    }
    return target;
  }

  async read(indexId: string, version: string): Promise<Segment> {
    const content = await readFile(this.file(indexId, version), "utf8");
    const segment = JSON.parse(content) as Segment;
    validateSegment(segment);
    return segment;
  }
}
