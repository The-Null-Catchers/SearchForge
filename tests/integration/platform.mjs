import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

if (!process.env.POSTGRES_URL || !process.env.REDIS_URL) throw new Error('Integration tests require isolated PostgreSQL and Redis');
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET ??= 'integration-access-secret-32-characters-only';
process.env.JWT_REFRESH_SECRET ??= 'integration-refresh-secret-32-characters-only';
process.env.API_KEY_PEPPER ??= 'integration-api-key-pepper';
const storage = await mkdtemp(join(tmpdir(), 'sf-integration-'));
process.env.INDEX_STORAGE_PATH = storage;
const require = createRequire(new URL('../../packages/queue/package.json', import.meta.url));
const { Worker } = require('bullmq');
const { buildServer } = await import('../../apps/api/dist/server.js');
const { CrawlRunner } = await import('../../apps/crawler/dist/crawler.js');
const { IndexBuilder } = await import('../../apps/indexer/dist/index-builder.js');
const { createDatabase } = await import('../../packages/db/dist/index.js');
const { createRedisConnection, JobDispatcher, JobCancelled, finishCancelled } = await import('../../packages/queue/dist/index.js');
const { SearchForge } = await import('../../packages/sdk-js/dist/index.js');
const { config } = await import('../../apps/api/dist/config.js');
const { AuthService } = await import('../../apps/api/dist/auth.js');
const { db, pool } = createDatabase(process.env.POSTGRES_URL);
const redis = createRedisConnection(process.env.REDIS_URL);
const builder = new IndexBuilder(db, redis, storage);
const worker = new Worker('index', async job => {
  try { return await builder.build(job.data.databaseJobId, job.data.projectId, job.data.indexId); }
  catch (error) { if (!(error instanceof JobCancelled)) throw error; await finishCancelled(db, job.data.databaseJobId); return { cancelled: true }; }
}, { connection: redis, concurrency: 2 });
worker.on('error', error => console.error(error));
const app = await buildServer();
let organizationId;
let otherUserId;
let site;
const { createQueues } = await import("../../packages/queue/dist/index.js");
const queues = createQueues(redis);
const dispatcher = new JobDispatcher(db, queues);
let dispatching;
let timer;
function startDispatch() { timer = setInterval(() => {
  if (!dispatching) dispatching = dispatcher.dispatch().catch(error => console.error(error)).finally(() => { dispatching = undefined; });
}, 100); }
startDispatch();

async function request(method, url, payload, token) {
  const response = await app.inject({ method, url, ...(payload ? { payload } : {}),
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}) });
  assert.ok(response.statusCode < 400, `${method} ${url}: ${response.statusCode} ${response.body}`);
  return response.statusCode === 204 ? undefined : response.json();
}
async function waitJob(id, token) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const job = await request('GET', `/v1/jobs/${id}`, undefined, token);
    if (job.state === 'completed') return job;
    assert.notEqual(job.state, 'failed', job.errorMessage);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Job timed out: ${id}`);
}

try {
  await worker.waitUntilReady();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const suffix = randomUUID().slice(0, 8);
  const owner = await request('POST', '/v1/auth/register', { email: `owner-${suffix}@example.com`, password: 'integration-password-123' });
  const stranger = await request('POST', '/v1/auth/register', { email: `stranger-${suffix}@example.com`, password: 'integration-password-123' });
  otherUserId = stranger.user.id;
  const org = await request('POST', '/v1/organizations', { name: 'Integration', slug: `integration-${suffix}` }, owner.accessToken);
  organizationId = org.id;
  const project = await request('POST', `/v1/organizations/${org.id}/projects`, { name: 'Corpus', slug: 'corpus' }, owner.accessToken);
  const sdk = new SearchForge({ projectId: project.id, baseUrl: `http://127.0.0.1:${address.port}`, apiKey: project.adminKey });
  const search = new SearchForge({ projectId: project.id, baseUrl: `http://127.0.0.1:${address.port}`, apiKey: project.searchKey });
  const batch = await sdk.indexDocuments([
    { id: 'js', title: 'JavaScript search engine', content: 'Build distributed search systems', metadata: { category: 'docs' } },
    { id: 'ar', title: 'محرك البحث العربي', content: 'معالجة اللغة العربية والبحث', metadata: { category: 'docs' } },
    { id: 'db', title: 'Databases', content: 'Relational database systems', metadata: { category: 'blog' } }
  ]);
  await waitJob(batch.jobId, owner.accessToken);
  assert.equal((await search.search('javscript')).hits[0].id, 'js');
  assert.ok((await search.search('مُحَرِّك البحث')).hits.some(hit => hit.id === 'ar'));
  const result = await search.search('search', { facets: ['metadata.category'] });
  assert.equal(result.facets['metadata.category'].docs, 1);
  assert.ok((await search.autocomplete('java')).suggestions.length > 0);
  await search.trackClick({ query: result.query, documentId: result.hits[0].id, position: 1, searchEventId: result.searchEventId });
  await assert.rejects(search.upsertDocument({ id: 'forbidden' }), error => error.status === 403);

  // Guessing another tenant's UUID must not disclose its job or open a Redis stream.
  for (const url of [`/v1/jobs/${batch.jobId}`, `/v1/jobs/${batch.jobId}/events`]) {
    const denied = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${stranger.accessToken}` } });
    assert.equal(denied.statusCode, 404);
  }
  const versionBefore = result.indexVersion;
  const updated = await sdk.upsertDocument({ id: 'new', title: 'Atomic rebuild proof', content: 'search version test' });
  // Existing active version remains searchable while a replacement is queued/building.
  assert.ok((await search.search('javascript')).hits.length > 0);
  await waitJob(updated.jobId, owner.accessToken);
  assert.notEqual((await search.search('search')).indexVersion, versionBefore);
  const versions = await request('GET', `/v1/indexes/${project.index.id}/versions`, undefined, owner.accessToken);
  const old = versions.versions.find(version => String(version.sequence) === versionBefore);
  await request('POST', `/v1/indexes/${project.index.id}/versions/${old.id}/activate`, {}, owner.accessToken);
  assert.equal((await search.search('search')).indexVersion, versionBefore);

  // Trusted loopback fixture exercises real HTTP, extraction and incremental recrawl.
  let rootConditional = 0;
  let childConditional = 0;
  let childVersion = 1;
  let holdRoot = false;
  let heldResponse;
  let rootSeen;
  site = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *\nAllow: /'); return; }
    if (req.url === '/sitemap.xml') { res.writeHead(404); res.end(); return; }
    const child = req.url === '/child';
    if (holdRoot && !child) { heldResponse = res; rootSeen(); return; }
    const etag = child ? `"child-${childVersion}"` : '"root-1"';
    if (req.headers['if-none-match']) { if (child) childConditional++; else rootConditional++; }
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
    res.setHeader('content-type', 'text/html');
    res.setHeader('etag', etag);
    res.end(child
      ? `<html><title>Quantum telescopes</title><main>Galaxies planets observations spectroscopy universe astronomy version ${childVersion}</main></html>`
      : '<html><title>Compiler documentation</title><main>Lexical parsing abstract syntax trees optimization machine instructions</main><a href="/child">Astronomy</a></html>');
  });
  await new Promise(resolve => site.listen(0, '127.0.0.1', resolve));
  const source = await request('POST', `/v1/projects/${project.id}/sources`, {
    name: 'Fixture', config: { startUrls: [`http://127.0.0.1:${site.address().port}`], maxPages: 10, maxDepth: 2 }
  }, owner.accessToken);
  const runner = new CrawlRunner(db, redis, 'SearchForgeBot/1.0', true);
  async function crawl() {
    const { jobId } = await request('POST', `/v1/sources/${source.id}/crawl`, {}, owner.accessToken);
    // No crawl worker is running here: invoke its real processor directly.
    const result = await runner.run(jobId, source.id, project.id);
    if (result.indexJobId) await waitJob(result.indexJobId, owner.accessToken);
    return result;
  }
  assert.equal((await crawl()).indexed, 2);
  childVersion = 2;
  const incremental = await crawl();
  assert.equal(rootConditional, 1);
  assert.equal(childConditional, 1); // Found through the stored links of the 304 root.
  assert.equal(incremental.indexed, 1);
  const unchanged = await crawl();
  assert.equal(unchanged.indexed, 0);
  assert.equal(unchanged.indexJobId, undefined);


  // Outbox survives an interrupted Redis enqueue and duplicate dispatch attempts.
  await worker.pause();
  clearInterval(timer);
  await dispatching;
  await dispatcher.dispatch(100);
  const queued = await sdk.upsertDocument({ id: 'cancelled-doc', content: 'pending mutation' });
  const failedDispatcher = new JobDispatcher(db, { ...queues, index: {
    add: async (...args) => { await queues.index.add(...args); throw new Error('Injected interruption after Redis accepted job'); }
  } });
  await assert.rejects(failedDispatcher.dispatch(), /Injected interruption/);
  const entry = (await pool.query('SELECT dispatched_at FROM job_outbox WHERE job_id = $1', [queued.jobId])).rows[0];
  assert.equal(entry.dispatched_at, null);
  await dispatcher.dispatch();
  const matching = (await queues.index.getJobs(['waiting', 'paused', 'prioritized'])).filter(job => job.data.databaseJobId === queued.jobId);
  assert.equal(matching.length, 1);
  startDispatch();
  const inaccessible = await app.inject({ method: 'POST', url: `/v1/jobs/${queued.jobId}/cancel`, headers: { authorization: `Bearer ${stranger.accessToken}` } });
  assert.equal(inaccessible.statusCode, 404);
  const cancelled = await request('POST', `/v1/jobs/${queued.jobId}/cancel`, {}, owner.accessToken);
  assert.equal(cancelled.state, 'cancelled');
  const count = await pool.query('SELECT count(*) FROM audit_logs WHERE action = $1 AND target_id = $2', ['job.cancel_requested', queued.jobId]);
  await request('POST', `/v1/jobs/${queued.jobId}/cancel`, {}, owner.accessToken);
  assert.equal((await pool.query('SELECT count(*) FROM audit_logs WHERE action = $1 AND target_id = $2', ['job.cancel_requested', queued.jobId])).rows[0].count, count.rows[0].count);
  await worker.resume();
  assert.equal((await search.search('search')).indexVersion, String((await request('GET', `/v1/indexes/${project.index.id}/versions`, undefined, owner.accessToken)).versions.find(v => v.state === 'active').sequence));

  // Cancel after writing a real segment, before atomic activation: old version stays active.
  const versionBeforeCancel = (await search.search('search')).indexVersion;
  let releaseWrite;
  let written;
  const writeGate = new Promise(resolve => { releaseWrite = resolve; });
  const writeSeen = new Promise(resolve => { written = resolve; });
  const originalWrite = builder.store.write.bind(builder.store);
  builder.store.write = async (...args) => { const key = await originalWrite(...args); written(); await writeGate; return key; };
  const building = await sdk.upsertDocument({ id: 'cancel-at-activation', content: 'candidate version' });
  await writeSeen;
  assert.equal((await request('POST', `/v1/jobs/${building.jobId}/cancel`, {}, owner.accessToken)).state, 'running');
  releaseWrite();
  builder.store.write = originalWrite;
  for (let i = 0; i < 150; i++) {
    if ((await request('GET', `/v1/jobs/${building.jobId}`, undefined, owner.accessToken)).state === 'cancelled') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal((await request('GET', `/v1/jobs/${building.jobId}`, undefined, owner.accessToken)).state, 'cancelled');
  assert.equal((await search.search('search')).indexVersion, versionBeforeCancel);

  // A running crawl cancellation waits for its bounded in-flight fetch, then stops.
  holdRoot = true;
  const rootGate = new Promise(resolve => { rootSeen = resolve; });
  const crawlToCancel = await request('POST', `/v1/sources/${source.id}/crawl`, {}, owner.accessToken);
  const pendingCrawl = runner.run(crawlToCancel.jobId, source.id, project.id);
  const cancellationAssertion = assert.rejects(pendingCrawl, error => error instanceof JobCancelled);
  await rootGate;
  await request('POST', `/v1/jobs/${crawlToCancel.jobId}/cancel`, {}, owner.accessToken);
  heldResponse.setHeader('content-type', 'text/html');
  heldResponse.end('<main>Cancelled page must not activate a new index</main>');
  await cancellationAssertion;
  await finishCancelled(db, crawlToCancel.jobId);
  holdRoot = false;
  assert.equal((await request('GET', `/v1/jobs/${crawlToCancel.jobId}`, undefined, owner.accessToken)).state, 'cancelled');

  // Schedule survives process replacement and concurrent ticks enqueue only once.
  const scheduleDenied = await app.inject({ method: 'PUT', url: `/v1/sources/${source.id}/schedule`, payload: { enabled: true, intervalSeconds: 3600 }, headers: { authorization: `Bearer ${stranger.accessToken}` } });
  assert.equal(scheduleDenied.statusCode, 403);
  const invalidSchedule = await app.inject({ method: 'PUT', url: `/v1/sources/${source.id}/schedule`, payload: { enabled: true, intervalSeconds: 1 }, headers: { authorization: `Bearer ${owner.accessToken}` } });
  assert.equal(invalidSchedule.statusCode, 400);
  await request('PUT', `/v1/sources/${source.id}/schedule`, { enabled: true, intervalSeconds: 3600 }, owner.accessToken);
  const due = new Date(Date.now() + 3_601_000);
  const restartedDispatcher = new JobDispatcher(db, queues);
  assert.equal((await Promise.all([restartedDispatcher.schedule(due), dispatcher.schedule(due)])).reduce((a, b) => a + b, 0), 1);
  const scheduledJob = (await pool.query("SELECT id FROM jobs WHERE source_id = $1 AND type = 'crawl' AND state = 'queued'", [source.id])).rows;
  assert.equal(scheduledJob.length, 1);
  const manual = await request('POST', `/v1/sources/${source.id}/crawl`, {}, owner.accessToken);
  assert.equal(manual.jobId, scheduledJob[0].id);
  await request('POST', `/v1/jobs/${manual.jobId}/cancel`, {}, owner.accessToken);
  await request('PUT', `/v1/sources/${source.id}/schedule`, { enabled: false, intervalSeconds: 3600 }, owner.accessToken);
  assert.equal(await dispatcher.schedule(new Date(due.getTime() + 7_200_000)), 0);
  const finishedCancel = await app.inject({ method: 'POST', url: `/v1/jobs/${batch.jobId}/cancel`, headers: { authorization: `Bearer ${owner.accessToken}` } });
  assert.equal(finishedCancel.statusCode, 409);

  // Concurrent refreshes serialize: one rotates; the reuse attempt revokes its family.
  const auth = new AuthService(db, config);
  const session = await auth.login(`owner-${suffix}@example.com`, 'integration-password-123');
  const races = await Promise.allSettled([auth.refresh(session.refreshToken), auth.refresh(session.refreshToken)]);
  assert.equal(races.filter(result => result.status === 'fulfilled').length, 1);
  const winner = races.find(result => result.status === 'fulfilled').value;
  await assert.rejects(auth.refresh(winner.refreshToken), /reuse detected/);
  console.log('PASS: registration, tenants, async indexing, JS SDK, Arabic/English, typos, facets, autocomplete, clicks, rebuild, rollback, incremental crawl, durable schedules, cancellation and refresh reuse');
} finally {
  clearInterval(timer);
  await dispatching;
  if (site) { site.closeAllConnections(); await new Promise(resolve => site.close(resolve)); }
  await worker.close();
  await Promise.all(Object.values(queues).map(queue => queue.close()));
  await app.close();
  if (organizationId) await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
  // This test suite is for disposable service databases only.
  if (otherUserId) await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
  await redis.quit();
  await pool.end();
  await rm(storage, { recursive: true, force: true });
}
