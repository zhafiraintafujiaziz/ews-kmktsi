import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase } from '../server/database.ts';
import { createRepository } from '../server/repository.ts';
import { createHandler, type Resource } from '../server/handlers.ts';
import { normalizeAdapterAlert } from '../src/domain/disasterRecord.ts';
import { AlertSnapshotSchema, BrowserImportSchema, ReportSchema, type BrowserImport } from '../src/domain/persistence.ts';
import { readBrowserImport, persistAlertHistory, loadAlertSnapshots, persistAlertSnapshot } from '../src/services/persistenceService.ts';
import { applyAlertSnapshots } from '../src/domain/alertCache.ts';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const report = ReportSchema.parse({
  id: 'legacy-report-1', createdAt: '2026-10-01T01:00:00.000Z',
  officeId: 'test-office', officeName: 'Synthetic office', sumberGangguan: 'Banjir',
  lokasi: 'Synthetic location', penyebab: 'Synthetic cause', dampak: 'Synthetic impact',
  dampakGedung: '', evakuasi: false, responCepat: 'Synthetic response',
});
const checklist = { officeId: 'test-office', itemId: 'jalur-evakuasi', checked: true };
const record = normalizeAdapterAlert({
  id: 'synthetic-alert', type: 'volcanic_ash', severity: 2, provinceId: 'ID-JB',
  title: 'Synthetic ash', description: 'Synthetic fixture', timestamp: '2026-10-01T01:00:00.000Z',
  sourceGeometry: { type: 'Polygon', coordinates: [[[100, 0], [101, 0], [101, 1], [100, 0]]] },
}, 'synthetic-feed', '2026-10-01T01:05:00.000Z');

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'ews-db-test-'));
  const url = `file:${join(directory, 'test.sqlite').replaceAll('\\', '/')}`;
  let connection = createDatabase({ url });
  await migrate(connection.db, { migrationsFolder });
  t.after(async () => {
    connection.client.close();
    // libSQL's native prepared statements release Windows handles on collection.
    globalThis.gc?.();
    // Only remove this test's own generated directory under the OS temp folder.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'ews-db-test-')));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return {
    get connection() { return connection; },
    get repository() { return createRepository(connection); },
    async reopen() {
      connection.client.close();
      connection = createDatabase({ url });
      await migrate(connection.db, { migrationsFolder });
    },
  };
}

async function startApi(t: TestContext, store: ReturnType<typeof createRepository>) {
  const handlers = new Map<Resource, ReturnType<typeof createHandler>>(
    (['reports', 'checklist', 'alerts', 'import', 'alert-cache'] as const).map(resource => [resource, createHandler(resource, store)]),
  );
  const server = createServer((req, res) => {
    const resource = new URL(req.url || '/', 'http://localhost').pathname.split('/').pop() as Resource;
    const handler = handlers.get(resource);
    if (handler) void handler(req, res);
    else { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise<void>((done, reject) => {
    server.close(error => error ? reject(error) : done());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url,
    request(path: string, method = 'GET', body?: unknown) {
      return fetch(url + path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    },
  };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
  };
}

test('reports, checklist values, and alert payloads survive closing and reopening the file; migrations are repeatable', async t => {
  const db = await fixture(t);
  await db.repository.saveReport(report);
  await db.repository.saveChecklist(checklist);
  await db.repository.ingestAlerts([record]);
  await db.reopen();
  assert.deepEqual(await db.repository.listReports(), [report]);
  assert.equal((await db.repository.listChecklist())[0].checked, true);
  assert.deepEqual((await db.repository.listAlerts())[0].record, record);
});

test('report retries are immutable and browser imports never overwrite newer database values', async t => {
  const db = await fixture(t);
  const input = BrowserImportSchema.parse({ browserId: randomUUID(), reports: [report], checklistItems: [checklist] });
  assert.deepEqual(await db.repository.importBrowserData(input), { imported: true });
  await db.repository.saveChecklist({ ...checklist, checked: false });
  assert.deepEqual(await db.repository.importBrowserData(input), { imported: false });
  await db.repository.importBrowserData({ ...input, browserId: randomUUID() });
  assert.equal((await db.repository.listChecklist())[0].checked, false);
  await db.repository.saveReport({ ...report, dampak: 'A retried request must not replace the original' });
  assert.deepEqual(await db.repository.listReports(), [report]);
});

test('an unsuccessful browser import rolls back its receipt and can be retried', async t => {
  const db = await fixture(t);
  const input = { browserId: randomUUID(), reports: [report], checklistItems: [checklist] };
  const broken = { ...input, checklistItems: [{ ...checklist, officeId: null }] } as unknown as BrowserImport;
  await assert.rejects(db.repository.importBrowserData(broken));
  assert.deepEqual(await db.repository.listReports(), []);
  assert.deepEqual(await db.repository.importBrowserData(input), { imported: true });
  assert.equal((await db.repository.listChecklist()).length, 1);
});

test('alert history deduplicates revisions, preserves the first payload, and tracks later sightings', async t => {
  const db = await fixture(t);
  await db.repository.ingestAlerts([record, record]);
  const [first] = await db.repository.listAlerts();
  await db.repository.ingestAlerts([{ ...record, title: 'Repeat must not rewrite original payload' }]);
  const [repeated] = await db.repository.listAlerts();
  assert.equal(repeated.firstSeenAt, first.firstSeenAt);
  assert.ok(repeated.lastSeenAt >= first.lastSeenAt);
  assert.deepEqual(repeated.record.location.sourceGeometry, record.location.sourceGeometry);
  assert.deepEqual(repeated.record.provenance.rawRecord, record.provenance.rawRecord);
  assert.equal(repeated.record.title, record.title);
  await db.repository.ingestAlerts([
    { ...record, revision: 'revision-2', title: 'New revision' },
    { ...record, provenance: { ...record.provenance, feed: 'other-feed' } },
  ]);
  assert.equal((await db.repository.listAlerts()).length, 3);
  assert.equal((await db.repository.listAlerts(100, 0, 'synthetic-feed')).length, 2);
  await db.reopen();
  assert.equal((await db.repository.listAlerts()).length, 3);
});

test('HTTP endpoints validate requests, persist data, paginate history, and report database failures', async t => {
  const db = await fixture(t);
  const api = await startApi(t, db.repository);
  assert.equal((await api.request('/api/reports', 'POST', { ...report, officeId: '' })).status, 400);
  assert.equal((await api.request('/api/checklist', 'PUT', { ...checklist, checked: 'true' })).status, 400);
  assert.equal((await api.request('/api/alerts', 'POST', { records: [{ ...record, provenance: null }] })).status, 400);
  assert.equal((await api.request('/api/reports?limit=101')).status, 400);
  assert.equal((await api.request('/api/checklist', 'POST', checklist)).status, 405);
  assert.equal((await fetch(api.url + '/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(api.url + '/api/reports', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(api.url + '/api/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' }, body: JSON.stringify(report),
  })).status, 403);
  assert.equal((await fetch(api.url + '/api/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ large: 'x'.repeat(4 * 1024 * 1024) }),
  })).status, 413);
  assert.equal((await api.request('/api/reports', 'POST', report)).status, 200);
  assert.equal((await api.request('/api/checklist', 'PUT', checklist)).status, 200);
  await api.request('/api/alerts', 'POST', { records: [record, { ...record, revision: 'revision-2' }] });
  assert.deepEqual((await (await api.request('/api/reports')).json()).reports, [report]);
  assert.equal((await (await api.request('/api/checklist')).json()).items[0].checked, true);
  assert.equal((await (await api.request('/api/alerts?limit=1&offset=1&feed=synthetic-feed')).json()).records.length, 1);
  db.connection.client.close();
  const failed = await api.request('/api/reports');
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /Database unavailable/);
  assert.equal((await api.request('/api/reports', 'POST', {})).status, 400);
});

test('the new database endpoints are disabled on Vercel before authentication exists', async t => {
  const db = await fixture(t);
  const api = await startApi(t, db.repository);
  const previous = process.env.VERCEL;
  try {
    process.env.VERCEL = '1';
    assert.equal((await api.request('/api/reports', 'POST', report)).status, 503);
    assert.equal((await api.request('/api/checklist')).status, 503);
    assert.equal((await db.repository.listReports()).length, 0);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});

test('legacy browser parsing retains original data and produces stable IDs across reloads', () => {
  const { createdAt, ...fields } = report;
  const rawReports = JSON.stringify([{ ...fields, timestamp: createdAt }]);
  const rawChecklist = JSON.stringify({ [checklist.officeId]: { [checklist.itemId]: true } });
  const storage = memoryStorage({ 'ews-mktbi:laporan-kpw': rawReports, 'ews-mktbi:kpw-checklist': rawChecklist });
  const first = readBrowserImport(storage);
  assert.deepEqual(readBrowserImport(storage), first);
  assert.deepEqual(first.reports, [report]);
  assert.deepEqual(first.checklistItems, [checklist]);
  assert.equal(storage.getItem('ews-mktbi:laporan-kpw'), rawReports);
  assert.equal(storage.getItem('ews-mktbi:kpw-checklist'), rawChecklist);
  storage.setItem('ews-mktbi:laporan-kpw', 'invalid JSON');
  assert.throws(() => readBrowserImport(storage));
  assert.equal(storage.getItem('ews-mktbi:laporan-kpw'), 'invalid JSON');
});

test('frontend imports retry after failure, survive a reload, and read confirmed database values', async t => {
  const db = await fixture(t);
  const api = await startApi(t, db.repository);
  const { createdAt, ...fields } = report;
  const legacy = JSON.stringify([{ ...fields, timestamp: createdAt }]);
  const storage = memoryStorage({
    'ews-mktbi:laporan-kpw': legacy,
    'ews-mktbi:kpw-checklist': JSON.stringify({ [checklist.officeId]: { [checklist.itemId]: true } }),
  });
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });
  const nativeFetch = globalThis.fetch;
  let fail = true;
  t.mock.method(globalThis, 'fetch', (path: string | URL | Request, options?: RequestInit) => {
    if (fail) return Promise.resolve(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }));
    return nativeFetch(api.url + String(path), options);
  });
  const service = await import('../src/services/persistenceService.ts?initial');
  await assert.rejects(service.initializePersistence());
  assert.equal(storage.getItem('ews-mktbi:laporan-kpw'), legacy);
  fail = false;
  await Promise.all([service.initializePersistence(), service.initializePersistence()]);
  assert.deepEqual(await service.loadReports(), [report]);
  assert.deepEqual(await service.loadChecklist(), [checklist]);
  assert.deepEqual(await service.saveChecklist({ ...checklist, checked: false }), { ...checklist, checked: false });
  const newer = { ...report, id: 'new-report' };
  assert.deepEqual(await service.saveReport(newer), newer);
  fail = true;
  await assert.rejects(service.saveChecklist(checklist));
  assert.equal((await db.repository.listChecklist())[0].checked, false);
  fail = false;
  const reloaded = await import('../src/services/persistenceService.ts?reloaded');
  assert.equal((await reloaded.loadReports()).length, 2);
  assert.equal((await reloaded.loadChecklist())[0].checked, false);
  assert.equal(storage.getItem('ews-mktbi:laporan-kpw'), legacy);
});

test('history writes propagate failures and stop sending additional batches after dashboard cancellation', async t => {
  let writes = 0;
  const controller = new AbortController();
  t.mock.method(globalThis, 'fetch', () => {
    writes++;
    controller.abort();
    return Promise.resolve(new Response(JSON.stringify({ accepted: 20 }), { status: 200 }));
  });
  await assert.rejects(persistAlertHistory(Array.from({ length: 21 }, () => record), controller.signal));
  assert.equal(writes, 1);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response('{}', { status: 503 })));
  await assert.rejects(persistAlertHistory([record]));
});

test('complete feed snapshots survive restart, resist older writes, and preserve a successful empty response', async t => {
  const db = await fixture(t);
  const snapshot = { feed: 'synthetic-feed', checkedAt: '2026-10-01T01:05:00.000Z', records: [record] };
  await db.repository.ingestAlerts([record]);
  await db.repository.saveAlertSnapshot(snapshot);
  await db.reopen();
  assert.deepEqual(await db.repository.listAlertSnapshots(), [snapshot]);
  const empty = { ...snapshot, checkedAt: '2026-10-01T01:06:00.000Z', records: [] };
  await db.repository.saveAlertSnapshot(empty);
  await db.repository.saveAlertSnapshot(snapshot);
  await db.reopen();
  assert.deepEqual(await db.repository.listAlertSnapshots(), [empty]);
  assert.equal((await db.repository.listAlerts()).length, 1, 'clearing current data must retain history');
});

test('cache hydration filters stale, future, malformed, and unknown feeds without replacing live results', () => {
  const now = Date.parse('2026-10-06T10:00:00.000Z');
  const make = (id: string, timestamp: string, feed = 'earthquakes') => normalizeAdapterAlert({
    id, type: 'earthquake', severity: 2, provinceId: 'ID-JB', title: id,
    description: 'Synthetic fixture', timestamp,
  }, feed);
  const fresh = make('fresh', '2026-10-06T09:00:00.000Z');
  const expired = make('expired', '2026-10-04T09:00:00.000Z');
  const future = make('future', '2026-10-07T09:00:00.000Z');
  const malformed = { ...fresh, details: {} };
  const snapshot = { feed: 'earthquakes', checkedAt: '2026-10-06T09:05:00.000Z', records: [fresh, expired, future, malformed] };
  const records = new Map();
  const known = new Set(['earthquakes', 'forecast']);
  const cached = applyAlertSnapshots(records, [snapshot, { ...snapshot, feed: 'unknown' }], new Set(), known, now);
  assert.deepEqual(records.get('earthquakes'), [fresh]);
  assert.deepEqual([...cached], [['earthquakes', snapshot.checkedAt]]);
  assert.equal(records.has('unknown'), false);
  const newer = make('newer-live', '2026-10-06T09:30:00.000Z');
  records.set('earthquakes', [newer]);
  assert.equal(applyAlertSnapshots(records, [snapshot], new Set(['earthquakes']), known, now).size, 0);
  assert.deepEqual(records.get('earthquakes'), [newer]);
  records.set('earthquakes', []);
  applyAlertSnapshots(records, [snapshot], new Set(['earthquakes']), known, now);
  assert.deepEqual(records.get('earthquakes'), [], 'a late cache response must respect a successful empty live feed');
  const staleOnly = { ...snapshot, records: [expired] };
  assert.equal(applyAlertSnapshots(new Map(), [staleOnly], new Set(), known, now).size, 0);
  const warning = normalizeAdapterAlert({ id: 'warning', type: 'extreme_weather', severity: 2, provinceId: 'ID-JB', title: 'Warning', description: '', timestamp: '2026-10-05T09:00:00.000Z', validUntil: '2026-10-06T11:00:00.000Z' }, 'forecast');
  const warnings = new Map();
  applyAlertSnapshots(warnings, [{ feed: 'forecast', checkedAt: snapshot.checkedAt, records: [warning] }], new Set(), known, now);
  assert.deepEqual(warnings.get('forecast'), [warning], 'source expiry, rather than cache age, controls eligibility');
});

test('snapshot API and frontend loader validate complete feeds, support more than 100 records, and isolate cache failures', async t => {
  const db = await fixture(t);
  const api = await startApi(t, db.repository);
  const snapshot = { feed: 'synthetic-feed', checkedAt: '2026-10-01T01:05:00.000Z', records: Array.from({ length: 101 }, (_, index) => ({ ...record, id: `synthetic-${index}` })) };
  assert.equal((await api.request('/api/alert-cache', 'POST', { ...snapshot, feed: 'wrong-feed' })).status, 400);
  assert.equal((await api.request('/api/alert-cache', 'POST', { ...snapshot, checkedAt: 'not-a-date' })).status, 400);
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (path: string | URL | Request, options?: RequestInit) => nativeFetch(api.url + String(path), options));
  assert.deepEqual(await loadAlertSnapshots(), [], 'an empty database supports the usual live first load');
  await persistAlertSnapshot(snapshot);
  const snapshots = await loadAlertSnapshots();
  assert.equal(snapshots[0].records.length, 101);
  assert.deepEqual(AlertSnapshotSchema.parse(snapshots[0]), snapshot);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(loadAlertSnapshots(aborted.signal));
  db.connection.client.close();
  await assert.rejects(loadAlertSnapshots());
  await assert.rejects(persistAlertSnapshot(snapshot));
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(new Response(JSON.stringify({ snapshots: [{ ...snapshot, records: [{}] }] }), { status: 200 })));
  await assert.rejects(loadAlertSnapshots(), 'invalid cache payloads must never enter live state');
});
