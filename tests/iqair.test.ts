import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDatabase } from '../server/database.ts';
import { createIqairStore } from '../server/iqairStore.ts';
import { createIqairService, parseApiReading } from '../server/iqairService.ts';
import { discoverCityLinks, discoverLocations, extractReading, isVerificationPage, numberValue, validateIqairUrl } from '../server/iqairExtractor.ts';
import { JAKARTA, observationFreshness } from '../src/domain/iqair.ts';
import { createIqairHandler } from '../server/iqairHandler.ts';
import { createServer } from 'node:http';

const NOW = Date.parse('2026-10-13T03:30:00Z');
const html = await readFile(new URL('./fixtures/iqair/current.html', import.meta.url), 'utf8');
const structured = await readFile(new URL('./fixtures/iqair/structured.html', import.meta.url), 'utf8');
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'ews-iqair-test-'));
  const url = 'file:' + join(directory, 'cache.sqlite').replaceAll('\\', '/');
  let connection = createDatabase({ url });
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
  await migrate(connection.db, { migrationsFolder });
  t.after(async () => {
    connection.client.close(); globalThis.gc?.();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.startsWith(join(tmpdir(), 'ews-iqair-test-')));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  return {
    get connection() { return connection; }, get store() { return createIqairStore(connection); },
    async reopen() { connection.client.close(); connection = createDatabase({ url }); await migrate(connection.db, { migrationsFolder }); },
  };
}
const response = (body = html, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
const apiData = { city: 'Jakarta', state: 'Jakarta', country: 'Indonesia', location: { coordinates: [106.8, -6.2] }, current: { pollution: { aqius: 76, aqicn: 30, mainus: 'p2', maincn: 'p2', ts: '2026-10-13T03:00:00Z' }, weather: { tp: 32, hu: 52, pr: 1010, ws: 2, ts: '2026-10-13T03:05:00Z' } } };

test('public URL validation prevents arbitrary hosts, credentials, paths and stations', () => {
  assert.equal(validateIqairUrl(JAKARTA.websiteUrl!, 5).href, JAKARTA.websiteUrl);
  for (const url of ['http://www.iqair.com/id/air-quality/indonesia/jakarta/jakarta', 'https://iqair.com/id/air-quality/indonesia', 'https://www.iqair.com.evil.test/id/air-quality/indonesia', 'https://user@www.iqair.com/id/air-quality/indonesia', JAKARTA.websiteUrl + '/station', JAKARTA.websiteUrl + '?key=secret', 'https://www.iqair.com/id/air-quality/india', 'https://www.iqair.com/id/air-quality/indonesia/%2f']) assert.throws(() => validateIqairUrl(url));
});
test('labeled current reading keeps exact scale, Indonesian decimals, units and forecast separation', () => {
  const reading = extractReading(html, JAKARTA, NOW);
  assert.equal(reading.index.value, 156); assert.equal(reading.index.scale, 'AQI⁺ US'); assert.equal(reading.index.category, 'Tidak sehat');
  assert.deepEqual(reading.concentrations?.['PM2.5'], { value: 62.5, unit: 'µg/m³' });
  assert.deepEqual(reading.concentrations?.PM10, { value: 1234.5, unit: 'µg/m³' });
  assert.equal(reading.stations, 53); assert.equal(reading.contributors, 40);
  assert.equal(reading.weather?.humidity && (reading.weather.humidity as { value: number }).value, 52);
  assert.equal(reading.observedAt, '2026-10-13T03:00:00.000Z'); assert.equal(reading.coordinates, undefined);
  assert.equal(reading.forecast?.[0].index, 200); assert.equal(numberValue('1.234,5'), 1234.5);
});
test('structured current reading skips forecast branch and never executes scripts', () => {
  const reading = extractReading(structured, JAKARTA, NOW);
  assert.equal(reading.index.value, 42); assert.equal(reading.index.scale, 'AQI? US'); assert.deepEqual(reading.coordinates, [106.8, -6.2]);
  assert.equal(reading.concentrations, undefined); assert.equal(reading.weather, undefined);
});
test('missing optional fields and ambiguous times remain unavailable', () => {
  const reading = extractReading('<h1>Air quality in Jakarta</h1><main><b>50</b> US AQI Good <time>10.00, Okt 13</time></main>', JAKARTA, NOW);
  assert.equal(reading.observedAt, undefined); assert.equal(observationFreshness(reading, NOW), 'unknown');
  assert.equal(reading.forecast, undefined);
});
test('changed/invalid markup, incorrect city, verification and forecast-only data are rejected', () => {
  for (const page of ['<h1>Kualitas udara di Bandung</h1>156 AQI⁺ US', '<h1>Kualitas udara di Jakarta</h1><section data-forecast>200 AQI⁺ US</section>', '<h1>Kualitas udara di Jakarta</h1>156 ISPU', '<title>Vercel Security Checkpoint</title>', '<html>invalid</html>']) assert.throws(() => extractReading(page, JAKARTA, NOW));
  assert.equal(isVerificationPage('<h1>Verify you are human</h1>'), true);
});
test('directory discovery permits selected province/city links only', () => {
  const page = '<a href="/id/air-quality/indonesia/jakarta">Jakarta</a><a href="/id/air-quality/indonesia/jakarta/jakarta">City</a><a href="https://evil.test/">Bad</a>';
  assert.deepEqual(discoverLocations(page, 'https://www.iqair.com/id/air-quality/indonesia').map(l => l.id), ['web:jakarta']);
  assert.deepEqual(discoverLocations(page, 'https://www.iqair.com/id/air-quality/indonesia/jakarta').map(l => l.city), ['City']);
});
test('API observations have separate timestamps/categories and no website-only fields', () => {
  const reading = parseApiReading(apiData, JAKARTA, 'Jakarta', 'Jakarta', NOW);
  assert.equal(reading.index.scale, 'US AQI'); assert.equal(reading.index.category, 'Sedang');
  assert.equal(reading.weatherObservedAt, '2026-10-13T03:05:00.000Z'); assert.equal(reading.concentrations, undefined); assert.equal(reading.forecast, undefined);
  assert.throws(() => parseApiReading({ ...apiData, city: 'Bandung' }, JAKARTA, 'Jakarta', 'Jakarta', NOW));
  assert.throws(() => parseApiReading({ ...apiData, current: { pollution: { aqius: -1 } } }, JAKARTA, 'Jakarta', 'Jakarta', NOW));
});
test('fresh cache precedes HTTP and persists across reopen, concurrent requests deduplicate', async t => {
  const f = await fixture(t); let calls = 0;
  const service = createIqairService(f.store, { now: () => NOW, fetch: async () => { calls++; return response(); } });
  const results = await Promise.all([service.observation(JAKARTA.id), service.observation(JAKARTA.id), service.observation(JAKARTA.id)]);
  assert.equal(calls, 1); assert.equal(results[0].delivery, 'live');
  await f.reopen();
  const next = createIqairService(f.store, { now: () => NOW + 1000, fetch: async () => { throw new Error('must not call'); } });
  const cached = await next.observation(JAKARTA.id);
  assert.equal(cached.delivery, 'cache'); assert.equal(cached.reading?.sourceMethod, 'website'); assert.equal(cached.freshness, 'current');
});
test('blocked website falls back to exact API directory names without mixing fields', async t => {
  const f = await fixture(t); const paths: string[] = [];
  const service = createIqairService(f.store, { key: 'backend-secret', now: () => NOW, fetch: async input => {
    const url = new URL(String(input)); paths.push(url.pathname);
    if (url.hostname === 'www.iqair.com') return response('denied', 403);
    const data = url.pathname.endsWith('/states') ? [{ state: 'Jakarta' }] : url.pathname.endsWith('/cities') ? [{ city: 'Jakarta' }] : apiData;
    return Response.json({ status: 'success', data });
  } });
  const result = await service.observation(JAKARTA.id);
  assert.deepEqual(paths, ['/id/air-quality/indonesia/jakarta/jakarta', '/v2/states', '/v2/cities', '/v2/city']);
  assert.equal(result.reading?.sourceMethod, 'api'); assert.equal(result.reading?.concentrations, undefined);
  assert.equal(JSON.stringify(result).includes('backend-secret'), false);
});
test('API fallback rejects fuzzy state/city matches', async t => {
  const f = await fixture(t); let cityCalls = 0;
  const service = createIqairService(f.store, { key: 'key', now: () => NOW, fetch: async input => {
    const url = new URL(String(input)); if (url.hostname === 'www.iqair.com') return response('denied', 403);
    if (url.pathname.endsWith('/city')) cityCalls++;
    return Response.json({ status: 'success', data: [{ state: 'DKI Jakarta' }] });
  } });
  assert.equal((await service.observation(JAKARTA.id)).delivery, 'unavailable'); assert.equal(cityCalls, 0);
});
test('no-key failures return unavailable or a clearly outdated last success', async t => {
  const f = await fixture(t);
  const fail = createIqairService(f.store, { now: () => NOW, fetch: async () => response('checkpoint', 429, { 'retry-after': '3600' }) });
  const unavailable = await fail.observation(JAKARTA.id);
  assert.equal(unavailable.delivery, 'unavailable'); assert.match(unavailable.message!, /belum dikonfigurasi/);
  await f.store.write(`reading:${JAKARTA.id}:website`, extractReading(html, JAKARTA, NOW), NOW - 2 * 3600_000);
  const stale = await fail.observation(JAKARTA.id); assert.equal(stale.delivery, 'cache'); assert.equal(stale.freshness, 'outdated');
  await f.reopen(); await assert.rejects(f.store.reserve('website', NOW + 35 * 60_000));
  await f.store.reserve('website', NOW + 61 * 60_000);
});
test('old website observation triggers API backup even when freshly retrieved', async t => {
  const f = await fixture(t);
  const service = createIqairService(f.store, { key: 'key', now: () => NOW + 3 * 3600_000, fetch: async input => {
    const url = new URL(String(input));
    if (url.hostname === 'www.iqair.com') return response();
    return Response.json({ status: 'success', data: url.pathname.endsWith('/states') ? [{ state: 'Jakarta' }] : url.pathname.endsWith('/cities') ? [{ city: 'Jakarta' }] : apiData });
  } });
  const result = await service.observation(JAKARTA.id); assert.equal(result.reading?.sourceMethod, 'api'); assert.equal(result.freshness, 'outdated');
});
test('timeouts, malformed HTML and unsafe redirects invoke API-free unavailable handling', async t => {
  const f = await fixture(t); let clock = NOW;
  for (const fetcher of [async () => { throw new DOMException('timeout', 'TimeoutError'); }, async () => response('<h1>broken</h1>'), async () => response('', 302, { location: 'https://evil.test/' })]) {
    const service = createIqairService(f.store, { now: () => clock, fetch: fetcher });
    assert.equal((await service.observation(JAKARTA.id)).delivery, 'unavailable'); clock += 16_000;
  }
});
test('website spacing, checkpoint cooldown, failed attempts and rolling API minute limits persist', async t => {
  const f = await fixture(t);
  await f.store.reserve('website', NOW); await assert.rejects(f.store.reserve('website', NOW + 14999)); await f.store.reserve('website', NOW + 15000);
  await f.store.pause(NOW + 30 * 60_000); await f.reopen(); await assert.rejects(f.store.reserve('website', NOW + 16_000));
  for (let i = 0; i < 5; i++) await f.store.reserve('api', NOW + i);
  await assert.rejects(f.store.reserve('api', NOW + 10)); await f.reopen(); await assert.rejects(f.store.reserve('api', NOW + 10)); await f.store.reserve('api', NOW + 60_001);
});
test('daily and 31-day API caps include persisted directory and failed attempts', async t => {
  const f = await fixture(t);
  for (const [count, time] of [[500, NOW - 60_001], [10000, NOW - 86400_001]]) {
    await f.connection.client.execute('DELETE FROM iqair_requests');
    await f.connection.client.execute({ sql: "WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < ?) INSERT INTO iqair_requests(method, attempted_at) SELECT 'api', ? FROM seq", args: [count, time] });
    await assert.rejects(f.store.reserve('api', NOW));
  }
});
test('directories cache for 24 hours, retain known locations and allow URL bootstrap during blocking', async t => {
  const f = await fixture(t); let clock = NOW; let calls = 0;
  const service = createIqairService(f.store, { now: () => clock, fetch: async () => { calls++; return response('<a href="/id/air-quality/indonesia/bali">Bali</a>'); } });
  await service.directory(); await service.directory(); assert.equal(calls, 1);
  clock += 25 * 3600_000; await service.directory(); assert.equal(calls, 2);
  const added = await service.addCity('https://www.iqair.com/id/air-quality/indonesia/bali/denpasar'); assert.equal(added.city, 'denpasar'); assert.equal(calls, 2);
  const offline = createIqairService(f.store, { now: () => clock + 25 * 3600_000, fetch: async () => response('', 403) });
  const dir = await offline.directory(); assert.ok(dir.locations.some(l => l.province === 'Bali'));
});

test('local HTTP route returns typed results and validates actions, origins, methods and URLs', async t => {
  const f = await fixture(t);
  const backend = createIqairService(f.store, { now: () => NOW, fetch: async () => response() });
  const handler = createIqairHandler(backend);
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/iqair`;
  const live = await fetch(base + '?action=observation&id=' + encodeURIComponent(JAKARTA.id));
  assert.equal(live.status, 200); assert.equal((await live.json()).delivery, 'live');
  const cached = await fetch(base + '?action=observation&id=' + encodeURIComponent(JAKARTA.id));
  const result = await cached.json(); assert.equal(result.delivery, 'cache'); assert.equal(result.reading.sourceMethod, 'website');
  assert.equal((await fetch(base + '?action=cities')).status, 400);
  assert.equal((await fetch(base + '?action=unknown')).status, 400);
  assert.equal((await fetch(base + '?action=add&url=https://evil.test/', { method: 'POST' })).status, 400);
  assert.equal((await fetch(base + '?action=provinces', { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(base + '?action=provinces', { headers: { origin: 'not a url' } })).status, 403);
  assert.equal((await fetch(base + '?action=provinces', { headers: { origin: 'https://evil.test' } })).status, 403);
  const previous = process.env.VERCEL; process.env.VERCEL = '1';
  try { assert.equal((await fetch(base + '?action=provinces')).status, 503); }
  finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

test('shared API directory discovery deduplicates concurrent directory and observation calls', async t => {
  const f = await fixture(t); let stateCalls = 0;
  await f.store.pause(NOW + 30 * 60_000);
  const service = createIqairService(f.store, { key: 'key', now: () => NOW, fetch: async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/states')) stateCalls++;
    const data = url.pathname.endsWith('/states') ? [{ state: 'Jakarta' }] : url.pathname.endsWith('/cities') ? [{ city: 'Jakarta' }] : apiData;
    return Response.json({ status: 'success', data });
  } });
  const [dir, result] = await Promise.all([service.directory(), service.observation(JAKARTA.id)]);
  assert.ok(dir.locations.length); assert.equal(result.reading?.sourceMethod, 'api'); assert.equal(stateCalls, 1);
});

test('country city-link discovery excludes other countries, stations and arbitrary hosts', () => {
  const html = '<a href="/id/air-quality/indonesia/bali/denpasar">Denpasar</a><a href="/id/air-quality/indonesia/bali/denpasar/station">Station</a><a href="/id/air-quality/india/delhi/new-delhi">New Delhi</a><a href="https://evil.test/id/air-quality/indonesia/bali/ubud">Ubud</a>';
  assert.deepEqual(discoverCityLinks(html, 'https://www.iqair.com/id/air-quality/indonesia').map(item => item.city), ['Denpasar']);
  assert.deepEqual(discoverCityLinks(html, 'https://www.iqair.com/id/air-quality/indonesia/jakarta'), []);
});

test('all-city crawl progressively covers all discovered provinces and resumes after restart', async t => {
  const f = await fixture(t); let clock = NOW; const urls: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); urls.push(url.pathname);
    if (url.pathname.endsWith('/indonesia')) return response('<a href="/id/air-quality/indonesia/bali">Bali</a><a href="/id/air-quality/indonesia/jakarta">Jakarta</a><a href="/id/air-quality/indonesia/bali/denpasar">Denpasar</a>');
    if (url.pathname.endsWith('/jakarta')) return response('<a href="/id/air-quality/indonesia/jakarta/jakarta">Jakarta</a>');
    return response('<a href="/id/air-quality/indonesia/bali/denpasar">Denpasar</a><a href="/id/air-quality/indonesia/bali/ubud">Ubud</a>');
  };
  let backend = createIqairService(f.store, { now: () => clock, fetch: fetcher });
  const [first, same] = await Promise.all([backend.allCities(), backend.allCities()]);
  assert.equal(urls.length, 1); assert.deepEqual(first, same);
  assert.deepEqual(first.locations.map(item => item.city), ['Denpasar', 'Jakarta']); assert.equal(first.crawl?.completedPages, 1); assert.equal(first.crawl?.totalPages, 3);
  assert.equal(first.locations.find(item => item.city === 'Denpasar')?.province, 'Bali');
  clock += 14999; await backend.allCities(); assert.equal(urls.length, 1);
  clock += 1; await backend.allCities(); assert.equal(urls.length, 2);
  await f.reopen(); backend = createIqairService(f.store, { now: () => clock, fetch: fetcher });
  clock += 15000; const final = await backend.allCities();
  assert.equal(urls.length, 3); assert.equal(final.crawl?.status, 'complete');
  assert.deepEqual(final.locations.map(item => item.city), ['Denpasar', 'Jakarta', 'Ubud']);
  assert.ok(urls.every(url => url.split('/').filter(Boolean).length <= 4));
  await backend.allCities(); assert.equal(urls.length, 3);
  clock += 25 * 3600_000; await backend.allCities(); assert.equal(urls.length, 4);
});

test('all-city crawl respects persistent checkpoint cooldown and retains visible cities', async t => {
  const f = await fixture(t); let clock = NOW; let calls = 0;
  await f.store.saveLocations([{ id: 'web:bali/ubud', city: 'Ubud', province: 'Bali', websiteUrl: 'https://www.iqair.com/id/air-quality/indonesia/bali/ubud' }]);
  const fetcher: typeof fetch = async () => { calls++; return response('Vercel Security Checkpoint', 429, { 'retry-after': '3600' }); };
  let backend = createIqairService(f.store, { now: () => clock, fetch: fetcher });
  const first = await backend.allCities(); assert.equal(first.crawl?.status, 'paused'); assert.ok(first.locations.some(item => item.city === 'Ubud')); assert.equal(first.crawl?.retryAt, new Date(NOW + 3600_000).toISOString());
  await f.reopen(); backend = createIqairService(f.store, { now: () => clock, fetch: fetcher });
  clock += 35 * 60_000; await backend.allCities(); assert.equal(calls, 1);
  clock += 26 * 60_000; await backend.allCities(); assert.equal(calls, 2);
});

test('malformed crawl pages back off without starving other known province directories', async t => {
  const f = await fixture(t); let clock = NOW; const urls: string[] = [];
  const backend = createIqairService(f.store, { now: () => clock, fetch: async input => {
    const url = new URL(String(input)); urls.push(url.pathname);
    return response(url.pathname.endsWith('/indonesia') ? '<h1>Changed markup</h1>' : '<a href="/id/air-quality/indonesia/jakarta/jakarta">Jakarta</a>');
  } });
  await backend.allCities(); clock += 15000; const second = await backend.allCities();
  assert.equal(urls.length, 2); assert.ok(urls[1].endsWith('/jakarta')); assert.equal(second.crawl?.status, 'paused'); assert.equal(second.crawl?.completedPages, 1);
  clock += 15000; await backend.allCities(); assert.equal(urls.length, 2);
});
