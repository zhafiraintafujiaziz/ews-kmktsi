import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildIspuHistoryWorkbook } from '../src/utils/ispuHistoryExport.ts';
import test, { type TestContext } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase, databaseConfig } from '../server/database.ts';
import { createIspuStore, type IspuStore } from '../server/ispuStore.ts';
import { createIspuCollector } from '../server/ispuCollector.ts';
import { createIspuHandler } from '../server/ispuHandler.ts';
import { ISPU_SOURCE_URL, numericValue, parseSourceTime, parseStationResponse, wibDate } from '../server/ispuParser.ts';
import { exportIspuCsv, queryIspuTimeSeries, queryIspuHistorySeries, queryIspuHistoryExport, queryIspuRankings, readIspuHistory } from '../server/ispuHistory.ts';
import { buildIspuRankings, ispuCityKey, ispuDateRange, nearestArchivedStation, validateHistoryRange, wibToday } from '../src/domain/ispuHistory.ts';
import type { IspuQualityFlag } from '../src/domain/ispuHistory.ts';
import { createIspuHistoryHandler } from '../server/ispuHistoryHandler.ts';
import { requestIspuHistory } from '../src/services/ispuHistoryClient.ts';
import { ispuChartScale, ispuChartSegments, ispuStationColor } from '../src/utils/ispuChart.ts';

const NOW = Date.parse('2026-10-15T01:30:00Z');
const DATE = '2026-10-15';
const RANGE = { from: DATE, to: DATE };
const station = (extra: Record<string, unknown> = {}) => ({ id_stasiun: 'JAKARTA', nama: 'Jakarta', kota: 'Jakarta', provinsi: 'DKI Jakarta',
  val: '42', lat: '-6.2', lon: '106.8', waktu: '2026-10-15 08:00:00', waktu_text: '15-Oktober-2026 08:00:00', time_z: 'WIB', param: 'PM<sub>2.5</sub>', ...extra });
const feed = (...rows: unknown[]) => ({ status: 'success', rows });
const reply = (...rows: unknown[]) => Response.json(feed(...rows));
const quiet = () => {};

function environment(t: TestContext, values: Record<string, string>) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'ews-ispu-test-'));
  const url = 'file:' + join(directory, 'archive.sqlite').replaceAll('\\', '/');
  let connection = createDatabase({ url });
  const extraConnections: ReturnType<typeof createDatabase>[] = [];
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await migrate(connection.db, { migrationsFolder });
  t.after(async () => {
    for (const other of extraConnections) other.client.close();
    connection.client.close(); globalThis.gc?.();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'ews-ispu-test-')));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return {
    get connection() { return connection; }, get store() { return createIspuStore(connection); },
    async reopen() { connection.client.close(); connection = createDatabase({ url }); await migrate(connection.db, { migrationsFolder }); },
    otherStore() { const other = createDatabase({ url }); extraConnections.push(other); return createIspuStore(other); },
  };
}
const collect = (store: IspuStore, overrides: Parameters<typeof createIspuCollector>[1] = {}) => createIspuCollector(store, {
  now: () => NOW, fetch: async () => reply(station()), sleep: async () => {}, log: quiet, ...overrides,
});

test('WIB calendar date changes at 17:00 UTC including year boundary', () => {
  assert.equal(wibDate(Date.parse('2026-10-14T16:59:59.999Z')), '2026-10-14');
  assert.equal(wibDate(Date.parse('2026-10-14T17:00:00Z')), DATE);
  assert.equal(wibDate(Date.parse('2026-12-31T17:00:00Z')), '2027-01-01');
});

test('explicit source timezones are deterministic and invalid calendar times stay unresolved', () => {
  for (const raw of ['2026-10-15T08:00:00+07:00', '2026-10-15 08:00:00 WIB', '15 Oktober 2026 08:00 WIB', '15-Oktober-2026 08:00:00 WIB', '2026-10-15T01:00:00Z']) {
    assert.equal(parseSourceTime(raw).observedAt, '2026-10-15T01:00:00.000Z');
  }
  assert.equal(parseSourceTime('2026-10-15 08:00:00 WITA').observedAt, '2026-10-15T00:00:00.000Z');
  assert.equal(parseSourceTime('2026-10-15 08:00:00 WIT').observedAt, '2026-10-14T23:00:00.000Z');
  for (const raw of ['2026-10-15 08:00:00', '15-Oktober-2026 08:00:00', '1728888888']) assert.equal(parseSourceTime(raw).issue, 'ambiguous_timestamp');
  for (const raw of ['2026-02-30T08:00:00Z', '2026-10-15T24:00:00Z', '2026-10-15T08:00:00+99:00']) assert.equal(parseSourceTime(raw).issue, 'invalid_timestamp');
});

test('empty, boolean and malformed numeric values never become zero', () => {
  for (const value of [null, undefined, '', '  ', true, false, [], {}, NaN, Infinity, '0x10', '1e3', '4oops']) assert.equal(numericValue(value), null);
  for (const value of [0, '0', ' 0 ', '0.0']) assert.equal(numericValue(value), 0);
});

test('collector retains healthy, stale, future, unresolved and invalid-coordinate readings with flags', async t => {
  const f = await fixture(t);
  const rows = [station(), station({ id_stasiun: 'STALE', val: 0, waktu: '2026-10-10T00:00:00Z' }),
    station({ id_stasiun: 'AMBIGUOUS', time_z: '', lat: '', waktu: '2026-10-15 08:00:00' }),
    station({ id_stasiun: 'UNDATED', waktu: '', waktu_text: '', time_z: '' }),
    station({ id_stasiun: 'FUTURE', waktu: '2026-10-16T00:00:00Z' }),
    station({ id_stasiun: 'MISSING', val: '' }), station({ id_stasiun: 'NEGATIVE', val: -1 }),
    station({ id_stasiun: '' }), station(), null];
  const rawResponse = JSON.stringify(feed(...rows), null, 2);
  const result = await collect(f.store, { fetch: async (input, init) => {
    assert.equal(input, ISPU_SOURCE_URL); assert.equal(init?.cache, 'no-store'); assert.ok(init?.signal);
    return new Response(rawResponse);
  } })();
  assert.equal(result.outcome, 'success'); assert.equal(result.run.scheduledAt, `${DATE}T01:30:00.000Z`);
  assert.equal(result.run.stationCount, 10); assert.equal(result.run.acceptedCount, 5); assert.equal(result.run.rejectedCount, 5);
  assert.equal(result.run.staleCount, 1); assert.equal(result.run.undatedCount, 2);
  assert.equal((await f.store.run(DATE))?.rawResponse, rawResponse);
  const saved = await f.store.history(RANGE);
  const current = saved.find(row => row.stationId === 'JAKARTA')!;
  assert.equal(current.value, 42); assert.equal(current.category, 'BAIK'); assert.equal(current.dominantPollutant, 'PM2.5');
  assert.equal(current.sourceTimeText, '2026-10-15 08:00:00'); assert.equal(current.sourceTimezone, 'WIB');
  assert.equal(current.observedAt, '2026-10-15T01:00:00.000Z');
  assert.deepEqual(saved.find(row => row.stationId === 'STALE')?.qualityFlags, ['stale']);
  assert.deepEqual(saved.find(row => row.stationId === 'AMBIGUOUS')?.qualityFlags, ['undated', 'ambiguous_timestamp', 'invalid_coordinates']);
  assert.deepEqual(saved.find(row => row.stationId === 'UNDATED')?.qualityFlags, ['undated']);
  assert.deepEqual(saved.find(row => row.stationId === 'FUTURE')?.qualityFlags, ['future_timestamp']);
});

test('first success skips HTTP and survives reopening and repeatable migrations', async t => {
  const f = await fixture(t); const first = await collect(f.store)();
  await f.reopen();
  const second = await collect(f.store, { fetch: async () => { throw new Error('HTTP must not run'); } })();
  assert.equal(first.outcome, 'success'); assert.equal(second.outcome, 'already_collected');
  assert.equal((await f.store.history(RANGE)).length, 1);
  assert.equal((await f.store.run(DATE))?.attemptCount, 1);
});

test('concurrent collectors on independent database clients commit one complete immutable snapshot', async t => {
  const f = await fixture(t); const other = f.otherStore();
  let count = 0, release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const request = async () => { const invocation = ++count; if (invocation === 2) release(); await ready; return reply(station({ val: invocation === 1 ? 42 : 75 })); };
  const results = await Promise.all([collect(f.store, { fetch: request })(), collect(other, { fetch: request })()]);
  assert.deepEqual(results.map(result => result.outcome).sort(), ['already_collected', 'success']);
  assert.equal((await f.store.history(RANGE)).length, 1);
  const original = await f.store.run(DATE);
  const failed = { ...original!, status: 'failed' as const, errorSummary: 'late failure', rawResponse: null };
  await other.failure(failed);
  assert.deepEqual(await f.store.run(DATE), original);
});

test('transient HTTP, network and body timeout failures retry with 2s and 5s delays', async t => {
  const f = await fixture(t); const delays: number[] = []; let attempts = 0;
  const result = await collect(f.store, { sleep: async ms => { delays.push(ms); }, fetch: async () => {
    attempts++; if (attempts === 1) return new Response('', { status: 503 });
    if (attempts === 2) throw new TypeError('fetch failed'); return reply(station());
  } })();
  assert.equal(result.outcome, 'success'); assert.equal(result.run.attemptCount, 3); assert.deepEqual(delays, [2000, 5000]);
  const nextDay = NOW + 86400_000; let timeouts = 0;
  const timeout = await collect(f.store, { now: () => nextDay, fetch: async () => {
    timeouts++; if (timeouts === 1) return { ok: true, text: async () => { throw new DOMException('body timed out', 'TimeoutError'); } } as Response;
    return reply(station());
  } })();
  assert.equal(timeout.outcome, 'success'); assert.equal(timeout.run.attemptCount, 2);
});

test('permanent HTTP errors do not retry and failures persist without readings', async t => {
  const f = await fixture(t); let attempts = 0;
  const result = await collect(f.store, { fetch: async () => { attempts++; return new Response('', { status: 403 }); } })();
  assert.equal(result.outcome, 'failed'); assert.equal(attempts, 1); assert.match(result.run.errorSummary!, /403/);
  assert.equal((await f.store.run(DATE))?.status, 'failed'); assert.deepEqual(await f.store.history(RANGE), []);
  assert.equal((await collect(f.store)()).outcome, 'success');
});

test('empty, malformed, invalid JSON and all-rejected responses exhaust retries without a successful snapshot', async t => {
  const f = await fixture(t);
  for (const body of ['{}', '{', JSON.stringify(feed()), JSON.stringify(feed(station({ val: null }))), JSON.stringify({ rows: 'invalid' })]) {
    let attempts = 0;
    const result = await collect(f.store, { fetch: async () => { attempts++; return new Response(body); } })();
    assert.equal(result.outcome, 'failed'); assert.equal(attempts, 3); assert.equal(result.run.rawResponse, undefined);
    assert.deepEqual(await f.store.history(RANGE), []);
  }
  const rejected = await collect(f.store, { fetch: async () => reply(station({ val: '' }), station({ val: null })) })();
  assert.equal(rejected.run.stationCount, 2); assert.equal(rejected.run.rejectedCount, 2);
});

test('crossing WIB midnight never assigns the later fetch to the earlier date', async t => {
  const f = await fixture(t); let time = Date.parse('2026-10-15T16:59:59Z');
  const result = await collect(f.store, { now: () => time, fetch: async () => { time += 2000; return reply(station()); } })();
  assert.equal(result.outcome, 'failed'); assert.match(result.run.errorSummary!, /midnight/);
  assert.deepEqual(await f.store.history({ from: DATE, to: '2026-10-16' }), []);
  assert.equal((await f.store.run(DATE))?.status, 'failed');
  const next = await collect(f.store, { now: () => time })();
  assert.equal(next.run.collectionDate, '2026-10-16'); assert.equal(next.outcome, 'success');
});

test('readings and successful run roll back together on an insertion failure and can recover', async t => {
  const f = await fixture(t);
  await f.connection.client.execute("CREATE TRIGGER reject_ispu BEFORE INSERT ON ispu_daily_readings BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
  const result = await collect(f.store)();
  assert.equal(result.outcome, 'failed'); assert.equal((await f.store.run(DATE))?.status, 'failed');
  assert.deepEqual(await f.store.history(RANGE), []);
  await f.connection.client.execute('DROP TRIGGER reject_ispu');
  assert.equal((await collect(f.store)()).outcome, 'success');
});

test('station series orders calendar dates, preserves observation times and flags, and leaves gaps as null', async t => {
  const f = await fixture(t);
  await collect(f.store, { now: () => NOW + 2 * 86400_000, fetch: async () => reply(station({ val: 90 }), station({ id_stasiun: 'OTHER', val: 999 })) })();
  await collect(f.store)();
  const series = await queryIspuTimeSeries(f.store, { from: '2026-10-14', to: '2026-10-17', stationId: 'JAKARTA' });
  assert.equal(series.scale, 'ISPU'); assert.equal(series.timeZone, 'Asia/Jakarta'); assert.equal(series.dateBasis, 'collection_date');
  assert.deepEqual(series.points.map(point => [point.date, point.value]), [['2026-10-14', null], [DATE, 42], ['2026-10-16', null], ['2026-10-17', 90]]);
  assert.deepEqual(series.points[3].reading?.qualityFlags, ['stale']);
  assert.equal(series.points[3].reading?.observedAt, '2026-10-15T01:00:00.000Z');
  assert.equal((await queryIspuTimeSeries(f.store, { ...RANGE, stationId: 'MISSING' })).points[0].value, null);
  await assert.rejects(queryIspuTimeSeries(f.store, { from: '2000-01-01', to: DATE, stationId: 'JAKARTA' }));
});

test('CSV export filters inclusive dates and station IDs, escapes metadata, and paginates beyond 1000 rows', async t => {
  const f = await fixture(t);
  const rows = Array.from({ length: 1002 }, (_, i) => station({ id_stasiun: `STATION-${String(i).padStart(4, '0')}`, nama: 'Station, "name"', kota: '=cmd()' }));
  assert.equal((await collect(f.store, { fetch: async () => reply(...rows) })()).outcome, 'success');
  const all = []; for await (const row of readIspuHistory(f.store, RANGE)) all.push(row);
  assert.equal((await queryIspuHistoryExport(f.store, RANGE)).readings.length, 1002);
  assert.equal(all.length, 1002); assert.equal(all.at(-1)?.stationId, 'STATION-1001');
  let csv = ''; for await (const line of exportIspuCsv(f.store, { ...RANGE, stationId: 'STATION-1001' })) csv += line;
  assert.equal(csv.trim().split('\r\n').length, 2); assert.match(csv, /"Station, ""name"""/); assert.match(csv, /"'=cmd\(\)"/);
  assert.match(csv, /"-6.2"/);
  let empty = ''; for await (const line of exportIspuCsv(f.store, { from: '2026-10-16', to: '2026-10-16' })) empty += line;
  assert.equal(empty.trim().split('\r\n').length, 1);
  assert.throws(() => validateHistoryRange({ from: '2026-02-30', to: DATE }));
  assert.throws(() => validateHistoryRange({ from: DATE, to: '2026-10-14' }));
  assert.throws(() => validateHistoryRange({ ...RANGE, stationId: ' ' }));
});

test('cron requires Bearer auth before database or HTTP, supports only GET and disables caching', async t => {
  environment(t, { CRON_SECRET: 'test-cron-secret', VERCEL: '1' });
  const f = await fixture(t); let called = 0;
  const handler = createIspuHandler(async () => { called++; return collect(f.store)(); });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/cron/ispu`;
  for (const auth of ['', 'Bearer bad', 'bearer test-cron-secret']) {
    assert.equal((await fetch(url, { headers: { Authorization: auth } })).status, 401);
  }
  assert.equal(called, 0);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const success = await fetch(url, { headers: { Authorization: 'Bearer test-cron-secret' } });
  assert.equal(success.status, 200); assert.equal(success.headers.get('cache-control'), 'no-store'); assert.equal(called, 1);
  assert.equal((await success.json()).outcome, 'success');
  delete process.env.CRON_SECRET;
  assert.equal((await fetch(url)).status, 503); assert.equal(called, 1);
});

test('local SQLite works without cloud credentials, including a local production build', t => {
  environment(t, { NODE_ENV: 'production', VERCEL: '', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' });
  assert.equal(databaseConfig().url, 'file:local.sqlite');
  assert.equal(databaseConfig().authToken, undefined);
  process.env.TURSO_DATABASE_URL = 'file:another.sqlite';
  assert.equal(databaseConfig().url, 'file:another.sqlite');
});

test('Vercel rejects local SQLite, missing remote URL and missing token', t => {
  environment(t, { VERCEL: '1', TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: '' });
  delete process.env.TURSO_DATABASE_URL; assert.throws(databaseConfig, /remote TURSO/);
  process.env.TURSO_DATABASE_URL = 'file:local.sqlite'; assert.throws(databaseConfig, /Local SQLite/);
  process.env.TURSO_DATABASE_URL = 'libsql://test.turso.io'; delete process.env.TURSO_AUTH_TOKEN; assert.throws(databaseConfig, /TURSO_AUTH_TOKEN/);
  process.env.TURSO_AUTH_TOKEN = 'secret'; assert.equal(databaseConfig().url, 'libsql://test.turso.io');
});

test('row parser rejects structurally malformed payloads and keeps explicitly unzoned times unresolved', () => {
  for (const payload of [null, [], {}, { rows: [] }, { rows: [null] }]) assert.throws(() => parseStationResponse(payload, DATE, NOW));
  const parsed = parseStationResponse(feed(station({ time_z: 'unknown' })), DATE, NOW);
  assert.deepEqual(parsed.readings[0].qualityFlags, ['undated', 'ambiguous_timestamp']);
});

test('directory keeps city/province identities, renamed stations and their latest valid coordinates', async t => {
  const f = await fixture(t);
  await collect(f.store, { fetch: async () => reply(station({ id_stasiun: 'A', kota: 'Kota Sama', provinsi: 'P' }),
    station({ id_stasiun: 'B', kota: 'Kota Sama', provinsi: 'P' }), station({ id_stasiun: 'C', kota: 'Kota Sama', provinsi: 'Q' })) })();
  await collect(f.store, { now: () => NOW + 2 * 86400_000, fetch: async () => reply(station({ id_stasiun: 'A', nama: 'Renamed', kota: 'Moved', provinsi: 'P', lat: null, lon: null })) })();
  const directory = await f.store.directory();
  assert.equal(directory.stations.length, 3); assert.equal(directory.cities.length, 3);
  assert.equal(directory.stations.find(row => row.stationId === 'A')?.name, 'Renamed');
  assert.equal(directory.stations.find(row => row.stationId === 'A')?.latitude, -6.2);
  assert.equal(directory.cities.find(row => row.cityKey === ispuCityKey('Kota Sama', 'P'))?.lastCollectionDate, DATE);
  assert.deepEqual(directory.collectionDates, [DATE, '2026-10-17']);
  const series = await queryIspuHistorySeries(f.store, { from: DATE, to: '2026-10-17' }, { cityKey: ispuCityKey('Kota Sama', 'P') });
  assert.equal(series.series.length, 2);
  assert.deepEqual(series.series.find(row => row.stationId === 'A')?.points.map(point => point.value), [42, null, null]);
  assert.deepEqual((await queryIspuHistorySeries(f.store, RANGE, { cityKey: 'missing' })).series, []);
  assert.deepEqual((await queryIspuHistorySeries(f.store, RANGE, { stationId: 'missing' })).series, []);
  const byStation = await queryIspuHistorySeries(f.store, RANGE, { stationId: 'C' });
  assert.equal(byStation.series[0].province, 'Q');
});

test('all-station Excel export pivots the inclusive date filter and keeps gaps, zero and quality notes', async t => {
  const f = await fixture(t);
  await collect(f.store, { fetch: async () => reply(station({ id_stasiun: 'A', nama: '=Station A', val: 0 }),
    station({ id_stasiun: 'B', nama: 'Station B', kota: 'Other city', val: 70 })) })();
  await collect(f.store, { now: () => NOW + 2 * 86400_000, fetch: async () => reply(station({ id_stasiun: 'C', nama: 'Station C', val: 90 })) })();
  const data = await queryIspuHistoryExport(f.store, { from: '2026-10-14', to: '2026-10-16', stationId: 'A' });
  assert.equal(data.stations.length, 3);
  assert.deepEqual(data.readings.map(row => row.stationId), ['A', 'B']);
  const book = buildIspuHistoryWorkbook(data);
  const roundTrip = XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const sheet = roundTrip.Sheets['ISPU semua stasiun'];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, { header: 1, defval: null });
  assert.deepEqual(rows[0].slice(4), ['2026-10-14', DATE, '2026-10-16']);
  assert.deepEqual(rows.find(row => row[0] === 'A')?.slice(4), [null, 0, null]);
  assert.deepEqual(rows.find(row => row[0] === 'B')?.slice(4), [null, 70, null]);
  assert.deepEqual(rows.find(row => row[0] === 'C')?.slice(4), [null, null, null]);
  assert.equal(sheet.B2.t, 's'); assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.F2.t, 'n'); assert.equal(sheet['!autofilter']?.ref, 'A1:G4');
  const flagged = buildIspuHistoryWorkbook({ ...data, readings: [{ ...data.readings[0], qualityFlags: ['stale'] }] });
  assert.match(flagged.Sheets['ISPU semua stasiun'].F2.c![0].t!, /Pengamatan lama/);
  const empty = await queryIspuHistoryExport(f.store, { from: '2026-10-18', to: '2026-10-18' });
  assert.equal(empty.readings.length, 0); assert.equal(empty.stations.length, 3);
  assert.throws(() => buildIspuHistoryWorkbook({ ...data, to: '2026-10-13' }));
  await assert.rejects(queryIspuHistoryExport(f.store, { from: '2000-01-01', to: DATE }));
});

test('rankings use one archived date, exclude flagged times, retain coordinate-only flags and rank real zero', () => {
  const parsed = parseStationResponse(feed(...Array.from({ length: 25 }, (_, index) => station({ id_stasiun: `S-${index}`, nama: `Station ${index}`, val: index === 24 ? 0 : index }))), DATE, NOW);
  const invalid: IspuQualityFlag[] = ['stale', 'undated', 'invalid_timestamp', 'ambiguous_timestamp', 'future_timestamp'];
  invalid.forEach((flag, index) => { parsed.readings[index].qualityFlags = [flag]; });
  parsed.readings[5].qualityFlags = ['invalid_coordinates'];
  const rankings = buildIspuRankings([...parsed.readings, { ...parsed.readings[6], collectionDate: '2026-10-16', value: 9999 }], DATE, 'station');
  assert.equal(rankings.eligibleCount, 20); assert.equal(rankings.excludedCount, 5);
  assert.equal(rankings.best.length, 10); assert.equal(rankings.worst.length, 10);
  assert.equal(rankings.best[0].value, 0); assert.equal(rankings.worst[0].value, 23);
  assert.ok(rankings.best.some(row => row.stationId === 'S-5'));
  assert.equal(buildIspuRankings(parsed.readings, '2026-10-16', 'station').best.length, 0);
});

test('city maximum rankings show contributing station and count, ties are deterministic and short lists are not padded', async t => {
  const f = await fixture(t);
  await collect(f.store, { fetch: async () => reply(station({ id_stasiun: 'B', nama: 'Beta', val: 70 }), station({ id_stasiun: 'A', nama: 'Alpha', val: 70 }),
    station({ id_stasiun: 'C', kota: 'Solo', val: 10 }), station({ id_stasiun: 'D', kota: 'Solo', provinsi: 'Other', val: 90 }),
    station({ id_stasiun: 'E', kota: 'Solo', val: 999, waktu: '2026-01-01T00:00:00Z' })) })();
  const rankings = await queryIspuRankings(f.store, DATE, 'city');
  assert.equal(rankings.rankedCount, 3); assert.equal(rankings.excludedCount, 1);
  assert.equal(rankings.best[0].name, 'Solo'); assert.equal(rankings.best[0].value, 10);
  const jakarta = rankings.best.find(row => row.name === 'Jakarta')!;
  assert.equal(jakarta.value, 70); assert.equal(jakarta.stationId, 'A'); assert.equal(jakarta.stationCount, 2);
  const stations = await queryIspuRankings(f.store, DATE, 'station');
  assert.deepEqual(stations.worst.filter(row => row.value === 70).map(row => row.stationId), ['A', 'B']);
  assert.equal(stations.best.length, 4);
});

test('WIB presets, archived proximity and chart geometry preserve gaps, isolated points and extreme values', () => {
  assert.equal(wibToday(Date.parse('2026-10-14T17:00:00Z')), DATE);
  assert.deepEqual(ispuDateRange(30, DATE), { from: '2026-09-16', to: DATE });
  const base = { stationId: 'A', name: 'A', city: 'City', province: 'P', cityKey: 'c', firstCollectionDate: DATE, lastCollectionDate: DATE };
  const nearest = nearestArchivedStation([{ ...base, latitude: null, longitude: null }, { ...base, stationId: 'B', latitude: -6.2, longitude: 106.8 }], { latitude: -6.2, longitude: 106.8 });
  assert.equal(nearest?.station.stationId, 'B'); assert.equal(nearest?.distanceKm, 0);
  assert.equal(nearestArchivedStation([], { latitude: 0, longitude: 0 }), null);
  const segments = ispuChartSegments([null, 0, null, 99999, 40, null].map((value, index) => ({ date: `2026-10-${15 + index}`, value, reading: null })));
  assert.deepEqual(segments.map(segment => segment.map(point => point.index)), [[1], [3, 4]]);
  assert.ok(ispuChartScale([99999]).max > 99999); assert.ok(ispuChartScale([]).max >= 100);
  assert.equal(ispuStationColor('A'), ispuStationColor('A')); assert.notEqual(ispuStationColor('A'), ispuStationColor('B'));
});

test('history HTTP API validates before reading storage and exposes only read-only local data', async t => {
  const f = await fixture(t); await collect(f.store)();
  const store = f.store;
  const handler = createIspuHistoryHandler(store);
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/ispu-history`;
  for (const query of ['action=export', 'action=export&from=2026-02-30&to=2026-10-15', 'action=export&from=2000-01-01&to=2026-10-15', 'action=bad', 'action=series&stationId=A', 'action=series&stationId=A&cityKey=B&from=2026-10-15&to=2026-10-15',
    'action=series&stationId=%20&from=2026-10-15&to=2026-10-15', 'action=rankings&date=2026-02-30&groupBy=city',
    'action=series&stationId=A&from=2000-01-01&to=2026-10-15', 'action=rankings&date=2026-10-15&groupBy=bad']) {
    assert.equal((await fetch(`${url}?${query}`)).status, 400, query);
  }
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const directory = await fetch(`${url}?action=directory`);
  assert.equal(directory.status, 200); assert.equal(directory.headers.get('cache-control'), 'no-store');
  assert.equal((await directory.json()).stations.length, 1);
  const response = await fetch(`${url}?action=series&stationId=JAKARTA&from=${DATE}&to=${DATE}`);
  const text = await response.text(); assert.equal(response.status, 200);
  assert.equal(text.includes('rawResponse'), false); assert.equal(text.includes('CRON_SECRET'), false);
  assert.equal(JSON.parse(text).series[0].points[0].value, 42);
  assert.equal((await (await fetch(`${url}?action=rankings&date=${DATE}&groupBy=city`)).json()).best.length, 1);
  const exported = await fetch(`${url}?action=export&from=${DATE}&to=${DATE}`);
  assert.equal(exported.status, 200); assert.equal(exported.headers.get('cache-control'), 'no-store');
  const exportData = await exported.json();
  assert.equal(exportData.stations.length, 1); assert.equal(exportData.readings[0].value, 42);
  assert.equal(exportData.from, DATE); assert.equal(exportData.to, DATE);
  environment(t, { VERCEL: '1' }); assert.equal((await fetch(`${url}?action=directory`)).status, 503);
  process.env.VERCEL = '';
  t.mock.method(store, 'directory', async () => { throw new Error('private database detail'); });
  const unavailable = await fetch(`${url}?action=directory`); assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes('private database detail'), false);
});

test('history client rejects aborted responses even when a transport ignores cancellation', async t => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async () => pending);
  const controller = new AbortController();
  const request = requestIspuHistory({ action: 'directory' }, controller.signal);
  controller.abort(); release(Response.json({ stations: [] }));
  await assert.rejects(request, { name: 'AbortError' });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Backend unavailable' }, { status: 503 }));
  await assert.rejects(requestIspuHistory({ action: 'directory' }), /Backend unavailable/);
});
