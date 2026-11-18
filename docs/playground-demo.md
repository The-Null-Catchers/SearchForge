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

## Change a synonym and roll back an index

Use the disposable demo project with the original corpus.

1. Clear **Category filter**, turn off **Typo tolerance**, and search for `ecmascript`. Confirm there are no results and note the index version.
2. Open **Synonyms**. Add a set named `ECMAScript documentation` with terms `ecmascript, javascript` and select **One-way expansion**. Repeat the search. The original index now returns **JavaScript search engine** through the project synonym.
3. Open **Indexes**, inspect the `search-en` document, and change its JSON title to `JavaScript search engine release candidate`. Save the fields and wait for the new index version to become active. Repeat the search and verify the new title.
4. In **Indexes**, activate the original version. Repeat the search to see the original title and version number. The synonym still applies because it is project-level configuration. The stored edit also persists and will be indexed again on the next rebuild.

The **container-smoke** job imports the same corpus into a disposable stack and verifies this sequence in Chromium. Its `browser-e2e` artifact includes screenshots, the tested index versions, and the restored search result. This walkthrough exercises lexical retrieval with eight documents. Production load and recovery evidence use the separate [release procedure](release-evidence.md).
