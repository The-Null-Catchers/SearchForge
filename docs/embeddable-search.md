# Embeddable search UI

SearchForge ships a framework-independent web component in `@searchforge/ui-kit`. It uses the JavaScript SDK, Shadow DOM isolation, autocomplete, accessible keyboard navigation, result rendering, click analytics, and automatic Arabic/English direction handling.

## Browser key safety

Use only a **search-scoped** API key in browser code. Search keys are intentionally client-visible credentials and should still have expiration, IP restrictions where practical, and a conservative per-key rate limit. The widget refuses `sf_admin_*` and `sf_indexing_*` keys. Never embed an admin or indexing key.

## Mounting

```ts
import { mountSearchWidget } from "@searchforge/ui-kit";

const search = mountSearchWidget({
  target: "#site-search",
  baseUrl: "https://search.example.com",
  projectId: "YOUR_PROJECT_ID",
  apiKey: "sf_search_...",
  indexSlug: "docs",
  placeholder: "Search docs / ابحث في التوثيق",
  direction: "auto",
  limit: 10
});

search.focus();
```

The returned handle exposes `search(query)`, `focus()`, and `destroy()`.

## Result fields

By default the widget reads `title`, `content`, and `url` from each document. Configure `titleField`, `descriptionField`, or `urlField` when your schema uses different names. For advanced routing, pass `resultUrl(hit)`.

Dynamic document data is rendered with DOM `textContent`; the widget does not inject result HTML. Result URLs accept only HTTP(S) destinations.

## Events

The custom element emits composed DOM events:

- `searchforge:search` after a successful search with `{ query, total, processingTimeMs }`.
- `searchforge:select` when a result is selected with `{ hit, position }`.

Click analytics are best-effort and never block navigation.

## Accessibility and RTL

The search input uses native search semantics, an ARIA listbox for autocomplete, live result status, Escape dismissal, and ArrowUp/ArrowDown/Enter navigation. With `direction: "auto"`, Arabic queries switch the component to RTL while English queries render LTR.

## Theme tokens

Override CSS custom properties on the host element:

```css
searchforge-search {
  --sf-bg: #fff;
  --sf-fg: #111827;
  --sf-muted: #667085;
  --sf-border: #d0d5dd;
  --sf-accent: #6941c6;
  --sf-accent-soft: #f4f3ff;
}
```

The component uses Shadow DOM, so surrounding application CSS does not accidentally alter internal layout.
