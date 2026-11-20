#!/usr/bin/env node
// Deterministic offline relevance evaluation. No API keys or external services.
import { readFile } from "node:fs/promises";
import { indexSettingsSchema, searchRequestSchema } from "../packages/shared/dist/index.js";
import { buildSegment, SegmentSearchEngine } from "../packages/search-core/dist/index.js";

const corpus = JSON.parse(await readFile(new URL("../fixtures/demo-documents.json", import.meta.url), "utf8"));
const judgments = JSON.parse(await readFile(new URL("../fixtures/relevance-judgments.json", import.meta.url), "utf8"));
const cutoff = 5;
const configurations = [
  { name: "baseline-no-typos", typoTolerance: false },
  { name: "typo-enabled", typoTolerance: true }
];

function metrics(ranked, relevant, k) {
  const ids = ranked.slice(0, k);
  const positive = Object.entries(relevant).filter(([, grade]) => grade > 0);
  const hits = ids.filter(id => (relevant[id] ?? 0) > 0).length;
  const first = ids.findIndex(id => (relevant[id] ?? 0) > 0);
  const dcg = ids.reduce((sum, id, index) => sum + (2 ** (relevant[id] ?? 0) - 1) / Math.log2(index + 2), 0);
  const ideal = Object.values(relevant).sort((a, b) => b - a).slice(0, k)
    .reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  return {
    precision: hits / k,
    recall: positive.length ? hits / positive.length : 0,
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    ndcg: ideal ? dcg / ideal : 0
  };
}

export function validateJudgments(rows, docs) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("At least one judgment is required");
  const ids = new Set(docs.map(doc => doc.id));
  const queries = new Set();
  for (const row of rows) {
    if (!row || typeof row.query !== "string" || !row.query.trim()) throw new Error("Invalid query");
    if (queries.has(row.query)) throw new Error(`Duplicate query: ${row.query}`);
    queries.add(row.query);
    if (!row.relevant || !Object.keys(row.relevant).length) throw new Error("Query has no judgments");
    for (const [id, grade] of Object.entries(row.relevant)) {
      if (!ids.has(id)) throw new Error(`Unknown document: ${id}`);
      if (!Number.isInteger(grade) || grade < 0 || grade > 3) throw new Error(`Invalid grade: ${id}`);
    }
    if (!Object.values(row.relevant).some(grade => grade > 0)) throw new Error("Query has no relevant document");
  }
}
validateJudgments(judgments, corpus);

const settings = indexSettingsSchema.parse({});
const segment = buildSegment(corpus, settings, { version: "offline-eval-v1" });
const engine = new SegmentSearchEngine(segment);
const report = configurations.map(config => {
  const queries = judgments.map(row => {
    const request = searchRequestSchema.parse({
      query: row.query,
      limit: cutoff,
      typoTolerance: config.typoTolerance && row.typoTolerance !== false
    });
    const ranked = engine.search(request).hits.map(hit => hit.id);
    return { query: row.query, language: row.language, ranked, ...metrics(ranked, row.relevant, cutoff) };
  });
  const average = key => Number((queries.reduce((sum, row) => sum + row[key], 0) / queries.length).toFixed(4));
  return {
    configuration: config.name,
    corpusDocuments: corpus.length,
    judgedQueries: queries.length,
    cutoff,
    precisionAtK: average("precision"),
    recallAtK: average("recall"),
    mrrAtK: average("reciprocalRank"),
    ndcgAtK: average("ndcg"),
    queries
  };
});
console.log(JSON.stringify({ kind: "synthetic-offline-relevance-evaluation", report }, null, 2));
