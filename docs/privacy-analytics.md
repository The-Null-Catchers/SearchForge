# Privacy-aware analytics

SearchForge stores search and click analytics only while the project's `analyticsEnabled` flag is enabled. Disabling collection stops new analytics writes but does not silently erase historical records.

## Dashboard windows

The dashboard supports 7, 30, and 90 day windows. Daily charts are computed in UTC and expose only aggregate counts/rates:

- searches
- clicks
- click-through rate
- zero-result rate
- average search latency

The aggregate timeline never includes user identifiers, IP addresses, API keys, refresh tokens, or document bodies.

## Query privacy threshold

Raw query text can contain sensitive or identifying information. The dashboard therefore applies a server-side exact-query frequency threshold before returning query strings. A query must occur at least three times inside the selected reporting window before it can appear in either the top-query or zero-result-query tables.

One-off and low-frequency query text remains in the analytics store when collection is enabled, but is not returned by this dashboard endpoint. This is a disclosure guard for operators, not a replacement for retention policies or data-governance controls.

## Tenant isolation

`GET /v1/projects/:projectId/analytics` requires authenticated project membership before any analytics query executes. All search and click aggregates are scoped by `projectId`.

## Collection semantics

Search events are created only after a successful search when analytics collection is enabled. Clicks are accepted only for the authenticated API-key project, and clicks linked to a search event must reference an event from that same project and query.

Future production work may add configurable retention, export/delete controls, and warehouse-backed long-term analytics. Those features should preserve the same tenant and disclosure boundaries.
