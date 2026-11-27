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

## Repeatable local HTTP scenarios

Start a fresh disposable stack and seed the demo owner as in the [walkthrough](playground-demo.md). Run the committed driver with Node 22.

```bash
SEARCHFORGE_URL=http://127.0.0.1 node scripts/benchmark-demo.mjs
```

The driver creates a synthetic organization and separate 8- and 800-document projects. For the larger corpus, each fixture row is repeated 100 times with unique IDs and a numeric title suffix. Each corpus is loaded once and queried at concurrency 1 and 12, with eight warmup and 45 measured requests per scenario. The query mix cycles through JavaScript, distributed systems and two Arabic queries. Run this on a fresh stack to keep unrelated traffic out of the default global rate-limit window.

The driver records the active index size, index job runtime, import-to-completion time including queue/polling, client concurrency and raw request measurements. It includes the source SHA and load client hardware. For containers, also record `docker version`, `docker compose version` and service resource limits. The 800-document corpus stresses common postings and does not model a diverse production vocabulary.

See the [measured portfolio scenarios and raw data](evidence/).
