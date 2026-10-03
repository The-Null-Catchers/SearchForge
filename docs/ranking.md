# Ranking configuration

SearchForge exposes project-scoped ranking settings through the dashboard and API.
The active lexical configuration includes BM25 saturation/length normalization,
field boosts, typo tolerance, and prefix search.

## API

`GET /v1/projects/:projectId/ranking` requires viewer access and returns the
resolved settings for the default `docs` index.

`PUT /v1/projects/:projectId/ranking` requires developer access or higher. The
payload is validated and persisted to both project defaults and the default index.
A successful update returns `202 Accepted` with a durable rebuild `jobId`.

Ranking changes do not mutate the active segment in place. Search continues to
serve the current active version while the new immutable segment is built. The
indexer activates the replacement only after validation and persistence succeed.
This keeps relevance changes atomic and rollback-friendly.

Every ranking update writes an audit record with the previous settings, current
settings, and rebuild receipt.
