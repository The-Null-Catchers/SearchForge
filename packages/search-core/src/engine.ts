import { createHash } from "node:crypto";
import type { SearchRequest } from "@searchforge/shared";
import { Analyzer } from "./analyzer.js";
import { damerauLevenshtein, lowerBound } from "./distance.js";
import type { CoreSearchResponse, SearchCore, SearchDocument, Segment, TermPostings } from "./types.js";

type ParsedQuery = {
  phrases: string[][];
  terms: string[];
};

type SynonymMap = Map<string, Set<string>>;

function parseQuery(query: string, analyzer: Analyzer): ParsedQuery {
  const phrases: string[][] = [];
  const remainder = query.replace(/"([^"]+)"/g, (_match, phrase: string) => {
    const analyzed = analyzer.analyzeQueryTerm(phrase);
    if (analyzed.length > 0) phrases.push(analyzed);
    return " ";
  });
  return {
    phrases,
    terms: analyzer.analyzeQueryTerm(remainder)
  };
}

function positionsContainPhrase(positionLists: number[][]): boolean {
  if (positionLists.length === 0) return false;
  const first = new Set(positionLists[0]);
  for (const start of first) {
    let ok = true;
    for (let offset = 1; offset < positionLists.length; offset += 1) {
      if (!positionLists[offset]!.includes(start + offset)) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function comparablePair(left: unknown, right: unknown): [number, number] | undefined {
  if (typeof left === "number" && typeof right === "number") return [left, right];
  if (typeof left === "string" && typeof right === "string") {
    const leftDate = Date.parse(left);
    const rightDate = Date.parse(right);
    if (Number.isFinite(leftDate) && Number.isFinite(rightDate)) return [leftDate, rightDate];
  }
  return undefined;
}

function comparePrimitive(left: unknown, op: string, right: unknown): boolean {
  if (op === "eq") return left === right || (Array.isArray(left) && left.includes(right));
  if (op === "neq") return !(left === right || (Array.isArray(left) && left.includes(right)));
  if (op === "in") return Array.isArray(right) && right.some((value) => value === left || (Array.isArray(left) && left.includes(value)));

  const pair = comparablePair(left, right);
  if (!pair) return false;
  const [leftValue, rightValue] = pair;
  if (op === "gt") return leftValue > rightValue;
  if (op === "gte") return leftValue >= rightValue;
  if (op === "lt") return leftValue < rightValue;
  if (op === "lte") return leftValue <= rightValue;
  return false;
}

function getField(document: SearchDocument, path: string): unknown {
  const parts = path.split(".");
  let value: unknown = document;
  for (const part of parts) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function matchesFlatFilters(document: SearchDocument, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([field, filter]) => {
    const value = getField(document, field);
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
      return value === filter || (Array.isArray(value) && value.includes(filter));
    }

    const condition = filter as { op?: string; value?: unknown };
    if (!condition.op) return false;
    if (condition.op === "range") {
      if (!condition.value || typeof condition.value !== "object" || Array.isArray(condition.value)) return false;
      const range = condition.value as { min?: unknown; max?: unknown };
      if (range.min !== undefined) {
        const pair = comparablePair(value, range.min);
        if (!pair || pair[0] < pair[1]) return false;
      }
      if (range.max !== undefined) {
        const pair = comparablePair(value, range.max);
        if (!pair || pair[0] > pair[1]) return false;
      }
      return true;
    }

    return comparePrimitive(value, condition.op, condition.value);
  });
}

function matchesFilters(document: SearchDocument, filters: SearchRequest["filters"]): boolean {
  if (!filters) return true;
  if ("and" in filters && Array.isArray(filters.and)) {
    return filters.and.every((entry) => matchesFilters(document, entry));
  }
  if ("or" in filters && Array.isArray(filters.or)) {
    return filters.or.some((entry) => matchesFilters(document, entry));
  }
  return matchesFlatFilters(document, filters as Record<string, unknown>);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestFingerprint(request: SearchRequest): string {
  const semanticRequest = {
    query: request.query,
    filters: request.filters ?? null,
    facets: [...(request.facets ?? [])].sort(),
    sort: request.sort ?? null,
    typoTolerance: request.typoTolerance ?? true
  };
  return createHash("sha256").update(stableSerialize(semanticRequest)).digest("base64url").slice(0, 24);
}

function encodeCursor(version: string, offset: number, queryFingerprint: string): string {
  return Buffer.from(JSON.stringify({ version, offset, queryFingerprint })).toString("base64url");
}

function decodeCursor(cursor: string): { version: string; offset: number; queryFingerprint: string } {
  const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
    version?: unknown;
    offset?: unknown;
    queryFingerprint?: unknown;
  };
  if (
    typeof parsed.version !== "string"
    || typeof parsed.offset !== "number"
    || !Number.isInteger(parsed.offset)
    || parsed.offset < 0
    || typeof parsed.queryFingerprint !== "string"
  ) {
    throw new Error("Invalid cursor");
  }
  return {
    version: parsed.version,
    offset: parsed.offset,
    queryFingerprint: parsed.queryFingerprint
  };
}

function highlightRanges(
  document: SearchDocument,
  terms: string[],
  analyzer: Analyzer
): Array<{ field: string; start: number; end: number; term: string }> {
  const output: Array<{ field: string; start: number; end: number; term: string }> = [];
  const wanted = new Set(terms);

  for (const field of ["title", "content"]) {
    const value = document[field];
    if (typeof value !== "string") continue;
    for (const token of analyzer.analyzeWithOffsets(value)) {
      if (!wanted.has(token.term)) continue;
      output.push({ field, start: token.start, end: token.end, term: token.term });
      if (output.length >= 12) return output;
    }
  }

  return output;
}

export class SegmentSearchEngine implements SearchCore {
  private readonly analyzer: Analyzer;
  private readonly synonyms: SynonymMap;

  constructor(
    private readonly segment: Segment,
    synonyms: Array<{ terms: string[]; oneWay?: boolean }> = []
  ) {
    this.analyzer = new Analyzer(segment.settings);
    this.synonyms = this.buildSynonyms(synonyms);
  }

  private buildSynonyms(groups: Array<{ terms: string[]; oneWay?: boolean }>): SynonymMap {
    const map: SynonymMap = new Map();
    for (const group of groups) {
      const normalized = group.terms.flatMap((term) => this.analyzer.analyzeQueryTerm(term));
      if (normalized.length < 2) continue;
      if (group.oneWay) {
        map.set(normalized[0]!, new Set(normalized.slice(1)));
      } else {
        for (const term of normalized) {
          const set = map.get(term) ?? new Set<string>();
          for (const other of normalized) if (other !== term) set.add(other);
          map.set(term, set);
        }
      }
    }
    return map;
  }

  private prefixCandidates(term: string, limit = 32): string[] {
    const start = lowerBound(this.segment.vocabulary, term);
    const out: string[] = [];
    for (let index = start; index < this.segment.vocabulary.length && out.length < limit; index += 1) {
      const value = this.segment.vocabulary[index]!;
      if (!value.startsWith(term)) break;
      out.push(value);
    }
    return out;
  }

  private typoCandidates(term: string, maxDistance: number, limit = 12): string[] {
    if (term.length < this.segment.settings.typoTolerance.minTokenLength) return [];
    const first = term[0];
    const candidates: Array<{ term: string; distance: number; df: number }> = [];
    for (const candidate of this.segment.vocabulary) {
      if (candidate[0] !== first) continue;
      if (Math.abs(candidate.length - term.length) > maxDistance) continue;
      const distance = damerauLevenshtein(term, candidate, maxDistance);
      if (distance > maxDistance) continue;
      let df = 0;
      for (const fieldTerms of Object.values(this.segment.postings)) {
        df += fieldTerms[candidate]?.documentFrequency ?? 0;
      }
      candidates.push({ term: candidate, distance, df });
    }
    candidates.sort((a, b) => a.distance - b.distance || b.df - a.df || a.term.localeCompare(b.term));
    return candidates.slice(0, limit).map((entry) => entry.term);
  }

  private expandTerm(term: string, typoEnabled: boolean): string[] {
    const values = new Set<string>([term, ...(this.synonyms.get(term) ?? [])]);
    if (this.segment.settings.prefixSearch) {
      for (const prefix of this.prefixCandidates(term)) values.add(prefix);
    }
    if (typoEnabled && this.segment.settings.typoTolerance.enabled) {
      for (const typo of this.typoCandidates(term, this.segment.settings.typoTolerance.maxDistance)) values.add(typo);
    }
    return [...values];
  }

  private posting(field: string, term: string): TermPostings | undefined {
    return this.segment.postings[field]?.[term];
  }

  private bm25(field: string, termPostings: TermPostings, documentId: string): number {
    const posting = termPostings.postings.find((value) => value.documentId === documentId);
    if (!posting) return 0;
    const n = Math.max(1, this.segment.documentCount);
    const df = termPostings.documentFrequency;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    const k1 = this.segment.settings.bm25.k1;
    const b = this.segment.settings.bm25.b;
    const length = this.segment.documentLengths[documentId]?.[field] ?? 0;
    const average = this.segment.averageFieldLength[field] || 1;
    const tf = posting.termFrequency;
    return idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (length / average))));
  }

  private phraseMatch(documentId: string, phrase: string[]): boolean {
    for (const [field, fieldTerms] of Object.entries(this.segment.postings)) {
      const lists: number[][] = [];
      let missing = false;
      for (const term of phrase) {
        const posting = fieldTerms[term]?.postings.find((value) => value.documentId === documentId);
        if (!posting) {
          missing = true;
          break;
        }
        lists.push(posting.positions);
      }
      if (!missing && positionsContainPhrase(lists)) return true;
    }
    return false;
  }

  search(request: SearchRequest): CoreSearchResponse {
    const started = performance.now();
    const parsed = parseQuery(request.query, this.analyzer);
    const typoEnabled = request.typoTolerance ?? true;
    const expandedTerms = Object.fromEntries(parsed.terms.map((term) => [term, this.expandTerm(term, typoEnabled)]));
    const candidateIds = new Set<string>();

    const queryTerms = [...new Set(Object.values(expandedTerms).flat())];
    if (queryTerms.length === 0 && parsed.phrases.length === 0) {
      for (const id of Object.keys(this.segment.documents)) candidateIds.add(id);
    } else {
      for (const fieldTerms of Object.values(this.segment.postings)) {
        for (const term of [...queryTerms, ...parsed.phrases.flat()]) {
          for (const posting of fieldTerms[term]?.postings ?? []) candidateIds.add(posting.documentId);
        }
      }
    }

    const scores = new Map<string, number>();
    const components: Record<string, Record<string, number>> = {};
    const matchedPhrases: string[] = [];
    const filtered = [...candidateIds].filter((id) => matchesFilters(this.segment.documents[id]!, request.filters));

    for (const id of filtered) {
      let score = 0;
      components[id] = {};
      for (const [field, fieldTerms] of Object.entries(this.segment.postings)) {
        const boost = this.segment.settings.fieldBoosts[field] ?? 1;
        for (const term of queryTerms) {
          const postings = fieldTerms[term];
          if (!postings) continue;
          const value = this.bm25(field, postings, id) * boost;
          if (value > 0) {
            score += value;
            components[id]![`bm25:${field}:${term}`] = value;
          }
        }
      }
      for (const phrase of parsed.phrases) {
        if (this.phraseMatch(id, phrase)) {
          const phraseBoost = 2;
          score += phraseBoost;
          const key = phrase.join(" ");
          components[id]![`phrase:${key}`] = phraseBoost;
          if (!matchedPhrases.includes(key)) matchedPhrases.push(key);
        } else {
          score = 0;
          break;
        }
      }
      scores.set(id, score);
    }

    let ranked = filtered
      .map((id) => ({ id, score: scores.get(id) ?? 0, document: this.segment.documents[id]! }))
      .filter((entry) => request.query.trim().length === 0 || entry.score > 0);

    if (request.sort) {
      ranked.sort((a, b) => {
        const left = getField(a.document, request.sort!.field);
        const right = getField(b.document, request.sort!.field);
        if (left === right) return b.score - a.score || a.id.localeCompare(b.id);
        const direction = request.sort!.direction === "asc" ? 1 : -1;
        const leftValue = typeof left === "number" ? left : String(left ?? "");
        const rightValue = typeof right === "number" ? right : String(right ?? "");
        return (leftValue < rightValue ? -1 : 1) * direction;
      });
    } else {
      ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    }

    const facets: Record<string, Record<string, number>> = {};
    for (const facet of request.facets ?? []) {
      const counts: Record<string, number> = {};
      for (const entry of ranked) {
        const value = getField(entry.document, facet);
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (item === undefined || item === null || typeof item === "object") continue;
          const key = String(item);
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }
      facets[facet] = counts;
    }

    const queryFingerprint = requestFingerprint(request);
    let offset = request.offset;
    if (request.cursor) {
      const cursor = decodeCursor(request.cursor);
      if (cursor.version !== this.segment.version) throw new Error("Cursor belongs to a different index version");
      if (cursor.queryFingerprint !== queryFingerprint) throw new Error("Cursor belongs to a different search request");
      offset = cursor.offset;
    }

    const page = ranked.slice(offset, offset + request.limit);
    const hits = page.map((entry) => ({
      id: entry.id,
      score: entry.score,
      document: entry.document,
      highlights: highlightRanges(entry.document, [...queryTerms, ...parsed.phrases.flat()], this.analyzer),
      ...(request.debug ? { explanation: components[entry.id] } : {})
    }));
    const nextOffset = offset + hits.length;

    return {
      query: request.query,
      processingTimeMs: Number((performance.now() - started).toFixed(3)),
      total: ranked.length,
      indexVersion: this.segment.version,
      hits,
      facets,
      ...(nextOffset < ranked.length ? { nextCursor: encodeCursor(this.segment.version, nextOffset, queryFingerprint) } : {}),
      ...(request.debug ? { debug: { expandedTerms, matchedPhrases, components } } : {})
    };
  }

  autocomplete(prefix: string, limit = 10): Array<{ value: string; score: number }> {
    const terms = this.analyzer.analyzeQueryTerm(prefix);
    const normalized = terms.at(-1) ?? this.analyzer.normalize(prefix).trim();
    if (!normalized) return [];
    return this.prefixCandidates(normalized, Math.max(limit * 4, 20))
      .map((value) => {
        let score = 0;
        for (const termsByField of Object.values(this.segment.postings)) {
          score += termsByField[value]?.documentFrequency ?? 0;
        }
        return { value, score };
      })
      .sort((a, b) => b.score - a.score || a.value.localeCompare(b.value))
      .slice(0, limit);
  }

  explain(documentId: string, request: SearchRequest): Record<string, number> {
    const result = this.search({ ...request, debug: true, limit: Math.max(request.limit, this.segment.documentCount) });
    return result.debug?.components[documentId] ?? {};
  }
}
