# Project settings workflow

SearchForge exposes project settings through authenticated dashboard endpoints and keeps search-serving semantics explicit when analyzer-related settings change.

## API

- `GET /v1/projects/:projectId/settings` requires viewer access or higher.
- `PUT /v1/projects/:projectId/settings` requires admin access or higher.

Editable settings are the project display name and description, default language, supported English/Arabic languages, and the analytics collection toggle. Project slugs remain immutable in this workflow so URLs, API references, and destructive confirmation strings do not drift unexpectedly.

## Rebuild semantics

Changing the default or supported languages changes analyzer configuration. The update transaction therefore persists the new project/index settings and enqueues a durable index rebuild atomically. The currently active immutable segment remains searchable while the replacement is built and validated; activation follows the existing indexer lifecycle only after persistence succeeds.

Changes that do not affect analyzers, such as the display name, description, or analytics toggle, do not enqueue an index rebuild.

## Auditing

Each successful update writes a `project.settings_updated` audit entry containing the previous and current settings and, when applicable, the durable rebuild job identifier.
