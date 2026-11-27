# SearchForge portfolio roadmap

Audit baseline: 2026-11-20, main SHA `02b22db4ecbd43a442af77529736dc8b93141b2c`.

## Confirmed architecture

The repository already implements TypeScript lexical retrieval with Arabic/English analysis, positional postings, BM25, phrase/prefix/typo search, facets, filters, autocomplete, immutable index versions, and explain output. It also includes a safe crawler, PostgreSQL-backed tenant control plane, scoped API keys, quotas, durable job recovery, JavaScript/Dart SDKs, Docker Compose, and CI. Do not rebuild these features merely to increase portfolio scope.

## Priority and evidence

| Priority | Work | State | Verification |
| --- | --- | --- | --- |
| P0 | Dedicated branch, audit and initial SHA | Done | GitHub branch and commit history |
| P0 | Public landing and bilingual core navigation | Merged in #78 | CI passed at `7a1eb0a1a8904d1b5f90d5a2bc2d9091ea89f71c` |
| P0 | Playground autocomplete, facet actions, highlights, language/published filters | Merged in #78 | Chromium E2E and API helper tests passed |
| P0 | Reproducible bilingual corpus, typo, synonym, edit and rollback | Already implemented | Existing browser E2E and fixtures |
| P0 | CI build, unit, integration, Dart and container smoke | Passed on #80 final head | [#80 successful CI](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44814633377) |
| P0 | Real screenshots from the final running revision | Pending | Capture under docs/images/portfolio |
| P0 | Final environment-specific load and restore evidence | Pending | docs/release-evidence.md |
| P1 | Relevance judgments and comparative ranking evaluation | Merged in #79 | [#79 successful CI](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44809952170); `node scripts/evaluate-relevance.mjs` after `pnpm build` |
| P1 | Query-scoped postings lookup and correct phrase explanations | Merged in #80 | [#80 successful CI](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44814633377); performance comparison still pending |
| P1 | Full Arabic localization of secondary management screens | Pending | RTL browser assertions |
| P1 | License and contributor attribution review | Pending approval | No SDK publication or release |
| P2 | Sharding, hybrid/vector retrieval and SDK publication | Out of current milestone | Separate design review |

## Acceptance gates

1. Clean checkout starts with `cp .env.example .env && docker compose up -d --build --wait`.
2. Seed synthetic tenants with `docker compose exec -T api node apps/api/dist/seed.js`.
3. Import `fixtures/demo-documents.json` using a scoped indexing key and `node scripts/seed-documents.mjs`.
4. Verify Arabic and English search, typo correction, score explanations, filters, facets and autocomplete.
5. Edit a document, observe a new immutable version, activate and roll back. Verify tenant isolation.
6. Pass unit, integration, browser, Dart, security, build and Docker smoke checks on the final SHA.
7. Record genuine screenshots and a 60–120 second walkthrough, or provide an executable recording shot list.
8. Publish measured hardware, corpus, request count, warmup, concurrency, latency percentiles, throughput, errors and isolated restore integrity. Never invent measurements.
9. Review license, attribution and dependency obligations before any public release or SDK publishing.

## Merge evidence (2026-11-20)

- [PR #78](https://github.com/The-Null-Catchers/SearchForge/pull/78) merged as `edc732e1fc66ebd39e1a0230d8e099c86fb5968d` (portfolio UI and bilingual playground).
- [PR #79](https://github.com/The-Null-Catchers/SearchForge/pull/79) merged as `3ac8ea01a5ec0f0838c13321fc8159ea5f33003b` (synthetic relevance judgments and evaluator).
- [PR #80](https://github.com/The-Null-Catchers/SearchForge/pull/80) merged as `9cf35fb17983f429f1c2bab4fd8e9bd11245e081` (query-scoped postings lookups and explain correctness). All four CI jobs passed on its PR head `9734afe6e75ede3134858dafeb3f2b0f8b7c426e`.
- Passing CI demonstrates functional regression coverage, **not** a quantified speedup or target VPS readiness. CI artifacts are ephemeral; preserve final-run artifacts before they expire.

## November 25 engineering pass

- Baseline main `00cf674fff8f8456b9f2f962e793c49951d44d85`: all four CI jobs passed; actual eight-document disposable search and restore measurements are preserved in [portfolio baseline](docs/portfolio-baseline.md).
- Project overview: separate project-keyed loading/error/data state, cancellation, retry and a browser regression for switching during an outstanding request. New branch CI must pass before marking this complete.
- Browser evidence: distinct Arabic and BM25 captures, populated overview and analytics, masked secrets, and measured import/edit/rollback lifecycle durations. Final captures and CI evidence remain pending verification.
- Existing Arabic Usage localization draft [#85](https://github.com/The-Null-Catchers/SearchForge/pull/85) remains separate and unmerged.

## Outstanding release evidence

The existing CI runs a disposable load/recovery rehearsal and uploads artifacts. The target VPS has not been authorized or measured in this portfolio pass. A real target backup and isolated restore are still required before publishing deployment-specific claims. Screenshot files must come from a running application, not design mockups.

See [case study](docs/CASE_STUDY.md), [playground demo](docs/playground-demo.md), [status](docs/status.md), [release evidence](docs/release-evidence.md), and [browser E2E](docs/browser-e2e.md).
