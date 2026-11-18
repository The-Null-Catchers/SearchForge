# Bilingual Search Playground demo

Use a local development stack and the synthetic corpus in [demo-documents.json](../fixtures/demo-documents.json). The eight records cover Arabic, English, and mixed documentation, guides, and blog content.

## Load the demo index

Start the stack from the [quick start](../README.md#quick-start), then seed the reserved demo accounts and projects.

```sh
docker compose exec -T api node apps/api/dist/seed.js
```

Sign in as `owner@searchforge.local` with the development password in [Demo seed data](demo-seed.md#demo-credentials). Select **Docs Search** and open **API Keys** to create an indexing key and a separate search key. Use the indexing key with the [existing corpus loader](benchmarking.md#demo-corpus-and-benchmarking). For the stock Compose stack, use `http://localhost` as the base URL and `docs` as the index slug. Open **Logs** and filter to **Jobs** to check that the indexing job completes. Its ID is printed by the loader.

## Try the search

1. Open **Search Playground** and enter the search key. Use `docs` as the index slug.
2. Choose **Arabic search** and run the query. The preset uses `محرك بحث` with `docs` as the category. Open **BM25 score breakdown** on **محرك بحث عربي** to inspect the score components. Clear **Category filter** and run the query again to see matching guides.
3. Choose **English typo**. Turn off **Typo tolerance** and run `javscript` to see the zero-result state. Turn typo tolerance back on and run it again. **JavaScript search engine** ranks first and the expanded terms include `javascript`.

The **container-smoke** job imports the same corpus into a disposable stack, visits the playground in Chromium, and uploads Arabic and typo screenshots plus the checked document IDs and index version in its `browser-e2e` artifact. This walkthrough exercises lexical retrieval with eight documents. Production load and recovery evidence use the separate [release procedure](release-evidence.md).
