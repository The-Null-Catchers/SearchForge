# Bilingual Search Playground demo

Use a fresh local Compose stack and the eight synthetic records in [demo-documents.json](../fixtures/demo-documents.json).

## Start, migrate and seed

```bash
cp .env.example .env
docker compose up -d --build --wait
docker compose logs migrate
docker compose exec -T api node apps/api/dist/seed.js
```

The migration job exits successfully before the application starts. Demo seeding recreates the reserved organization and user rows. Use a disposable stack if you want to retain existing demo data elsewhere.

## Import the corpus and verify permissions

1. Sign in as `owner@searchforge.local` using the development password from [demo seed](demo-seed.md#demo-credentials). Choose **Docs Search**.
2. Open **API Keys**. Create one **Indexing** key and one **Search-only** key. Copy them to separate secure shell variables or a disposable password manager. Plaintext appears at creation.
3. Queue the included fixture with the indexing key.

   ```bash
   pnpm install --frozen-lockfile
   pnpm --filter @searchforge/sdk... build
   export SEARCHFORGE_URL=http://localhost
   export SEARCHFORGE_PROJECT_ID="$(docker compose exec -T postgres psql -U searchforge -d searchforge -Atc "SELECT id FROM projects WHERE slug = 'docs-search' AND deleted_at IS NULL")"
   read -rs SEARCHFORGE_INDEXING_KEY
   export SEARCHFORGE_INDEXING_KEY
   node scripts/seed-documents.mjs
   unset SEARCHFORGE_INDEXING_KEY
   ```

4. The loader reports the job ID and eight accepted documents. In **Logs**, select **Jobs** and confirm completion. **Overview** should show eight indexed documents in **Docs Search**.
5. Switch to **Product Catalog**. The seeded account is a viewer there and the index has no demo documents. Overview metrics update and API key controls require an admin or owner. Open the Playground and supply the **Docs Search** key. The server should deny it with a different-project message. Select **Docs Search** to continue.
6. For a scope check, send the search-only key to the ingestion route. The API must return HTTP 403 before processing the empty batch.

   ```bash
   read -rs SEARCHFORGE_SEARCH_KEY
   curl -sS -o /dev/null -w '%{http_code}\n' http://localhost/v1/indexes/docs/documents/batch \
     -H "Authorization: Bearer $SEARCHFORGE_SEARCH_KEY" \
     -H 'Content-Type: application/json' -d '{"documents":[]}'
   unset SEARCHFORGE_SEARCH_KEY
   ```

## Inspect real ranked results

1. Open **Search Playground**, supply the Docs Search search key and keep the index slug `docs`.
2. Choose **Arabic search**. Run `محرك بحث` and look for **محرك بحث عربي**. Inspect the highlighted text, request time, engine time and active version.
3. Expand **BM25 score breakdown** to inspect field and analyzed-term contributions. Use **Inspect document** to view the structured hit.
4. Remove the category filter, rerun the query, and inspect the returned category and language facets. Select a facet to filter. Select it again to clear it.
5. Enter `distributed systems` for English results. For autocomplete, type `محرك jav`, wait for the suggestion, press Down, then Enter. The previous Arabic term remains in the input.
6. Choose **Mixed-language search**, select **Mixed** and run the query. The results use the mixed-language corpus. Clear the query and language filter, select **Unpublished only** and verify that **Introduction to databases** is returned.
7. Choose **English typo**. With typo tolerance off, `javscript` has no matches. Turn it on and run the same query. **JavaScript search engine** ranks first and the expanded terms include `javascript`.

## Publish and roll back

1. Clear the filters, turn typo tolerance off, and search for `ecmascript`. Expect zero matches. Note the active version.
2. In **Synonyms**, add **ECMAScript documentation** with the terms `ecmascript, javascript`. Enable one-way expansion and save. Search again and verify that **JavaScript search engine** appears on the same version.
3. In **Indexes**, inspect `search-en` and set its JSON title to `JavaScript search engine release candidate`. Save fields and wait for the new version to become active. The old version becomes retired.
4. Repeat the `ecmascript` query to see the new title and active version. In **Indexes**, activate the former version, then repeat the query again. The original title and version return. The saved edit and synonym remain in project storage.
5. In **Analytics**, confirm the seeded repeated queries and daily search/click aggregates. The exact query privacy threshold suppresses rare query text. Switch to **Product Catalog** to see its separate aggregates.

The [browser flow](browser-e2e.md) automates the end-to-end verification and captures evidence. See the [recording shot list](portfolio-recording.md) for a short walkthrough.
