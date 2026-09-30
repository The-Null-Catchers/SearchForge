# Demo corpus and benchmarking

Create an account, organization and project in the dashboard. Keep the returned
private key on the server. Build the workspace, then queue the bilingual corpus:

```bash
export SEARCHFORGE_URL=https://search.example.com
export SEARCHFORGE_PROJECT_ID=your-project-uuid
# Set SEARCHFORGE_INDEXING_KEY securely in the shell; never put it in git.
node scripts/seed-documents.mjs
```

The script outputs only the job ID and accepted count. Stable IDs make repeat
runs upserts. Wait for the job to complete before testing `javscript`,
`محرك البحث`, `"distributed systems"` and mixed queries in the playground.
The demo corpus is small and suitable for correctness checks, not scale claims.

Install k6 on the benchmark runner and run only against an isolated test project:

```bash
# Set SEARCHFORGE_SEARCH_KEY securely in the shell.
k6 run --summary-export=benchmark.json tests/load/search.js
```

Report hardware, corpus size, vocabulary/postings size, index bytes, worker
concurrency, warm/cold cache state, rate-limit configuration and query mix.
The output includes requests/sec, error rate and latency p50 (med), p95 and p99;
separate search and autocomplete operation tags when interpreting results.
Do not hide HTTP 429s; reduce load or explicitly adjust the benchmark quota.
Indexing and concurrent-crawl throughput benchmarks remain separate release work.
