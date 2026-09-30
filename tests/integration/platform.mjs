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
let viewerId;
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



  // Console explorer reads real active postings and paginates without repeating IDs.
  const consoleBase = `/v1/console/indexes/${project.index.id}`;
  const firstDocuments = await request('GET', `${consoleBase}/documents?limit=2`, undefined, owner.accessToken);
  assert.equal(firstDocuments.documents.length, 2);
  assert.ok(firstDocuments.nextAfter);
  const secondDocuments = await request('GET', `${consoleBase}/documents?limit=2&after=${encodeURIComponent(firstDocuments.nextAfter)}`, undefined, owner.accessToken);
  assert.ok(secondDocuments.documents.every(row => !firstDocuments.documents.some(first => first.documentId === row.documentId)));
  const inspected = await request('GET', `${consoleBase}/documents/js`, undefined, owner.accessToken);
  assert.equal(inspected.state, 'indexed');
  assert.ok(inspected.terms.some(term => term.term === 'javascript' && term.field === 'title' && term.frequency === 1 && term.positions.includes(0)));
  const filteredDocuments = await request('GET', `${consoleBase}/documents?q=JavaScript`, undefined, owner.accessToken);
  assert.deepEqual(filteredDocuments.documents.map(row => row.documentId), ['js']);
  const deniedDocuments = await app.inject({ method: 'GET', url: `${consoleBase}/documents`, headers: { authorization: `Bearer ${stranger.accessToken}` } });
  assert.equal(deniedDocuments.statusCode, 403);
  const missingDocument = await app.inject({ method: 'GET', url: `${consoleBase}/documents/missing`, headers: { authorization: `Bearer ${owner.accessToken}` } });
  assert.equal(missingDocument.statusCode, 404);

  // A viewer may inspect but cannot rebuild, delete or edit source rules.
  const viewer = await request('POST', '/v1/auth/register', { email: `viewer-${suffix}@example.com`, password: 'integration-password-123' });
  viewerId = viewer.user.id;
  await pool.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, 'viewer')", [organizationId, viewerId]);
  assert.equal((await request('GET', `${consoleBase}/documents/js`, undefined, viewer.accessToken)).state, 'indexed');
  for (const [method, url, payload] of [['POST', `${consoleBase}/rebuild`, undefined], ['DELETE', `${consoleBase}/documents/js`, undefined],
    ['PUT', `/v1/sources/${source.id}`, { name: source.name, config: source.config }]]) {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}), headers: { authorization: `Bearer ${viewer.accessToken}` } });
    assert.equal(response.statusCode, 403);
  }

  // Source rule validation and audit are exercised without weakening robots enforcement.
  const invalidRules = await app.inject({ method: 'PUT', url: `/v1/sources/${source.id}`, payload: { name: 'Unsafe', config: { ...source.config, respectRobots: false } }, headers: { authorization: `Bearer ${owner.accessToken}` } });
  assert.equal(invalidRules.statusCode, 400);
  const rules = await request('PUT', `/v1/sources/${source.id}`, { name: 'Fixture updated', config: { ...source.config, maxDepth: 1, exclude: ['/private/**'] } }, owner.accessToken);
  assert.equal(rules.config.maxDepth, 1);
  assert.equal(rules.config.respectRobots, true);
  assert.equal((await pool.query("SELECT count(*) FROM audit_logs WHERE action = 'source.rules_updated' AND target_id = $1", [source.id])).rows[0].count, '1');
  await pool.query("UPDATE crawl_pages SET created_at = '2026-01-01T12:00:00.123456Z' WHERE source_id = $1", [source.id]);
  const crawlFirst = await request('GET', `/v1/sources/${source.id}/pages?limit=1`, undefined, owner.accessToken);
  const crawlSecond = await request('GET', `/v1/sources/${source.id}/pages?limit=1&cursor=${crawlFirst.nextCursor}`, undefined, owner.accessToken);
  assert.notEqual(crawlFirst.pages[0].id, crawlSecond.pages[0].id);
  const changedCursor = await app.inject({ method: 'GET', url: `/v1/sources/${source.id}/pages?limit=1&status=failed&cursor=${crawlFirst.nextCursor}`, headers: { authorization: `Bearer ${owner.accessToken}` } });
  assert.equal(changedCursor.statusCode, 400);
  const unchangedPages = await request('GET', `/v1/sources/${source.id}/pages?status=unchanged`, undefined, owner.accessToken);
  assert.ok(unchangedPages.pages.length > 0 && unchangedPages.pages.every(page => page.status === 'unchanged'));

  // Deletion commits its rebuild atomically; current active search remains until publication.
  await worker.pause();
  const versionBeforeDelete = (await search.search('search')).indexVersion;
  const removal = await request('DELETE', `${consoleBase}/documents/db`, undefined, owner.accessToken);
  const deleted = await request('GET', `${consoleBase}/documents/db`, undefined, owner.accessToken);
  assert.equal(deleted.state, 'deleted');
  assert.equal(deleted.inActiveVersion, true);
  assert.equal((await search.search('search')).indexVersion, versionBeforeDelete);
  await worker.resume();
  await waitJob(removal.jobId, owner.accessToken);
  assert.equal((await request('GET', `${consoleBase}/documents/db`, undefined, owner.accessToken)).inActiveVersion, false);
  assert.ok((await request('GET', `${consoleBase}/documents?status=deleted`, undefined, owner.accessToken)).documents.some(row => row.documentId === 'db'));
  const rebuild = await request('POST', `${consoleBase}/rebuild`, {}, owner.accessToken);
  await waitJob(rebuild.jobId, owner.accessToken);

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
  // Redis loss after acknowledged delivery is repaired without replaying live jobs.
  const redisJobId = matching[0].id;
  await matching[0].remove();
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '1 minute' WHERE job_id = $1", [queued.jobId]);
  const recoveries = await Promise.all([dispatcher.reconcile(), new JobDispatcher(db, queues).reconcile()]);
  assert.equal(recoveries.reduce((count, result) => count + result.recovered, 0), 1);
  assert.equal((await queues.index.getJob(redisJobId)).data.databaseJobId, queued.jobId);
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '1 minute' WHERE job_id = $1", [queued.jobId]);
  assert.equal((await dispatcher.reconcile()).recovered, 0);
  // A Redis outage rolls back the check timestamp so later ticks retry recovery.
  await (await queues.index.getJob(redisJobId)).remove();
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '1 minute' WHERE job_id = $1", [queued.jobId]);
  const unavailable = new JobDispatcher(db, { ...queues, index: {
    add: queues.index.add.bind(queues.index), getJob: async () => { throw new Error('Injected Redis outage'); }
  } });
  await assert.rejects(unavailable.reconcile(), /Injected Redis outage/);
  assert.equal((await dispatcher.reconcile()).recovered, 1);
  const healthyRecovery = await sdk.upsertDocument({ id: 'recovery-healthy', content: 'recovery fairness' });
  const lostRecovery = await sdk.upsertDocument({ id: 'recovery-lost', content: 'recovery fairness' });
  await dispatcher.dispatch();
  const recoveryIds = (await pool.query('SELECT id, external_job_id FROM jobs WHERE id = ANY($1::uuid[])', [[healthyRecovery.jobId, lostRecovery.jobId]])).rows;
  const lostRedisId = recoveryIds.find(row => row.id === lostRecovery.jobId).external_job_id;
  await (await queues.index.getJob(lostRedisId)).remove();
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '3 minutes' WHERE job_id = $1", [queued.jobId]);
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '2 minutes' WHERE job_id = $1", [healthyRecovery.jobId]);
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '1 minute' WHERE job_id = $1", [lostRecovery.jobId]);
  assert.equal((await dispatcher.reconcile(new Date(), 1)).recovered, 0);
  assert.equal((await dispatcher.reconcile(new Date(), 1)).recovered, 0);
  assert.equal((await dispatcher.reconcile(new Date(), 1)).recovered, 1);
  await pool.query("UPDATE jobs SET state = 'running' WHERE id = $1", [queued.jobId]);
  await (await queues.index.getJob(redisJobId)).remove();
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '1 minute' WHERE job_id = $1", [queued.jobId]);
  await dispatcher.reconcile();
  assert.equal(await queues.index.getJob(redisJobId), undefined);
  for (const terminal of ['completed', 'failed']) {
    await pool.query('UPDATE jobs SET state = $2 WHERE id = $1', [queued.jobId, terminal]);
    await dispatcher.reconcile();
    assert.equal(await queues.index.getJob(redisJobId), undefined);
  }
  await pool.query("UPDATE jobs SET state = 'queued' WHERE id = $1", [queued.jobId]);
  assert.equal((await dispatcher.reconcile()).recovered, 1);
  startDispatch();
  const inaccessible = await app.inject({ method: 'POST', url: `/v1/jobs/${queued.jobId}/cancel`, headers: { authorization: `Bearer ${stranger.accessToken}` } });
  assert.equal(inaccessible.statusCode, 404);
  const cancelled = await request('POST', `/v1/jobs/${queued.jobId}/cancel`, {}, owner.accessToken);
  assert.equal(cancelled.state, 'cancelled');
  await (await queues.index.getJob(redisJobId)).remove();
  await pool.query("UPDATE job_outbox SET updated_at = now() - interval '1 minute' WHERE job_id = $1", [queued.jobId]);
  await dispatcher.reconcile();
  assert.equal(await queues.index.getJob(redisJobId), undefined);
  const count = await pool.query('SELECT count(*) FROM audit_logs WHERE action = $1 AND target_id = $2', ['job.cancel_requested', queued.jobId]);
  await request('POST', `/v1/jobs/${queued.jobId}/cancel`, {}, owner.accessToken);
  assert.equal((await pool.query('SELECT count(*) FROM audit_logs WHERE action = $1 AND target_id = $2', ['job.cancel_requested', queued.jobId])).rows[0].count, count.rows[0].count);
  await worker.resume();
  await waitJob(healthyRecovery.jobId, owner.accessToken);
  await waitJob(lostRecovery.jobId, owner.accessToken);
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
  console.log('PASS: registration, tenants, async indexing, JS SDK, Arabic/English, typos, facets, autocomplete, clicks, rebuild, rollback, incremental crawl, durable schedules, explorers, source rules, cancellation and refresh reuse');
} finally {
  clearInterval(timer);
  await dispatching;
  if (site) { site.closeAllConnections(); await new Promise(resolve => site.close(resolve)); }
  await worker.close();
  await Promise.all(Object.values(queues).map(queue => queue.close()));
  await app.close();
  if (organizationId) await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
  // This test suite is for disposable service databases only.
  if (viewerId) await pool.query('DELETE FROM users WHERE id = $1', [viewerId]);
  if (otherUserId) await pool.query('DELETE FROM users WHERE id = $1', [otherUserId]);
  await redis.quit();
  await pool.end();
  await rm(storage, { recursive: true, force: true });
}
