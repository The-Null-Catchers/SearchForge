# Changelog

## Unreleased

### Search and isolation

- Resolve the active index pointer and version in one database snapshot during activation and rollback.
- Preserve analyzer positions in phrases with configured stop words. Include the contribution of every matched phrase in its score explanation.
- Bound edit-distance expansion to tokens up to 64 UTF-16 code units while keeping longer terms available for exact, phrase and prefix queries.
- Count each distinct facet value once per matching document, including labels that coincide with inherited JavaScript property names.
- Accept an optional `X-SearchForge-Project-Id` header on search and autocomplete. A valid key for a different project receives HTTP 403 before its project usage is charged.

### Dashboard and operations

- Add mixed-language and unpublished-state queries, category and language facets, keyboard autocomplete, and document inspection to the Playground.
- Localize Analytics, Indexes, Sources, API Keys, Settings and account forms in Arabic. Use locale-aware numbers and dates in the Playground and Analytics.
- Scope sensitive dashboard views to the selected project and cancel pending Playground and Analytics requests when their context changes.
- Update runtime packages and resolved transitive dependencies to address the registry advisories reported during the release review.
- Bind the bundled MinIO console to loopback. Record the actual browser source commit and capture index size, backup duration, restore duration, and runner details in CI.

### Earlier work

- [PR #85](https://github.com/The-Null-Catchers/SearchForge/pull/85) localized project quotas and usage.
- [PR #86](https://github.com/The-Null-Catchers/SearchForge/pull/86) isolated project overview state and expanded browser evidence.
