import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
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


const { parseForecastTable, parseForecastDate, mapForecastWarning, publishForecastSnapshot, failForecastSnapshot, getProvinceForecast } = await import('../src/services/weatherForecastAssessment.ts');
const { resolveOfficeAssessment, distanceFactor } = await import('../src/utils/officeHazardAssessment.ts');
const { BnpbInariskService } = await import('../src/services/bnpbInariskService.ts');
const { KPWBI_OFFICES } = await import('../src/constants/kpwbiOffices.ts');
const { scoreAlertForOffice, buildOfficeRiskMap, buildAlertRiskResult, isInaRiskSupportedType } = await import('../src/utils/riskCalculator.ts');
const { pointInSourceGeometry, polygonLatLngs } = await import('../src/utils/polygonExposure.ts');
const { isOfficeAffectedByAlert } = await import('../src/utils/disasterImpact.ts');
const { KarhutlaRegionalService } = await import('../src/services/karhutlaRegionalService.ts');
const now = Date.UTC(2026, 9, 6, 5);
const office = KPWBI_OFFICES.find(o => o.provinceId === 'ID-RI')!;
const table = (values: string[], dates = ['6 Oct 2026', '7 Oct 2026', '8 Oct 2026'], name = 'Riau') => '<table><thead><tr><th>No</th><th>Provinsi</th>' + dates.map(date => '<th>' + date + '</th>').join('') + '</tr></thead><tbody><tr><td>1</td><td>' + name + '</td>' + values.map(value => '<td>' + value + '</td>').join('') + '</tr></tbody></table>';
const alert = (type: DisasterAlert['type'], severity: 1 | 2 | 3 = 2): DisasterAlert => ({ id: 'fixture', type, severity, provinceId: office.provinceId, title: 'Fixture', description: 'Fixture', timestamp: new Date(now).toISOString(), latitude: office.latitude, longitude: office.longitude });

test('weather mapping recognizes Awas and never guesses unknown or blank cells', () => {
  for (const [text, severity] of [['Awas Hujan Ekstrem', 3], ['Siaga', 3], ['Waspada', 2], ['Potensi', 1], ['Angin Kencang', 1], ['—', 0], ['Nihil', 0], ['', null], ['Unrecognized', null]] as const) assert.equal(mapForecastWarning(text), severity);
});
test('forecast dates are midnight WIB regardless of host timezone and reject invalid calendar days', () => {
  assert.equal(parseForecastDate('6 Oct 2026'), Date.UTC(2026, 9, 5, 17));
  assert.equal(parseForecastDate('6 Oktober 2026'), Date.UTC(2026, 9, 5, 17));
  assert.equal(parseForecastDate('31 Feb 2026'), null);
});
test('dated columns are discovered, sorted, and restricted to today plus two days', () => {
  const parsed = parseForecastTable(table(['Siaga', 'Waspada', 'Awas', 'Siaga'], ['8 Oct 2026', '6 Oct 2026', '9 Oct 2026', '5 Oct 2026']), now);
  assert.deepEqual(parsed.dates, ['6 Oct 2026', '8 Oct 2026']);
  assert.deepEqual(parsed.cells.map(c => c.severity), [2, 3]);
  assert.throws(() => parseForecastTable('<html>Not a forecast table</html>', now));
  assert.throws(() => parseForecastTable(table(['Waspada'], ['5 Oct 2026']), now));
});
test('forecast province matching preserves Kepulauan Riau and Papua provinces', () => {
  assert.equal(parseForecastTable(table(['Waspada'], ['6 Oct 2026'], 'Kepulauan Riau'), now).cells[0].provinceId, 'ID-KR');
  assert.equal(parseForecastTable(table(['Waspada'], ['6 Oct 2026'], 'Papua Pegunungan'), now).cells[0].provinceId, 'ID-PE');
});
test('explicit no-warning is zero, absent and unknown coverage is unavailable, expired cells clear', () => {
  publishForecastSnapshot(parseForecastTable(table(['—', 'Nihil', '—']), now));
  assert.equal(getProvinceForecast(office.provinceId, now).severity, 0);
  assert.equal(getProvinceForecast('ID-AC', now).severity, null);
  assert.equal(getProvinceForecast(office.provinceId, now + 3 * 86400000).severity, null);
  publishForecastSnapshot(parseForecastTable(table(['Waspada', 'Unknown', '—']), now));
  assert.equal(getProvinceForecast(office.provinceId, now).severity, null);
  publishForecastSnapshot(parseForecastTable(table(['Awas', 'Unknown', '—']), now));
  assert.equal(getProvinceForecast(office.provinceId, now).severity, 3);
  failForecastSnapshot();
  assert.equal(getProvinceForecast(office.provinceId, now).severity, null);
});
test('weather uses flood indices with alert severity consistently, independent of BMKG forecast', t => {
  t.mock.method(Date, 'now', () => now);
  const lookup = t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => 0);
  publishForecastSnapshot(parseForecastTable(table(['Awas', '—', '—']), now));
  for (const [index, factor] of [[0, 1], [0.3, 1], [0.300001, 2], [0.6, 2], [0.600001, 3]] as const) {
    lookup.mock.mockImplementation(() => index);
    for (const severity of [1, 2, 3] as const) {
      const input = alert('extreme_weather', severity), scored = scoreAlertForOffice(office.id, input);
      assert.equal(scored.totalScore, factor * severity);
      assert.equal(scored.assessment?.index, index);
      assert.equal(scored.assessment?.source, 'InaRISK');
      assert.match(scored.assessment!.explanation, /Banjir/);
      assert.equal(scored.isInaRiskSupported, true);
      assert.equal(buildOfficeRiskMap([office], [input]).get(office.id)?.riskScore, scored.totalScore);
      assert.equal(buildAlertRiskResult(input, [office])?.riskScore, scored.totalScore);
      assert.equal(buildAlertRiskResult({ ...input, isForecast: true }, [office]), null);
    }
  }
  lookup.mock.mockImplementation(() => null);
  assert.equal(scoreAlertForOffice(office.id, alert('extreme_weather')).totalScore, null);
  assert.equal(buildOfficeRiskMap([office], [alert('extreme_weather')]).size, 0);
});
test('geographic bands use unrounded distances at every boundary', () => {
  for (const [km, factor] of [[0, 3], [10, 3], [10.00001, 3], [30, 3], [30.00001, 2], [100, 2], [100.00001, 1]] as const) {
    assert.equal(distanceFactor(km), factor);
  }
});
test('MAGMA coordinates produce the agreed office distribution without InaRISK lookups', t => {
  t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => { throw new Error('Geographic scoring must not use InaRISK'); });
  for (const [hazard, counts] of [['volcanic', [21, 20, 7]], ['volcanic_ash', [21, 20, 7]]] as const) {
    const factors = KPWBI_OFFICES.map(o => resolveOfficeAssessment(o, hazard).factor);
    assert.deepEqual([1, 2, 3].map(f => factors.filter(x => x === f).length), counts);
    assert.equal(isInaRiskSupportedType(hazard), false);
  }
  for (const office of KPWBI_OFFICES) {
    assert.deepEqual(resolveOfficeAssessment(office, 'volcanic'), resolveOfficeAssessment(office, 'volcanic_ash'));
    assert.equal(scoreAlertForOffice(office.id, alert('volcanic', 2)).totalScore, scoreAlertForOffice(office.id, alert('volcanic_ash', 2)).totalScore);
  }
  const ternate = KPWBI_OFFICES.find(o => o.provinceId === 'ID-MU')!;
  assert.equal(scoreAlertForOffice(ternate.id, alert('volcanic', 3)).totalScore, 9);
  assert.equal(scoreAlertForOffice(ternate.id, alert('volcanic_ash', 2)).totalScore, 6);
});
test('karhutla distinguishes regional NoData from a valid zero without point lookups', t => {
  t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => { throw new Error('Karhutla must use regional statistics'); });
  const lookup = t.mock.method(KarhutlaRegionalService, 'getOfficeAssessment', () => ({ status: 'no_data' as const, statistics: null, checkedAt: null, radiusKm: 25, error: null }));
  assert.equal(resolveOfficeAssessment(office, 'karhutla').index, null);
  assert.match(resolveOfficeAssessment(office, 'karhutla').explanation, /radius 25 km/);
  assert.equal(scoreAlertForOffice(office.id, alert('karhutla', 3)).totalScore, null);
  lookup.mock.mockImplementation(() => ({ status: 'available', statistics: { mean: 0, min: 0, max: 0, validCellCount: 4, coveragePercent: 0.02, skipX: 1, skipY: 1 }, checkedAt: null, radiusKm: 25, error: null }));
  assert.equal(resolveOfficeAssessment(office, 'karhutla').index, 0);
  assert.equal(scoreAlertForOffice(office.id, alert('karhutla', 3)).totalScore, 3);
});
const outer = [[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]], hole = [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]];
test('SIGMET geometry includes outer boundaries, excludes holes, and handles multiple polygons', () => {
  const polygon = { type: 'Polygon', coordinates: [outer, hole] };
  assert.equal(pointInSourceGeometry(3, 3, polygon), true);
  assert.equal(pointInSourceGeometry(0, 3, polygon), true);
  assert.equal(pointInSourceGeometry(1.5, 1.5, polygon), false);
  assert.equal(pointInSourceGeometry(1, 1.5, polygon), false);
  assert.equal(pointInSourceGeometry(8, 8, polygon), false);
  assert.equal(pointInSourceGeometry(13, 13, { type: 'MultiPolygon', coordinates: [[outer], [outer.map(([x, y]) => [x + 10, y + 10])]] }), true);
  assert.equal(pointInSourceGeometry(1, 1, { type: 'Polygon', coordinates: [[[0, 0]]] }), false);
});
test('ash exposure requires an active polygon, even when the centroid is far away', t => {
  t.mock.method(Date, 'now', () => now);
  const input = { ...alert('volcanic_ash'), latitude: 40, longitude: 40, sourceGeometry: { type: 'Polygon', coordinates: [outer] }, validFrom: new Date(now - 1000).toISOString(), validUntil: new Date(now + 1000).toISOString() };
  assert.equal(isOfficeAffectedByAlert({ ...office, latitude: 3, longitude: 3 }, input), true);
  assert.equal(isOfficeAffectedByAlert({ ...office, latitude: 8, longitude: 8 }, input), false);
  assert.equal(isOfficeAffectedByAlert({ ...office, latitude: 3, longitude: 3 }, { ...input, validUntil: new Date(now - 1).toISOString() }), false);
});
test('SIGMET display preserves holes and multiple polygons used by eligibility', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [[outer, hole], [outer.map(([x, y]) => [x + 10, y + 10])]] };
  const positions = polygonLatLngs(geometry)!;
  assert.equal(positions.length, 2);
  assert.equal(positions[0].length, 2);
  assert.deepEqual(positions[0][1][1], [hole[1][1], hole[1][0]]);
  assert.equal(polygonLatLngs({ type: 'Polygon', coordinates: [[[1, 2]]] }), null);
});
test('SIGMET adapter retains distinct active warnings for one volcano and rejects expired warnings', async t => {
  t.mock.method(Date, 'now', () => now);
  const { InaSiamService } = await import('../src/services/inaSiamService.ts');
  const feature = (end: number, geometry: unknown) => ({ properties: { hazard: 'VA', rawSigmet: 'SEMERU VA SIGMET', validTimeFrom: new Date(now - 1000).toISOString(), validTimeTo: new Date(end).toISOString() }, geometry });
  const first = { type: 'Polygon', coordinates: [outer, hole] };
  const second = { type: 'MultiPolygon', coordinates: [[outer], [outer.map(([x, y]) => [x + 10, y + 10])]] };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [feature(now + 1000, first), feature(now + 2000, second), feature(now - 1, first)] }));
  const alerts = await InaSiamService.fetchLiveAlerts();
  assert.equal(alerts.length, 2);
  assert.notEqual(alerts[0].id, alerts[1].id);
  assert.deepEqual(alerts.map(alert => alert.sourceGeometry), [first, second]);
  assert.ok(alerts.every(alert => alert.severity === 2));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [feature(now + 2000, second), feature(now + 1000, first)] }));
  const reordered = await InaSiamService.fetchLiveAlerts();
  assert.deepEqual(reordered.map(a => a.id).sort(), alerts.map(a => a.id).sort());
  assert.ok(InaSiamService.getSigmetForVolcano('Semeru'));
  t.mock.method(Date, 'now', () => now + 2001);
  assert.equal(InaSiamService.getSigmetForVolcano('Semeru'), null);
});

test('province-only live weather warnings use flood factors for notification eligibility', t => {
  t.mock.method(Date, 'now', () => now);
  t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => 0.8);
  publishForecastSnapshot(parseForecastTable(table(['—', '—', '—']), now));
  for (const severity of [1, 2, 3] as const) {
    const input = { ...alert('extreme_weather', severity), latitude: undefined, longitude: undefined };
    assert.equal(scoreAlertForOffice(office.id, input).totalScore, severity * 3);
    const result = buildAlertRiskResult(input, [office]);
    assert.equal(result?.riskScore, severity * 3);
    assert.equal(result?.shouldAlert, severity === 3);
    assert.equal(input.latitude, undefined);
    assert.equal(buildAlertRiskResult({ ...input, isForecast: true }, [office]), null);
  }
});
