# SearchForge engineering case study

## Problem and audience

SearchForge is a self-hosted lexical search platform for developers who need to ingest website and application documents, search Arabic and English content, and inspect the reasons behind a ranking. A hosted search vendor would reduce operational responsibility but would hide the indexing and retrieval algorithms that this project is designed to demonstrate. SearchForge therefore owns its analyzer, inverted index, and BM25 scorer.

## Architecture and decisions

The TypeScript monorepo separates a Next.js control plane, a Fastify REST API, a crawler, an indexer, and a background worker. PostgreSQL stores durable tenant metadata, jobs, documents, analytics and active index pointers; Redis supports ephemeral BullMQ delivery. Search segments are persisted as immutable files.

The indexer tokenizes each searchable field and stores term frequencies and positional postings. The search core evaluates query terms against postings, computes per-field BM25 with configurable boosts, and returns explain components. Arabic processing includes Unicode normalization, configurable Alef/Ya/taa marbuta handling, diacritic and tatweel removal, and optional light stemming. English uses lightweight suffix stemming. Neither analyzer is a general-purpose morphological or semantic language model.

The engine also supports quoted phrases through positional postings, prefix expansion, bounded deletion-dictionary typo candidates, project synonyms, compound filters, facets, and safe highlight ranges. A future hybrid/vector retriever is possible, but no vector-search capability is claimed.

## Immutable releases and failure handling

New index builds write and validate a separate segment before changing the active version pointer in a PostgreSQL transaction. Existing readers can finish using their previously selected version. An authorized user can activate a retained earlier version to roll back search results. The underlying stored document edits remain, so rebuilding again may republish those edits.

Indexing and crawl work use a durable PostgreSQL outbox, worker execution identifiers, heartbeat/recovery fencing, and bounded retry behavior. The crawler validates DNS destinations, pins resolved addresses, checks redirects, honors robots rules, and blocks private-network access by default. Production operators must still enforce egress restrictions.

Search requests are scoped through project API keys. Organization/project permissions, key scopes, quotas and audit logs protect the control plane. Query analytics uses a privacy threshold for revealing repeated query text; disabling collection does not retroactively delete history.

## Reproducible demo

The eight-document synthetic corpus in `fixtures/demo-documents.json` covers English, Arabic, and mixed-language search. The local seed creates two demo organizations and projects. The existing Chromium E2E script exercises bilingual search, typo expansion, synonyms, document edits, version activation, rollback and project switching. See `docs/playground-demo.md` for the exact walkthrough.

The portfolio interface provides a landing page, dashboard, Arabic/English locale switch for core flows, and a playground that exposes search-key authentication, filters, facets, autocomplete, matching-term highlights and score breakdowns. The locale implementation is incremental: some secondary management screens still contain English-only strings.

## Relevance evaluation and explain correctness

The checked-in `fixtures/relevance-judgments.json` grades seven synthetic bilingual queries against the eight-document demo corpus. `node scripts/evaluate-relevance.mjs` executes the real segment builder and search core, reporting per-query and macro-averaged Precision@5, Recall@5, MRR@5 and nDCG@5 with and without typo expansion. These judgments are small, hand-authored and incomplete, so the output is a reproducible regression indicator, not a statistically representative search-quality score. See [relevance evaluation](relevance-evaluation.md).

Search-core scoring now uses query-scoped document-ID posting maps to avoid repeated linear scans during BM25 and phrase evaluation. The `explain` API returns an explanation only when the document satisfies the complete query, including quoted phrases. CI regression tests cover the behavior. No speedup is claimed until comparative measurements on the same dataset and environment are recorded.

## Performance and recovery evidence

The repository contains a real authenticated HTTP load harness with configurable request count, concurrency, warmup and error/p95 gates. It measures wall-clock p50/p95/p99, throughput and error rate. The disposable CI recovery rehearsal checks PostgreSQL counts, index segment checksums, restored object retrieval, and an Arabic query on the restored active segment.

These are verification mechanisms, not evidence of a particular VPS latency, throughput, RPO or RTO. Target-environment measurements must include the exact source SHA, corpus, CPU/RAM, network topology, warmup, query mix and request count. Never substitute engineering targets for measurements. See `docs/release-evidence.md`.

## Tradeoffs and limitations

- In-process lexical retrieval is understandable and inspectable, but the initial topology is not a distributed shard/replica cluster.
- The language analyzers are deliberately lightweight and do not cover every Arabic morphological variant or semantic synonym.
- The demonstration corpus is intentionally small; correctness checks on eight documents are not scale benchmarks.
- Redis is treated as reconstructible queue/cache state, while PostgreSQL, immutable index files and MinIO must be backed up as a matched set.
- The public landing page is informational; the playground requires a real project and a scoped API key.
- SDK packages are not published. License and contributor attribution must be reviewed before distribution.
- Representative VPS load measurements, target restore evidence, complete Arabic UI coverage and a reviewed release license remain release blockers.

## Future improvements

Expand the initial relevance judgments with independently labeled real-world-style synthetic queries, compare analyzer and ranking configurations, add comprehensive Arabic interface translations, capture genuine release screenshots and a short walkthrough video, and validate performance and restore on the intended target environment. Sharding, hybrid retrieval and SDK publishing remain separate decisions rather than implied completed features.
