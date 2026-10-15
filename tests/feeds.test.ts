import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createFeedHandler, compactIrbi, fetchFeedData } from '../server/feedHandler.ts';
import { FEED_SECONDS, isFeedResponse, type FeedId } from '../src/domain/feedPolicy.ts';
import { requestFeedEnvelope } from '../src/services/feedClient.ts';
import { OFFICE_IRBI_REGION } from '../src/constants/officeIrbiRegion.ts';
import { parseMarkup } from '../server/markup.ts';

async function api(t: import('node:test').TestContext, fetchData: Parameters<typeof createFeedHandler>[0]) {
  const server = createServer(createFeedHandler(fetchData));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return 'http://127.0.0.1:' + (server.address() as { port: number }).port;
}
test('named feeds cache successful empty results and reject unbounded query variants', async t => {
  let calls = 0;
  const url = await api(t, async () => { calls++; return []; });
  const response = await fetch(url + '/api/feeds?feed=earthquakes');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('vercel-cdn-cache-control'), 'public, s-maxage=300');
  const value = await response.json();
  assert.deepEqual(value.data, []); assert.ok(isFeedResponse(value, 'earthquakes'));
  for (const query of ['feed=unknown', 'feed=irbi&url=https://example.com', 'feed=irbi&feed=magma', 'feed=province-weather&provinceId=unknown', 'feed=volcano-report&date=2026-02-30']) {
    assert.equal((await fetch(url + '/api/feeds?' + query)).status, 400);
  }
  assert.equal((await fetch(url + '/api/feeds?feed=irbi', { method: 'POST' })).status, 405);
  assert.equal(calls, 1);
});
test('upstream failures are small, uncacheable errors', async t => {
  t.mock.method(console, 'error', () => {});
  const url = await api(t, async () => { throw new Error('Fixture upstream failure'); });
  const response = await fetch(url + '/api/feeds?feed=irbi');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('vercel-cdn-cache-control'), null);
  assert.ok((await response.text()).length < 200);
});
test('IRBI output contains only mapped offices, latest FINAL years and the three existing hazard fields', () => {
  const pcodes = [...new Set(Object.values(OFFICE_IRBI_REGION).map(row => row.pcode))];
  const line = (pcode: string, tahun: number, status = 'FINAL') => JSON.stringify({ type: 'row', data: { pcode, tahun, status, gempabumi: 100, cuaca_ekstrem: 50, karlahut: 20, unused: 'x'.repeat(10_000) } });
  const raw = pcodes.flatMap(pcode => [line(pcode, 2023), line(pcode, 2025), line(pcode, 2026, 'DRAFT')]).concat(line('not-mapped', 2025)).join('\n');
  const compact = compactIrbi(raw);
  assert.equal(compact.length, pcodes.length);
  assert.ok(compact.every(row => row.tahun === 2025 && !('unused' in row)));
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 32 * 1024);
  const baseline = Buffer.byteLength(raw) * 480;
  const optimized = Buffer.byteLength(JSON.stringify(compact)) * Math.ceil(8 * 3600 / FEED_SECONDS.irbi);
  assert.ok(1 - optimized / baseline > 0.9);
});
test('server markup supports the original CAP geometry and MAGMA selectors', () => {
  const xml = parseMarkup('<alert><info><severity>Severe</severity><polygon>-6,106 -7,107 -6,106</polygon></info></alert>', true);
  assert.equal(xml.querySelector('severity')?.textContent, 'Severe');
  assert.equal(xml.querySelector('polygon')?.textContent, '-6,106 -7,107 -6,106');
  const html = parseMarkup('<div id="tab-1"><table><tbody><tr><td>1</td><td>Gunung</td></tr></tbody></table></div>');
  assert.equal(html.getElementById('tab-1')?.querySelectorAll('tbody tr')[0].querySelectorAll('td')[1].textContent, 'Gunung');
});

test('weather function parses source validity, severity and geometry without sending raw XML', async t => {
  const now = Date.parse('2026-10-15T10:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  const geometry = '-6,106 -7,107 -6,106';
  t.mock.method(globalThis, 'fetch', async input => {
    if (String(input).includes('rss2json')) return Response.json({ status: 'ok', items: [{ guid: 'warning1', link: 'https://www.bmkg.go.id/cap/fixture.xml', title: 'Cuaca Jakarta', description: 'Source notice', pubDate: '2026-10-15T09:55:00Z' }] });
    return new Response('<alert><info><severity>Severe</severity><onset>2026-10-15T09:30:00Z</onset><expires>2026-10-15T11:00:00Z</expires><area><polygon>' + geometry + '</polygon></area></info></alert>');
  });
  const result = await fetchFeedData('extreme-weather', new URLSearchParams()) as Array<{ severity: number; validUntil: string; sourceGeometry: { coordinates: string } }>;
  assert.equal(result.length, 1);
  assert.equal(result[0].severity, 3);
  assert.equal(result[0].validUntil, '2026-10-15T11:00:00Z');
  assert.equal(result[0].sourceGeometry.coordinates, geometry);
  assert.ok(!JSON.stringify(result).includes('<alert>'));
});

test('ISPU function keeps healthy and flagged archive rows while stripping upstream extras', async t => {
  const now = Date.parse('2026-10-15T10:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ rows: [
    { id_stasiun: 'healthy', nama: 'Healthy station', kota: 'Jakarta', provinsi: 'Jakarta', val: 35, lat: -6, lon: 106, param: 'PM2.5', waktu: '2026-10-15T09:00:00Z', unused: 'never return this' },
    { id_stasiun: 'stale', nama: 'Old station', kota: 'Jakarta', provinsi: 'Jakarta', val: 180, lat: -6, lon: 106, param: 'PM2.5', waktu: '2026-10-10T09:00:00Z' },
  ] }));
  const result = await fetchFeedData('ispu', new URLSearchParams()) as { readings: Array<{ stationId: string; qualityFlags: string[] }> };
  assert.equal(result.readings.length, 2);
  assert.deepEqual(result.readings[0].qualityFlags, []);
  assert.ok(result.readings[1].qualityFlags.includes('stale'));
  assert.ok(!JSON.stringify(result).includes('never return this'));
});
test('browser cache deduplicates concurrent calls and preserves the CDN response absolute expiry', async t => {
  let now = Date.parse('2026-10-15T00:00:00.000Z'), calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return Response.json({ version: 1, feed: 'earthquakes', fetchedAt: new Date(now - 270_000).toISOString(), freshUntil: new Date(now + 30_000).toISOString(), data: [] });
  });
  const results = await Promise.all([requestFeedEnvelope('earthquakes'), requestFeedEnvelope('earthquakes')]);
  assert.equal(calls, 1); assert.equal(results[0].freshUntil, results[1].freshUntil);
  now += 29_000; await requestFeedEnvelope('earthquakes'); assert.equal(calls, 1);
  now += 2000; await requestFeedEnvelope('earthquakes'); assert.equal(calls, 2);
});
test('failed fetches back off and never turn a failed response into cached data', async t => {
  let now = Date.parse('2026-10-16T00:00:00.000Z'), calls = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'failure' }, { status: 503 }); });
  await assert.rejects(requestFeedEnvelope('magma'));
  await assert.rejects(requestFeedEnvelope('magma')); assert.equal(calls, 1);
  now += 30_000; await assert.rejects(requestFeedEnvelope('magma')); assert.equal(calls, 2);
});

test('eight-hour dashboard simulation reduces total response bytes by over ninety percent', async t => {
  let now = Date.parse('2026-10-20T00:00:00.000Z'), transferred = 0;
  t.mock.method(Date, 'now', () => now);
  const feeds: FeedId[] = ['earthquakes', 'extreme-weather', 'early-warning', 'forecast', 'magma', 'sipongi', 'inasiam', 'ispu', 'irbi'];
  const calls = new Map<FeedId, number>();
  const rawIrbi = [...new Set(Object.values(OFFICE_IRBI_REGION).map(row => row.pcode))].map(pcode => JSON.stringify({ type: 'row', data: {
    pcode, tahun: 2025, status: 'FINAL', gempabumi: 100, cuaca_ekstrem: 50, karlahut: 20, unused: 'reference metadata '.repeat(800),
  } })).join('\n');
  // For the other feeds the baseline already uses compact fixture responses,
  // making this a conservative comparison rather than assuming large HTML.
  const data = Object.fromEntries(feeds.map(feed => [feed, feed === 'irbi' ? compactIrbi(rawIrbi) : Array.from({ length: 15 }, (_, i) => ({ id: feed + i, source: 'fixture', geometry: [[-6, 106], [-7, 107]], description: 'observation '.repeat(60) }))]));
  t.mock.method(globalThis, 'fetch', async input => {
    const feed = new URL(String(input), 'http://localhost').searchParams.get('feed') as FeedId;
    calls.set(feed, (calls.get(feed) ?? 0) + 1);
    const body = JSON.stringify({ version: 1, feed, fetchedAt: new Date(now).toISOString(), freshUntil: new Date(now + FEED_SECONDS[feed] * 1000).toISOString(), data: data[feed] });
    transferred += Buffer.byteLength(body);
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  });
  const start = now;
  for (let step = 0; step < 8 * 60 * 2; step++) {
    now = start + step * 30_000;
    await Promise.all(feeds.map(feed => requestFeedEnvelope(feed)));
  }
  const baseline = 480 * (Buffer.byteLength(rawIrbi) + feeds.filter(feed => feed !== 'irbi').reduce((sum, feed) => sum + Buffer.byteLength(JSON.stringify(data[feed])), 0));
  assert.equal(calls.get('earthquakes'), 96);
  assert.equal(calls.get('ispu'), 32);
  assert.equal(calls.get('forecast'), 8);
  assert.equal(calls.get('irbi'), 1);
  const reduction = 1 - transferred / baseline;
  assert.ok(reduction >= 0.9, 'Total transferred bytes should fall by at least 90%');
  t.diagnostic(JSON.stringify({ baselineBytes: baseline, optimizedBytes: transferred, reductionPercent: Number((reduction * 100).toFixed(2)) }));
});
