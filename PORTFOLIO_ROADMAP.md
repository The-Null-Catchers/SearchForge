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
| P0 | CI build, unit, integration, Dart and container smoke | Passed for #78; rerun for each new change | [#78 successful CI](https://github.com/The-Null-Catchers/SearchForge/actions/runs/44807361486) |
| P0 | Real screenshots from the final running revision | Pending | Capture under docs/images/portfolio |
| P0 | Final environment-specific load and restore evidence | Pending | docs/release-evidence.md |
| P1 | Relevance judgments and comparative ranking evaluation | Implemented in #79, final-head CI pending | `node scripts/evaluate-relevance.mjs` after `pnpm build` |
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

## Outstanding release evidence

The existing CI runs a disposable load/recovery rehearsal and uploads artifacts. The target VPS has not been authorized or measured in this portfolio pass. A real target backup and isolated restore are still required before publishing deployment-specific claims. Screenshot files must come from a running application, not design mockups.

See [case study](docs/CASE_STUDY.md), [playground demo](docs/playground-demo.md), [status](docs/status.md), [release evidence](docs/release-evidence.md), and [browser E2E](docs/browser-e2e.md).
