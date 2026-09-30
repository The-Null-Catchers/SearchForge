import type { IndexSettings, SearchRequest, SearchResponse } from "@searchforge/shared";

export type Primitive = string | number | boolean | null;
export type DocumentField = Primitive | Primitive[] | Record<string, unknown>;

export type SearchDocument = {
  id: string;
  url?: string;
  title?: string;
  headings?: string[];
  content?: string;
  language?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  [field: string]: DocumentField | undefined;
};

export type AnalyzerToken = {
  term: string;
  position: number;
  original: string;
};

export type Posting = {
  documentId: string;
  termFrequency: number;
  positions: number[];
};

export type TermPostings = {
  documentFrequency: number;
  postings: Posting[];
};

export type Segment = {
  id: string;
  version: string;
  createdAt: string;
  documentCount: number;
  settings: IndexSettings;
  documents: Record<string, SearchDocument>;
  postings: Record<string, Record<string, TermPostings>>;
  documentLengths: Record<string, Record<string, number>>;
  averageFieldLength: Record<string, number>;
  vocabulary: string[];
  checksum?: string;
};

export type BuildOptions = {
  version: string;
  searchableFields?: string[];
};

export type SearchDebug = {
  expandedTerms: Record<string, string[]>;
  matchedPhrases: string[];
  components: Record<string, Record<string, number>>;
};

export type CoreSearchResponse = SearchResponse<SearchDocument> & {
  debug?: SearchDebug;
};

export type SearchCore = {
  search(request: SearchRequest): CoreSearchResponse;
  autocomplete(prefix: string, limit?: number): Array<{ value: string; score: number }>;
  explain(documentId: string, request: SearchRequest): Record<string, number>;
};
