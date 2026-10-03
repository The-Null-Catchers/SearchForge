# Document field editing

SearchForge supports console-side editing for stored document fields without mutating the active immutable segment in place.

`PUT /v1/console/indexes/:indexId/documents/:documentId` requires developer access. The request body contains the complete document object to store. The route preserves the URL document identifier, rejects deleted documents, limits serialized payload size, persists the replacement body and enqueues a durable index rebuild in the same PostgreSQL transaction.

The currently active index version remains searchable while the rebuild runs. The edited document appears as `pending` in the explorer until the replacement segment validates, persists and activates.

Every edit writes an audit event containing the index ID, rebuild job ID and the names of fields that changed. Full before/after document bodies are deliberately not copied into audit metadata because document content may contain private customer data.

The dashboard JSON editor is intended for operational corrections and structured metadata edits. Source-controlled crawler transformations should still be changed in the ingestion pipeline and recrawled so that future crawls do not overwrite manual corrections unexpectedly.
