# SearchForge portfolio recording and shot list

[Watch the browser recording](images/portfolio/searchforge-demo.mp4) · [Screenshot gallery and source revision](images/portfolio/)

Record only from a running disposable SearchForge environment using synthetic data. Never show plaintext API keys, session tokens, or customer data.

## Preparation

1. Check out the final feature-branch SHA and start the stack using `cp .env.example .env && docker compose up -d --build --wait`.
2. Seed the reserved demo tenants: `docker compose exec -T api node apps/api/dist/seed.js`.
3. Follow `docs/playground-demo.md` to create scoped demo keys and import `fixtures/demo-documents.json`.
4. Confirm the indexing job completed. Use a 1440x900 browser viewport and hide any password manager or browser account overlays.

## 90-second sequence

| Time | Screen | Narration and action |
| --- | --- | --- |
| 0–10s | Landing page | Explain the self-hosted Arabic/English search problem and architecture |
| 10–20s | Dashboard | Show the selected demo organization/project and real index/document counts |
| 20–35s | Playground | Run Arabic search and demonstrate category facets and highlighted matches |
| 35–45s | BM25 explanation | Expand the ranked result breakdown and explain the field contribution |
| 45–55s | Typo and autocomplete | Type `jav`, inspect suggestions, then compare `javscript` with typo tolerance off/on |
| 55–70s | Synonyms and index management | Add `ecmascript` synonym and edit the synthetic JavaScript document |
| 70–80s | Index versions | Show new immutable version activation and roll back to the prior version |
| 80–90s | Analytics and tenant isolation | Show genuine aggregated metrics and switch to the separate demo project |

## Evidence capture

The Chromium browser E2E script writes genuine screenshots and a JSON result to its configured artifact directory. After a successful final-head run, review and copy selected files to `docs/images/portfolio/` with the source commit SHA recorded. Suitable captures: landing, dashboard overview, Arabic playground, BM25 explanation, index rollback, analytics. Do not add invented or manually mocked images.

To reproduce automated browser footage, add `-e SEARCHFORGE_E2E_VIDEO_DIR=/artifacts/portfolio-video` to the pinned Playwright command in [browser E2E](browser-e2e.md). It pauses on the main visual checkpoints. Review the file before sharing, and trim setup or failed attempts to 60–120 seconds.
