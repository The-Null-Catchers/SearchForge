# Browser E2E validation

SearchForge runs a real Chromium smoke flow against the Docker Compose stack in CI. The browser test uses deterministic demo seed data so it exercises the deployed web/API boundary rather than mocked browser responses.

## Covered flow

The current release smoke verifies:

- the routed `/login` page renders through Caddy
- owner credentials can authenticate through the browser form
- authentication redirects into `/dashboard`
- seeded tenant projects load in the project selector
- overview metrics render from the API
- theme switching mutates the real document theme
- the command palette opens, filters, and closes with keyboard interaction
- the Analytics navigation route loads and exposes its time-window control
- an authenticated nested dashboard route survives a full browser reload
- project switching hides old overview metrics while a delayed real request is pending, including after a simulated network failure and successful retry
- bilingual search, highlighting, BM25, typo expansion, synonyms, document editing, activation and rollback
- the Usage screen cancels stale quota requests during project switching, keeps the selected tenant's metrics after a delayed response, and respects viewer read-only permissions
- Arabic quota labels and number formatting render correctly in RTL
- unexpected page-level JavaScript exceptions fail the job

The test stores screenshots of the real landing page, imported-document overview, Arabic results before explanation expansion, expanded BM25 details, typo and synonym queries, version rollback and populated analytics. Password inputs and displayed secret elements are masked. On failure it stores a masked failure screenshot plus browser error details. CI uploads these artifacts for 14 days. The result JSON includes the source SHA when supplied and browser-observed index lifecycle timings. These timings include job polling, navigation and UI verification; they are not raw index-builder throughput.

## Execution model

The test is intentionally kept outside the application dependency graph. CI runs it in the version-pinned Playwright container `mcr.microsoft.com/playwright:v1.55.0-noble` and installs the matching `playwright@1.55.0` package inside that disposable container. This avoids changing the production dependency or lockfile solely for release validation while keeping browser/runtime versions aligned.

The browser container uses the host network on the Linux CI runner and targets `http://127.0.0.1`, which is the same Caddy entrypoint checked by the container smoke test.

## Fixture

Before the browser starts, CI runs the idempotent demo seed inside the API container. The test logs in as the seeded demo owner. The fixture is development-only and the seed script continues to refuse production execution unless explicitly opted in.

## Local reproduction

With the Compose stack running and seeded, create an artifact directory and run the same pinned browser image:

```bash
mkdir -p artifacts/browser-e2e
docker run --rm --network host \
  -e SEARCHFORGE_E2E_BASE_URL=http://127.0.0.1 \
  -e SEARCHFORGE_E2E_ARTIFACTS=/artifacts/browser-e2e \
  -v "$PWD/tests/browser:/tests:ro" \
  -v "$PWD/fixtures:/fixtures:ro" \
  -v "$PWD/artifacts:/artifacts" \
  mcr.microsoft.com/playwright:v1.55.0-noble \
  bash -lc 'npm install --global --silent playwright@1.55.0 && NODE_PATH=$(npm root -g) node /tests/e2e.cjs'
```

This is release smoke coverage, not a claim that every dashboard branch is browser-tested. Deeper destructive flows remain better covered by API/integration tests unless they need explicit browser evidence.
