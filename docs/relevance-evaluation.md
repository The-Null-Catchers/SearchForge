# Reproducible relevance evaluation

This is a **small, synthetic regression fixture**, not a claim about real-world retrieval quality or production latency.

Run from a clean checkout after `pnpm install --frozen-lockfile && pnpm build`:

```sh
node scripts/evaluate-relevance.mjs > relevance-report.json
```

The evaluator loads eight checked-in documents and seven bilingual queries with graded judgments (1–3). It uses the actual analyzer, immutable segment builder, and search engine. Two configurations compare typo expansion enabled and disabled; all other settings are held constant.

The report contains per-query ranked IDs and macro-averaged Precision@5, Recall@5, MRR@5 and nDCG@5. Precision@5 uses five slots even when the corpus has fewer returned hits. Recall uses all judged relevant documents. MRR uses the rank of the first relevant document. nDCG uses exponential gain and log discount.

**Limitations:** Judgments are hand-authored and incomplete. Unjudged documents are treated as non-relevant for this regression fixture. Scores are not statistically significant, representative of user traffic, or comparable to a larger benchmark. Add independently labeled queries and report per-language metrics before making ranking-quality claims. No secrets, network requests, or production data are needed.
