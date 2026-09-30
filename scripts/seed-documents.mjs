import { readFile } from 'node:fs/promises';
import { SearchForge } from '../packages/sdk-js/dist/index.js';
const { SEARCHFORGE_URL, SEARCHFORGE_PROJECT_ID, SEARCHFORGE_INDEXING_KEY } = process.env;
if (!SEARCHFORGE_URL || !SEARCHFORGE_PROJECT_ID || !SEARCHFORGE_INDEXING_KEY) {
  throw new Error('Set SEARCHFORGE_URL, SEARCHFORGE_PROJECT_ID and SEARCHFORGE_INDEXING_KEY after creating a project');
}
const documents = JSON.parse(await readFile(new URL('../fixtures/demo-documents.json', import.meta.url), 'utf8'));
const client = new SearchForge({ baseUrl: SEARCHFORGE_URL, projectId: SEARCHFORGE_PROJECT_ID,
  apiKey: SEARCHFORGE_INDEXING_KEY, indexSlug: process.env.SEARCHFORGE_INDEX_SLUG ?? 'docs' });
// Stable IDs make repeated runs upserts instead of duplicate documents.
const result = await client.indexDocuments(documents);
console.log(JSON.stringify({ event: 'demo.documents.queued', ...result }));
