import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import type { DisasterAlert } from '../src/types/index.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});


const { KarhutlaRegionalService, karhutlaRegion, karhutlaStatisticsUrl, parseKarhutlaStatistics, project3395 } = await import('../src/services/karhutlaRegionalService.ts');
const { resolveOfficeAssessment } = await import('../src/utils/officeHazardAssessment.ts');
const { scoreAlertForOffice, buildOfficeRiskMap, buildAlertRiskResult } = await import('../src/utils/riskCalculator.ts');
const { BnpbInariskService } = await import('../src/services/bnpbInariskService.ts');
const { KPWBI_OFFICES } = await import('../src/constants/kpwbiOffices.ts');
const makeOffice = (id: string, longitude = 114) => ({ ...KPWBI_OFFICES[0], id, latitude: -2.5, longitude });
const response = (mean = 0.5, count = 100000) => ({ statistics: [{ mean, min: mean, max: mean, count, skipX: 1, skipY: 1 }] });
const target = (input: RequestInfo | URL) => new URL(new URL(String(input), 'http://localhost').searchParams.get('url')!);

test('25 km geometry uses a closed native-grid polygon and raw 100 m statistics', () => {
  const region = karhutlaRegion(-2.5, 114), center = project3395(114, -2.5);
  assert.equal(region.geometry.spatialReference.wkid, 3395);
  assert.equal(region.geometry.rings[0].length, 73);
  assert.deepEqual(region.geometry.rings[0][0], region.geometry.rings[0][72]);
  assert.ok(region.projectedArea > 1.9e9 && region.projectedArea < 2.1e9);
  assert.ok(Math.abs(region.geometry.rings[0][0][1] - center[1]) > 24000);
  const url = new URL(karhutlaStatisticsUrl(-2.5, 114).url);
  assert.equal(url.searchParams.get('pixelSize'), '100,100');
  assert.equal(url.searchParams.get('geometryType'), 'esriGeometryPolygon');
  assert.deepEqual(JSON.parse(url.searchParams.get('renderingRule')!), { rasterFunction: 'None' });
  assert.ok(('/api/proxy?url=' + encodeURIComponent(url.href)).length < 8000);
  assert.throws(() => karhutlaRegion(NaN, 114));
});
test('numeric statistics preserve mean precision, real zero, NoData, and estimated coverage', () => {
  const stats = parseKarhutlaStatistics(response(0.600001, 500), 1e7)!;
  assert.equal(stats.mean, 0.600001);
  assert.equal(stats.coveragePercent, 50);
  assert.equal(parseKarhutlaStatistics(response(0, 10), 1e7)?.mean, 0);
  assert.equal(parseKarhutlaStatistics({ statistics: [] }, 1e7), null);
  assert.equal(parseKarhutlaStatistics({ statistics: [{ count: 0 }] }, 1e7), null);
  const strided = response(0.4, 500);strided.statistics[0].skipX = 2;
  assert.equal(parseKarhutlaStatistics(strided, 1e7)?.coveragePercent, 100);
});
test('statistics errors, invalid values and rendered multiband data stay unavailable', () => {
  for (const value of [null, {}, { statistics: null }, { error: { message: 'Unavailable' } }, { statistics: [response().statistics[0], response().statistics[0]] }, response(12), response(0.5, -1), { statistics: [{ ...response().statistics[0], mean: null }] }, { statistics: [{ ...response().statistics[0], min: 0.6 }] }]) assert.throws(() => parseKarhutlaStatistics(value, 1e7));
});
test('regional mean drives shared scoring even when the exact office point is NoData', async t => {
  const office = makeOffice('regional-shared');
  t.mock.method(globalThis, 'fetch', async input => { assert.ok(target(input).pathname.endsWith('/computeStatisticsHistograms'));return Response.json(response(0.61)); });
  t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => { throw new Error('Exact-point source must not be used for Karhutla'); });
  await KarhutlaRegionalService.refresh([office], true);
  const assessment = resolveOfficeAssessment(office, 'karhutla');
  assert.equal(assessment.index, 0.61);assert.equal(assessment.factor, 3);
  assert.match(assessment.explanation, /100.000 sel valid/);
  for (const severity of [1, 2, 3] as const) {
    const alert: DisasterAlert = { id: 'regional-live', type: 'karhutla', severity, provinceId: office.provinceId, title: 'Fixture', description: 'Fixture', timestamp: new Date().toISOString(), latitude: office.latitude, longitude: office.longitude };
    assert.equal(scoreAlertForOffice(office.id, alert, office).totalScore, severity * 3);
    assert.equal(buildOfficeRiskMap([office], [alert]).get(office.id)?.riskScore, severity * 3);
    assert.equal(buildAlertRiskResult(alert, [office])?.riskScore, severity * 3);
  }
});
test('regional requests publish partial progress and never exceed four concurrent calculations', async t => {
  const offices = Array.from({ length: 12 }, (_, i) => makeOffice('regional-concurrent-' + i, 114 + i));
  let active = 0, max = 0, requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++;active++;max = Math.max(max, active);await nextTurn();active--;return Response.json(response(0.4)); });
  const counts: number[] = [];
  const unsubscribe = KarhutlaRegionalService.subscribe(() => counts.push(KarhutlaRegionalService.getAssessmentStatus().valueCount));
  try { await KarhutlaRegionalService.refresh(offices, true); } finally { unsubscribe(); }
  assert.equal(requests, 12);assert.equal(max, 4);assert.equal(KarhutlaRegionalService.getAssessmentStatus().status, 'available');
  assert.ok(counts.some(count => count > 0 && count < 12));assert.equal(counts.at(-1), 12);
});
test('cached numeric results avoid polling, expire after six hours, and support manual recalculation', async t => {
  const office = makeOffice('regional-cache');let calls = 0;let clock = Date.UTC(2026, 9, 6, 5);
  t.mock.method(Date, 'now', () => clock);
  t.mock.method(globalThis, 'fetch', async () => { calls++;return Response.json(response()); });
  await KarhutlaRegionalService.refresh([office], true);await KarhutlaRegionalService.refresh([office]);assert.equal(calls, 1);
  await KarhutlaRegionalService.refresh([office], true);assert.equal(calls, 2);
  clock += 6 * 3600000;await KarhutlaRegionalService.refresh([office]);assert.equal(calls, 3);
  await KarhutlaRegionalService.refresh([{ ...office, longitude: 115 }]);assert.equal(calls, 4);
});
test('area NoData, a valid zero and individual service errors remain distinct and retry recovers', async t => {
  const offices = [makeOffice('regional-zero', 110), makeOffice('regional-empty', 114), makeOffice('regional-error', 118)];
  let fail = true;
  t.mock.method(globalThis, 'fetch', async input => {
    const ring = JSON.parse(target(input).searchParams.get('geometry')!).rings[0];
    if (ring[0][0] < project3395(112, 0)[0]) return Response.json(response(0));
    if (ring[0][0] < project3395(116, 0)[0]) return Response.json({ statistics: [] });
    return Response.json(fail ? { error: { message: 'Fixture failure' } } : response(0.3));
  });
  await KarhutlaRegionalService.refresh(offices, true);
  assert.equal(KarhutlaRegionalService.getOfficeAssessment(offices[0].id)?.statistics?.mean, 0);
  assert.equal(KarhutlaRegionalService.getOfficeAssessment(offices[1].id)?.status, 'no_data');
  assert.equal(KarhutlaRegionalService.getOfficeAssessment(offices[2].id)?.status, 'error');
  assert.equal(KarhutlaRegionalService.getAssessmentStatus().status, 'partial');
  assert.equal(KarhutlaRegionalService.getAssessmentStatus().failedOfficeCount, 1);
  fail = false;await KarhutlaRegionalService.refresh(offices);
  assert.equal(KarhutlaRegionalService.getOfficeAssessment(offices[2].id)?.statistics?.mean, 0.3);
});
test('request timeout cancels the active source and leaves a clear error without hanging', async t => {
  const office = makeOffice('regional-timeout');const signals: AbortSignal[] = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', (_input, options) => { signals.push(options!.signal!);return new Promise<Response>(() => {}); });
  const promise = KarhutlaRegionalService.refresh([office], true);await nextTurn();
  t.mock.timers.tick(12000);await promise;
  assert.equal(signals[0].aborted, true);assert.equal(KarhutlaRegionalService.getOfficeAssessment(office.id)?.status, 'error');
});
test('the batch deadline retains completed areas and marks queued areas unavailable', async t => {
  const offices = Array.from({ length: 12 }, (_, i) => makeOffice('regional-deadline-' + i));let calls = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async () => { calls++;return calls === 1 ? Response.json(response(0.2)) : new Promise<Response>(() => {}); });
  const promise = KarhutlaRegionalService.refresh(offices, true);await nextTurn();
  t.mock.timers.tick(60000);await promise;
  assert.equal(KarhutlaRegionalService.getOfficeAssessment(offices[0].id)?.statistics?.mean, 0.2);
  assert.equal(KarhutlaRegionalService.getAssessmentStatus().valueCount, 1);
  assert.equal(KarhutlaRegionalService.getAssessmentStatus().failedOfficeCount, 11);
});
