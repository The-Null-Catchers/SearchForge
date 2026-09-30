# SDKs

Both packages live in this monorepo and are not published to registries yet.
Project-scoped keys determine the tenant on the server. `projectId` identifies
the client configuration; it does not override the key's server-side scope.
Use a search-only key in web/mobile clients. Keep indexing/admin keys on servers.

## JavaScript / TypeScript

Build with `pnpm --filter @searchforge/sdk... build` and use the workspace package.

```ts
import { SearchForge, SearchForgeError } from '@searchforge/sdk';
const client = new SearchForge({
  projectId: 'project-uuid',
  apiKey: 'sf_search_...',
  baseUrl: 'https://search.example.com',
  indexSlug: 'docs',
});
const result = await client.search('محرك search', {
  filters: { 'metadata.category': 'docs' },
  facets: ['metadata.category'],
  limit: 20,
});
if (result.nextCursor) {
  await client.search('محرك search', { cursor: result.nextCursor });
}
await client.autocomplete('prog');
await client.trackClick({ query: result.query, documentId: result.hits[0]!.id,
  position: 1, ...(result.searchEventId ? {searchEventId: result.searchEventId} : {}) });
```

The client supports `AbortSignal`, per-request timeouts and structured errors
with HTTP status, error code and request ID. It never automatically retries
writes or analytics, avoiding duplicate operations.

## Dart / Flutter

Use a path dependency until publication:

```yaml
dependencies:
  searchforge:
    path: ../SearchForge/packages/sdk-flutter
```

```dart
import 'package:searchforge/searchforge.dart';
final client = SearchForgeClient(
  projectId: 'project-uuid', apiKey: 'sf_search_...',
  baseUrl: 'https://search.example.com',
);
final result = await client.search(query: 'بحث search',
  filters: {'published': true}, facets: ['metadata.category']);
final suggestions = await client.autocomplete(query: 'prog');
await client.trackClick(query: result.query, documentId: 'doc',
  position: 1, searchEventId: result.searchEventId);
client.close();
```

Dart exposes result metadata, filters, sorting, offset/cursor pagination,
autocomplete and click tracking. It supports injectable HTTP clients for testing,
request timeouts and structured server errors. A timed-out Dart Future does not
cancel an in-flight HTTP request; no automatic retry is attempted.
