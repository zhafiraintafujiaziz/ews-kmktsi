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

const { BnpbInariskService, parseHazardIndex } = await import('../src/services/bnpbInariskService.ts');
const { BnpbIrbiService } = await import('../src/services/bnpbIrbiService.ts');
const { INARISK_HAZARD_SERVICES, INARISK_CATEGORIES, getHazardLevel, getHazardSeverity, getInaRiskAssessmentEndpoint } = await import('../src/constants/kerentananCategories.ts');
const { EARTHQUAKE_WMS_SERVICE, earthquakeHazardUrl, parseEarthquakeHazardValue } = await import('../src/services/earthquakeHazard.ts');
const { scoreAlertForOffice, mapInariskToHazard, isInaRiskSupportedType } = await import('../src/utils/riskCalculator.ts');
const { fetchWithCorsProxy } = await import('../src/services/proxy.ts');
const { KPWBI_OFFICES } = await import('../src/constants/kpwbiOffices.ts');
const { getKerentananHighSummary, getKerentananHeaderBand } = await import('../src/utils/kerentananAssessment.ts');
const { refreshBackgroundAssessments } = await import('../src/services/assessmentSync.ts');
const { createAlertStore } = await import('../src/domain/alertStore.ts');
const { logSyncFailure } = await import('../src/services/syncDiagnostics.ts');
const office = KPWBI_OFFICES[0];
const secondOffice = { ...office, id: 'second', longitude: office.longitude + 1 };
const missingOffice = { ...office, id: 'missing', longitude: office.longitude + 2 };
const sources = ['earthquake', 'extreme_weather', 'karhutla', 'volcanic'] as const;
const hazards = [...sources, 'volcanic_ash'] as const;

function targetOf(input: RequestInfo | URL): URL {
  return new URL(new URL(String(input), 'http://localhost').searchParams.get('url')!);
}

function alert(type: DisasterAlert['type'], severity: 1 | 2 | 3): DisasterAlert {
  return {
    id: 'fixture-' + type, type, severity, provinceId: office.provinceId,
    title: 'Synthetic fixture', description: 'Synthetic fixture',
    timestamp: new Date().toISOString(), latitude: office.latitude, longitude: office.longitude,
  };
}

function fixture(target: URL, offices = [office], value: unknown = 0.8): Response {
  if (isEarthquakeRequest(target) || isWeatherRequest(target)) {
    requestedOffice(target, offices);
    return earthquakeFixture(value);
  }
  assert.ok(target.pathname.endsWith('/getSamples'));
  return Response.json({ samples: offices.map((o, locationId) => ({
    locationId, value, location: { x: o.longitude, y: o.latitude, spatialReference: { wkid: 4326 } },
  })) });
}

function isEarthquakeRequest(target: URL): boolean {
  return target.hostname === 'inarisk1.bnpb.go.id' && target.searchParams.get('request') === 'GetFeatureInfo'
    && target.searchParams.get('query_layers') === INARISK_HAZARD_SERVICES.earthquake;
}

function isWeatherRequest(target: URL): boolean {
  return target.hostname === 'inarisk1.bnpb.go.id' && target.searchParams.get('request') === 'GetFeatureInfo'
    && target.searchParams.get('query_layers') === INARISK_HAZARD_SERVICES.extreme_weather;
}

function requestedOffice(target: URL, offices = [office]) {
  const [west, south, east, north] = target.searchParams.get('bbox')!.split(',').map(Number);
  const longitude = (west + east) / 2, latitude = (south + north) / 2;
  const found = offices.find(o => Math.abs(o.longitude - longitude) < 1e-7 && Math.abs(o.latitude - latitude) < 1e-7);
  assert.ok(found, 'WMS pixel must be centered on a requested office');
  return found;
}

function earthquakeFixture(value: unknown = 0.8): Response {
  return Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: { GRAY_INDEX: value } }] });
}

test('six tabs use four portal Bahaya services; ash shares eruption data', () => {
  assert.deepEqual(INARISK_CATEGORIES.map(c => c.key), [...sources, 'volcanic_ash', 'air_quality']);
  assert.deepEqual(INARISK_HAZARD_SERVICES, {
    earthquake: 'raster:INDEKS_BAHAYA_GEMPABUMI1',
    extreme_weather: 'raster:INDEKS_BAHAYA_CUACAEKSTRIM1',
    karhutla: 'layer_bahaya_kebakaran_hutan_dan_lahan/ImageServer',
    volcanic: 'layer_bahaya_letusan_gunungapi/ImageServer',
  });
  assert.equal(INARISK_CATEGORIES.find(c => c.key === 'extreme_weather')?.inariskLabel, 'Cuaca Ekstrim');
  assert.equal(INARISK_CATEGORIES.find(c => c.key === 'volcanic_ash')?.inariskLabel, 'Letusan Gunung Api');
});

test('indices preserve zero and accept only tiny floating point overshoot', () => {
  for (const value of [0, 0.6, 1, '0', '0.61', ' 1 ']) assert.equal(parseHazardIndex(value), Number(value));
  assert.equal(parseHazardIndex(1.0000001192092896), 1);
  assert.equal(parseHazardIndex(-0.0000001), 0);
  assert.equal(parseHazardIndex(1.000001), 1);
  assert.equal(parseHazardIndex(-0.000001), 0);
  for (const value of [null, undefined, '', ' ', 'NoData', 'NaN', 'Infinity', -0.000002, 1.000002, -1, 2, 3, Infinity, NaN, true, false, [], {}]) {
    assert.equal(parseHazardIndex(value), null);
  }
});

test('official 0.3 and 0.6 boundaries classify raw indices before rounding', () => {
  for (const [index, level, severity] of [
    [0, 'Rendah', 1], [0.299999, 'Rendah', 1], [0.3, 'Rendah', 1],
    [0.300001, 'Sedang', 2], [0.304, 'Sedang', 2], [0.6, 'Sedang', 2],
    [0.600001, 'Tinggi', 3], [0.604, 'Tinggi', 3], [1, 'Tinggi', 3],
    [0.381593704, 'Sedang', 2], [0.502805829, 'Sedang', 2], [0.858585835, 'Tinggi', 3],
  ] as const) {
    assert.equal(getHazardLevel(index), level);
    assert.equal(mapInariskToHazard(index), level);
    assert.equal(getHazardSeverity(index), severity);
  }
});

test('earthquake uses the Kerentanan page IRBI factor with severity-only elevation', t => {
  const lookup = t.mock.method(BnpbIrbiService, 'getIndex', () => 0);
  for (const type of ['earthquake'] as const) {
    assert.equal(isInaRiskSupportedType(type), true);
    for (const [index, assessment] of [[0, 1], [0.4, 2], [0.7, 3]] as const) {
      lookup.mock.mockImplementation(() => index);
      for (const severity of [1, 2, 3] as const) {
        const result = scoreAlertForOffice(office.id, alert(type, severity));
        assert.equal(result.assessmentScore, assessment);
        assert.equal(result.totalScore, [[1, 2, 3], [2, 4, 6], [9, 9, 9]][severity - 1][assessment - 1]);
        assert.equal(result.riskLevel, [['Rendah', 'Rendah', 'Sedang'], ['Rendah', 'Sedang', 'Tinggi'], ['Tinggi', 'Tinggi', 'Tinggi']][severity - 1][assessment - 1]);
        assert.deepEqual(lookup.mock.calls.at(-1)?.arguments, [office.id, type]);
      }
    }
    lookup.mock.mockImplementation(() => null);
    assert.equal(scoreAlertForOffice(office.id, alert(type, 3)).totalScore, 9);
    for (const severity of [1, 2] as const) {
      assert.equal(scoreAlertForOffice(office.id, alert(type, severity)).totalScore, null);
    }
  }
});

test('unsupported disasters and ISPU never query InaRISK', t => {
  const lookup = t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => { throw new Error('Unexpected index lookup'); });
  for (const type of ['flood', 'tsunami', 'kekeringan', 'landslide'] as const) {
    const result = scoreAlertForOffice(office.id, alert(type, 3));
    assert.equal(result.isInaRiskSupported, false);
    assert.equal(result.assessmentScore, null);
    assert.equal(result.totalScore, null);
  }
  for (const severity of [1, 2, 3] as const) {
    const result = scoreAlertForOffice(office.id, alert('air_quality', severity));
    assert.equal(result.totalScore, [1, 4, 9][severity - 1]);
    assert.equal(result.assessmentScore, null);
  }
  assert.equal(lookup.mock.callCount(), 0);
});

test('point queries and reordered multipoint samples map values to offices and preserve zero', async t => {
  const urls: URL[] = [];
  const offices = [office, secondOffice, missingOffice];
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    urls.push(target);
    if (isEarthquakeRequest(target) || isWeatherRequest(target)) {
      const requested = requestedOffice(target, offices);
      return earthquakeFixture(requested.id === office.id ? '0' : requested.id === secondOffice.id ? '0.61' : 'NoData');
    }
    const geometry = JSON.parse(target.searchParams.get('geometry')!);
    assert.equal(geometry.spatialReference.wkid, 4326);
    assert.ok(target.pathname.endsWith('/getSamples'));
    assert.equal(target.searchParams.get('geometryType'), 'esriGeometryMultipoint');
    assert.deepEqual(geometry.points, offices.map(o => [o.longitude, o.latitude]));
    return Response.json({ samples: [
      { value: '0.61', locationId: 1 }, { value: '0', locationId: 0 },
      ...[null, '', 'NoData', true, 3].map(value => ({ value, locationId: 2 })),
      { value: 0.8, location: { x: 0, y: 0 } }, { value: 0.9 }, null,
    ] });
  });
  await BnpbInariskService.refreshAssessment(offices);
  assert.equal(urls.length, sources.length - 2 + offices.length * 2);
  for (const type of hazards) {
    assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, type), 0);
    assert.equal(BnpbInariskService.getLocalHazardIndex(secondOffice.id, type), 0.61);
    assert.equal(BnpbInariskService.getLocalHazardIndex(missingOffice.id, type), null);
    assert.equal(BnpbInariskService.getAssessmentStatus(type).status, 'partial');
  }
  assert.equal(urls.filter(u => u.pathname.includes(INARISK_HAZARD_SERVICES.volcanic)).length, 1);
  assert.strictEqual(BnpbInariskService.getAssessmentStatus('volcanic_ash'), BnpbInariskService.getAssessmentStatus('volcanic'));
  assert.equal(scoreAlertForOffice(secondOffice.id, alert('earthquake', 3), secondOffice).totalScore, 9);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'flood'), null);
});

test('categories publish independently, notify subscribers, and recover after an isolated error', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let failWeather = false;
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    if (target.pathname.includes(INARISK_HAZARD_SERVICES.volcanic)) await gate;
    if (failWeather && isWeatherRequest(target)) return Response.json({ error: { code: 503, message: 'Synthetic category failure' } });
    return fixture(target);
  });
  const publications: number[] = [];
  let firstPublish!: () => void;
  const published = new Promise<void>(resolve => { firstPublish = resolve; });
  const unsubscribe = BnpbInariskService.subscribe(() => {
    publications.push(BnpbInariskService.getRevision());
    if (BnpbInariskService.getAssessmentStatus('earthquake').status === 'available') firstPublish();
  });
  t.after(unsubscribe);
  const refresh = BnpbInariskService.refreshAssessment([office]);
  assert.equal(BnpbInariskService.getAssessmentStatus('volcanic_ash').status, 'loading');
  assert.match(BnpbInariskService.getAssessmentMessage('volcanic_ash'), /Memuat/);
  await published;
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake'), 0.8);
  assert.equal(BnpbInariskService.getAssessmentStatus('volcanic').status, 'loading');
  release();
  await refresh;
  assert.equal(publications.length, 8);
  failWeather = true;
  await assert.rejects(BnpbInariskService.refreshAssessment([office]), AggregateError);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'extreme_weather'), null);
  assert.equal(BnpbInariskService.getAssessmentStatus('extreme_weather').status, 'error');
  assert.match(BnpbInariskService.getAssessmentMessage('extreme_weather'), /gagal merespons/);
  for (const type of ['earthquake', 'karhutla', 'volcanic', 'volcanic_ash'] as const) assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, type), 0.8);
  failWeather = false;
  await BnpbInariskService.refreshAssessment([office]);
  assert.equal(BnpbInariskService.getAssessmentStatus('extreme_weather').status, 'available');
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'extreme_weather'), 0.8);
  const count = publications.length;
  unsubscribe();
  await BnpbInariskService.refreshAssessment([office]);
  assert.equal(publications.length, count);
});

test('NoData clears old values and is distinct from malformed responses', async t => {
  let malformed = false;
  t.mock.method(globalThis, 'fetch', async input => Response.json(malformed ? {} : (isEarthquakeRequest(targetOf(input)) || isWeatherRequest(targetOf(input))) ? { type: 'FeatureCollection', features: [] } : { samples: [] }));
  await BnpbInariskService.refreshAssessment([office]);
  for (const type of hazards) {
    assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, type), null);
    assert.equal(BnpbInariskService.getAssessmentStatus(type).status, 'no_data');
    assert.match(BnpbInariskService.getAssessmentMessage(type), /tidak menyediakan nilai/);
  }
  malformed = true;
  await assert.rejects(BnpbInariskService.refreshAssessment([office]), AggregateError);
  for (const type of hazards) assert.equal(BnpbInariskService.getAssessmentStatus(type).status, 'error');
});

test('partial earthquake point results distinguish NoData from request failures', async t => {
  const diagnostics = t.mock.method(console, 'error', () => {});
  const noData = t.mock.method(console, 'info', () => {});
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    if (isEarthquakeRequest(target)) {
      const requested = requestedOffice(target, [office, secondOffice, missingOffice]);
      return requested.id === missingOffice.id ? Response.json({ type: 'FeatureCollection', features: [] }) : earthquakeFixture(requested.id === office.id ? '0.4' : 'NoData');
    }
    return fixture(target, [office, secondOffice, missingOffice]);
  });
  await BnpbInariskService.refreshAssessment([office, secondOffice, missingOffice]);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake'), 0.4);
  const status = BnpbInariskService.getAssessmentStatus('earthquake');
  assert.equal(status.status, 'partial');
  assert.equal(status.valueCount, 1);
  assert.equal(status.failedOfficeCount, 0);
  assert.match(BnpbInariskService.getAssessmentMessage('earthquake', secondOffice.id), /tidak menyediakan nilai/);
  assert.match(BnpbInariskService.getAssessmentMessage('earthquake', missingOffice.id), /tidak menyediakan nilai/);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'extreme_weather'), 0.8);
  assert.equal(diagnostics.mock.callCount(), 0);
  const detail = noData.mock.calls[0].arguments[1];
  assert.equal(detail.category, 'earthquake');
  assert.equal(detail.endpoint, EARTHQUAKE_WMS_SERVICE);
  assert.equal(detail.valueCount, 1);
  assert.equal(detail.failedOfficeCount, 0);
  assert.equal(detail.noDataOfficeCount, 2);
  assert.ok(noData.mock.calls.some(call => call.arguments[1].kind === 'no_data'));
});

test('background IRBI assessment runs once, skips overlap, and recovers after a failure', async t => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let fail = true;
  let calls = 0;
  t.mock.method(BnpbIrbiService, 'refreshAssessment', async () => {
    calls++;
    if (fail) { await gate; throw new AggregateError([new Error('Synthetic IRBI failure')]); }
  });
  const diagnostics = t.mock.method(console, 'error', () => {});
  const first = refreshBackgroundAssessments();
  await nextTurn();
  assert.equal(calls, 1);
  const second = refreshBackgroundAssessments();
  await nextTurn();
  assert.equal(calls, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(diagnostics.mock.callCount(), 1);
  fail = false;
  await refreshBackgroundAssessments();
  assert.equal(calls, 2);
  assert.equal(diagnostics.mock.callCount(), 1);
});

test('minute scheduling refreshes the IRBI assessment each minute', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.UTC(2026, 9, 14) });
  let calls = 0;
  t.mock.method(BnpbIrbiService, 'refreshAssessment', async () => { calls++; });
  const store = createAlertStore({ feeds: [], loadSnapshots: async () => [], refreshAssessments: refreshBackgroundAssessments });
  const unsubscribe = store.subscribe(() => {});
  t.after(unsubscribe);
  await nextTurn();
  assert.equal(calls, 1);
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(calls, 2);
  unsubscribe();
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(calls, 2);
});

test('minute scheduling retries a failed IRBI refresh and logs the sync failure', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: Date.UTC(2026, 9, 14) });
  let calls = 0;
  let fail = true;
  const diagnostics = t.mock.method(console, 'error', () => {});
  t.mock.method(BnpbIrbiService, 'refreshAssessment', async () => {
    calls++;
    if (fail) throw new AggregateError([Object.assign(new Error('Synthetic IRBI failure'), { kind: 'service_error', status: 500 })]);
  });
  const store = createAlertStore({ feeds: [], loadSnapshots: async () => [], refreshAssessments: refreshBackgroundAssessments });
  const unsubscribe = store.subscribe(() => {});
  t.after(unsubscribe);
  await nextTurn();
  assert.equal(calls, 1);
  assert.equal(diagnostics.mock.callCount(), 1);
  fail = false;
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(calls, 2);
  assert.equal(diagnostics.mock.callCount(), 1);
  unsubscribe();
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(calls, 2);
});

for (const source of ['earthquake', 'extreme_weather'] as const) test(source + ' point results keep office identity when requests complete out of order', async t => {
  const offices = [office, secondOffice, missingOffice];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async input => {
    const requested = requestedOffice(targetOf(input), offices);
    if (requested.id === office.id) { await gate; return earthquakeFixture('0'); }
    if (requested.id === secondOffice.id) return earthquakeFixture('0.61');
    return earthquakeFixture('NoData');
  });
  const refresh = BnpbInariskService.refreshAssessment(offices, [source]);
  await nextTurn();
  release();
  await refresh;
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, source), 0);
  assert.equal(BnpbInariskService.getLocalHazardIndex(secondOffice.id, source), 0.61);
  assert.equal(BnpbInariskService.getLocalHazardIndex(missingOffice.id, source), null);
  assert.equal(BnpbInariskService.getAssessmentStatus(source).valueCount, 2);
});

test('console diagnostics distinguish invalid JSON, service errors, and timeouts', t => {
  const diagnostics = t.mock.method(console, 'error', () => {});
  logSyncFailure({ source: 'InaRISK', category: 'earthquake', endpoint: 'https://gis.bnpb.go.id/identify' }, new AggregateError([
    new SyntaxError('Unexpected token <'), Object.assign(new Error('Raster service failed'), { kind: 'service_error', status: 500 }),
    new Error('InaRISK category request timed out after 14000 ms'),
  ]));
  const detail = diagnostics.mock.calls[0].arguments[1];
  assert.deepEqual(detail.errors.map((error: { kind: string }) => error.kind), ['invalid_response', 'service_error', 'timeout']);
});

for (const source of ['earthquake', 'extreme_weather'] as const) test('all 48 ' + source + ' offices query only their Bahaya raster at their exact coordinates', async t => {
  const offices = KPWBI_OFFICES;
  const requestedIds: string[] = [];
  let active = 0, peak = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async input => {
    assert.ok(String(input).startsWith('/api/proxy?url='));
    const target = targetOf(input);
    assert.equal(target.origin + target.pathname, EARTHQUAKE_WMS_SERVICE);
    assert.equal(target.searchParams.get('service'), 'WMS');
    assert.equal(target.searchParams.get('version'), '1.1.1');
    assert.equal(target.searchParams.get('request'), 'GetFeatureInfo');
    assert.equal(target.searchParams.get('layers'), INARISK_HAZARD_SERVICES[source]);
    assert.equal(target.searchParams.get('query_layers'), INARISK_HAZARD_SERVICES[source]);
    assert.equal(target.searchParams.get('srs'), 'EPSG:4326');
    assert.equal(target.searchParams.get('info_format'), 'application/json');
    assert.equal(target.searchParams.get('format'), 'image/png');
    for (const key of ['width', 'height']) assert.equal(target.searchParams.get(key), '1');
    for (const key of ['x', 'y', 'buffer']) assert.equal(target.searchParams.get(key), '0');
    const requested = requestedOffice(target, offices);
    requestedIds.push(requested.id);
    const [west, south, east, north] = target.searchParams.get('bbox')!.split(',').map(Number);
    assert.ok(Math.abs(east - west - 0.0001) < 1e-9);
    assert.ok(Math.abs(north - south - 0.0001) < 1e-9);
    assert.ok(!target.href.includes('RISIKO') && !target.href.includes('KERENTANAN'));
    active++; peak = Math.max(peak, active);
    await gate;
    active--;
    return earthquakeFixture(requestedIds.indexOf(requested.id) / (offices.length - 1));
  });
  const refresh = BnpbInariskService.refreshAssessment(offices, [source]);
  await nextTurn();
  assert.equal(requestedIds.length, 6);
  release();
  await refresh;
  assert.equal(peak, 6);
  assert.equal(new Set(requestedIds).size, offices.length);
  assert.equal(requestedIds.length, offices.length);
  assert.equal(BnpbInariskService.getAssessmentStatus(source).status, 'available');
  for (const requested of offices) {
    assert.equal(BnpbInariskService.getLocalHazardIndex(requested.id, source), requestedIds.indexOf(requested.id) / (offices.length - 1));
  }
});

test('earthquake and extreme weather use separate Bahaya layers and retain independent values', async t => {
  let failWeather = false;
  const layers: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    requestedOffice(target);
    layers.push(target.searchParams.get('query_layers')!);
    if (isEarthquakeRequest(target)) return earthquakeFixture(0.8);
    assert.ok(isWeatherRequest(target));
    if (failWeather) return Response.json({ error: { code: 503, message: 'Synthetic weather failure' } });
    return earthquakeFixture(0);
  });
  await BnpbInariskService.refreshAssessment([office], ['earthquake', 'extreme_weather']);
  assert.deepEqual(layers.sort(), [INARISK_HAZARD_SERVICES.earthquake, INARISK_HAZARD_SERVICES.extreme_weather].sort());
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake'), 0.8);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'extreme_weather'), 0);
  failWeather = true;
  await assert.rejects(BnpbInariskService.refreshAssessment([office], ['extreme_weather']), AggregateError);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'extreme_weather'), null);
  assert.equal(BnpbInariskService.getAssessmentStatus('extreme_weather').status, 'error');
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake'), 0.8);
  assert.equal(BnpbInariskService.getAssessmentStatus('earthquake').status, 'available');
  failWeather = false;
  await BnpbInariskService.refreshAssessment([office], ['extreme_weather']);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'extreme_weather'), 0);
  assert.equal(BnpbInariskService.getAssessmentStatus('extreme_weather').status, 'available');
});

test('earthquake parser preserves raw zero and decimal values without inventing class indices', () => {
  for (const value of [0, 0.5538657903671265, 1, '0.61', null, 'NoData']) {
    assert.equal(parseEarthquakeHazardValue({ type: 'FeatureCollection', features: [{ properties: { GRAY_INDEX: value } }] }), value);
  }
  assert.equal(parseEarthquakeHazardValue({ type: 'FeatureCollection', features: [] }), null);
  for (const data of [{}, { samples: [] }, { type: 'FeatureCollection', features: null }, { type: 'FeatureCollection', features: [null] }, { type: 'FeatureCollection', features: [{}] }, { type: 'FeatureCollection', features: [{ properties: { level: 'Tinggi' } }] }]) {
    assert.throws(() => parseEarthquakeHazardValue(data));
  }
  const target = new URL(earthquakeHazardUrl(office));
  assert.equal(requestedOffice(target).id, office.id);
  assert.equal(getInaRiskAssessmentEndpoint('earthquake'), EARTHQUAKE_WMS_SERVICE);
  assert.equal(getInaRiskAssessmentEndpoint('extreme_weather'), EARTHQUAKE_WMS_SERVICE);
});

test('failed earthquake point requests preserve completed values and allow recovery', async t => {
  const offices = [office, secondOffice, missingOffice];
  let fail = true;
  const diagnostics = t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    if (!isEarthquakeRequest(target)) return fixture(target, offices);
    const requested = requestedOffice(target, offices);
    if (fail && requested.id === secondOffice.id) return Response.json({ error: { code: 500, message: 'Synthetic point failure' } });
    return earthquakeFixture(requested.id === missingOffice.id ? 'NoData' : 0.5538657903671265);
  });
  await BnpbInariskService.refreshAssessment(offices);
  const status = BnpbInariskService.getAssessmentStatus('earthquake');
  assert.equal(status.status, 'partial');
  assert.equal(status.valueCount, 1);
  assert.equal(status.failedOfficeCount, 1);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake'), 0.5538657903671265);
  assert.match(BnpbInariskService.getAssessmentMessage('earthquake', secondOffice.id), /gagal merespons/);
  assert.match(BnpbInariskService.getAssessmentMessage('earthquake', missingOffice.id), /tidak menyediakan nilai/);
  assert.equal(BnpbInariskService.getAssessmentStatus('extreme_weather').status, 'available');
  assert.equal(diagnostics.mock.callCount(), 1);
  fail = false;
  await BnpbInariskService.refreshAssessment(offices, ['earthquake']);
  assert.equal(BnpbInariskService.getAssessmentStatus('earthquake').failedOfficeCount, 0);
  assert.equal(BnpbInariskService.getLocalHazardIndex(secondOffice.id, 'earthquake'), 0.5538657903671265);
});

for (const source of ['earthquake', 'extreme_weather'] as const) test(source + ' request deadlines abort stalled calls, advance the queue, and permit recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const offices = Array.from({ length: 8 }, (_, i) => ({ ...office, id: 'deadline-' + i, longitude: office.longitude + i * 0.01 }));
  const pendingSignals: AbortSignal[] = [];
  let hang = false;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const target = targetOf(input);
    if (hang && (source === 'earthquake' ? isEarthquakeRequest(target) : isWeatherRequest(target))) {
      pendingSignals.push(options!.signal!);
      return new Promise<Response>(() => {});
    }
    return fixture(target, offices);
  });
  await BnpbInariskService.refreshAssessment(offices);
  hang = true;
  const refresh = BnpbInariskService.refreshAssessment(offices);
  const rejected = assert.rejects(refresh, AggregateError);
  await nextTurn();
  assert.equal(pendingSignals.length, 6);
  assert.equal(BnpbInariskService.getAssessmentStatus(source === 'earthquake' ? 'extreme_weather' : 'earthquake').status, 'available');
  t.mock.timers.tick(8_000);
  await nextTurn();
  assert.equal(pendingSignals.length, offices.length);
  assert(pendingSignals.slice(0, 6).every(signal => signal.aborted));
  t.mock.timers.tick(8_000);
  await rejected;
  assert(pendingSignals.every(signal => signal.aborted));
  const status = BnpbInariskService.getAssessmentStatus(source);
  assert.equal(status.status, 'error');
  assert.equal(status.valueCount, 0);
  assert.equal(status.failedOfficeCount, offices.length);
  assert.match(status.error!, /timed out/);
  for (const requested of offices) assert.equal(BnpbInariskService.getLocalHazardIndex(requested.id, source), null);
  hang = false;
  await BnpbInariskService.refreshAssessment(offices, [source]);
  assert.equal(BnpbInariskService.getAssessmentStatus(source).status, 'available');
  assert.equal(BnpbInariskService.getAssessmentStatus(source).failedOfficeCount, 0);
});

test('the earthquake category deadline aborts active requests and leaves queued offices unrequested', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const offices = Array.from({ length: 60 }, (_, i) => ({ ...office, id: 'category-' + i, longitude: office.longitude + i * 0.01 }));
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', async (_input, options) => {
    signals.push(options!.signal!);
    return new Promise<Response>(() => {});
  });
  const refresh = BnpbInariskService.refreshAssessment(offices, ['earthquake']);
  const rejected = assert.rejects(refresh, AggregateError);
  await nextTurn();
  for (let wave = 0; wave < 3; wave++) { t.mock.timers.tick(8_000); await nextTurn(); }
  assert.equal(signals.length, 24);
  t.mock.timers.tick(6_000);
  await rejected;
  assert(signals.every(signal => signal.aborted));
  assert.equal(signals.length, 24);
  assert.equal(BnpbInariskService.getAssessmentStatus('earthquake').failedOfficeCount, offices.length);
  assert.equal(BnpbInariskService.getAssessmentStatus('earthquake').status, 'error');
});

test('an entirely timed-out source reports error while other sources remain available', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    if (target.pathname.includes(INARISK_HAZARD_SERVICES.volcanic)) return new Promise<Response>(() => {});
    return fixture(target);
  });
  const refresh = BnpbInariskService.refreshAssessment([office]);
  const rejected = assert.rejects(refresh, AggregateError);
  await nextTurn();
  t.mock.timers.tick(14_000);
  await rejected;
  assert.equal(BnpbInariskService.getAssessmentStatus('volcanic_ash').status, 'error');
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake'), 0.8);
});

test('an HTML local proxy response falls back to a valid JSON response', async t => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async input => {
    urls.push(String(input));
    return urls.length === 1 ? new Response('<!doctype html><html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }) : Response.json({ samples: [] });
  });
  assert.deepEqual(await fetchWithCorsProxy('https://gis.bnpb.go.id/server/rest/services/inarisk/layer_bahaya_cuaca_ekstrim/ImageServer/getSamples?f=json'), { samples: [] });
  assert.equal(urls.length, 2);
});

test('caller cancellation stops proxy fallback and reaches active requests', async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input, options) => {
    calls++;
    assert.strictEqual(options?.signal, controller.signal);
    return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason), { once: true }));
  });
  const request = fetchWithCorsProxy('https://gis.bnpb.go.id/server/rest/services/inarisk/layer_bahaya_cuaca_ekstrim/ImageServer/getSamples?f=json', { signal: controller.signal });
  controller.abort(new Error('Synthetic cancellation'));
  await assert.rejects(request, /Synthetic cancellation/);
  assert.equal(calls, 1);
});


test('volcano reference appears only without official values for both volcanic categories', async () => {
  const { shouldShowVolcanoReference } = await import('../src/utils/volcanoReference.ts');
  const status = { status: 'error', checkedAt: null, error: 'timeout', officeCount: 48, valueCount: 0, failedOfficeCount: 48 } as const;
  for (const hazard of ['volcanic', 'volcanic_ash']) {
    for (const state of ['idle', 'loading', 'no_data', 'error'] as const) {
      assert.equal(shouldShowVolcanoReference(hazard, { ...status, status: state }), true);
    }
    assert.equal(shouldShowVolcanoReference(hazard, { ...status, status: 'partial', valueCount: 1 }), false);
    assert.equal(shouldShowVolcanoReference(hazard, { ...status, status: 'available', valueCount: 48 }), false);
  }
  assert.equal(shouldShowVolcanoReference('extreme_weather', status), false);
  assert.equal(shouldShowVolcanoReference('volcanic', null), false);
});

test('MAGMA reference coordinates provide nearest distances without invented indices or activity levels', async () => {
  const { VOLCANO_REFERENCE_POINTS, VOLCANO_REFERENCE_SOURCE } = await import('../src/constants/volcanoReferencePoints.ts');
  const { getNearestReferenceVolcano } = await import('../src/utils/volcanoReference.ts');
  assert.equal(VOLCANO_REFERENCE_POINTS.length, 69);
  assert.equal(new Set(VOLCANO_REFERENCE_POINTS.map(v => v.id)).size, 69);
  assert.equal(VOLCANO_REFERENCE_SOURCE, 'https://magma.esdm.go.id/v1');
  for (const volcano of VOLCANO_REFERENCE_POINTS) {
    assert.ok(Number.isFinite(volcano.latitude) && Math.abs(volcano.latitude) <= 90);
    assert.ok(Number.isFinite(volcano.longitude) && Math.abs(volcano.longitude) <= 180);
    assert.ok(!('hazardIndex' in volcano) && !('level' in volcano));
  }
  const merapi = VOLCANO_REFERENCE_POINTS.find(v => v.name === 'Merapi')!;
  const exact = getNearestReferenceVolcano(merapi.latitude, merapi.longitude);
  assert.equal(exact.volcano.id, merapi.id);
  assert.equal(exact.distanceKm, 0);
  const jogja = KPWBI_OFFICES.find(o => o.provinceId === 'ID-YO')!;
  const nearest = getNearestReferenceVolcano(jogja.latitude, jogja.longitude);
  assert.equal(nearest.volcano.name, 'Merapi');
  assert.ok(nearest.distanceKm > 20 && nearest.distanceKm < 40);
});


test('header summary counts high raw indices before rounding across hazard tabs', () => {
  const items = [0, 0.3, 0.6, 0.600001, 0.8, null].map(score => ({ score, ispuAssessment: null }));
  for (const hazard of ['earthquake', 'extreme_weather', 'karhutla', 'volcanic', 'volcanic_ash'] as const) {
    assert.deepEqual(getKerentananHighSummary(items, hazard), { highCount: 2, availableCount: 5, status: 'available' });
  }
});

test('header summary includes every BI location category, including headquarters and data center', () => {
  const items = KPWBI_OFFICES.map(office => ({ office, score: 0.8, ispuAssessment: null }));
  assert.ok(items.some(item => item.office.category === 'kantor_pusat'));
  assert.ok(items.some(item => item.office.category === 'dc'));
  assert.equal(getKerentananHighSummary(items, 'volcanic').highCount, KPWBI_OFFICES.length);
});

test('ISPU header counts Berbahaya using station values, independently of distance-adjusted indices', () => {
  const items = [0, 100, 200, 299, 300, 301].map(ispuValue => ({ score: 0.2, ispuAssessment: { ispuValue } }));
  items.push({ score: 0.9, ispuAssessment: { ispuValue: 299 } });
  assert.deepEqual(getKerentananHighSummary(items, 'air_quality'), { highCount: 2, availableCount: 7, status: 'available' });
  assert.equal(getKerentananHighSummary([{ score: 0.9, ispuAssessment: null }], 'air_quality').availableCount, 0);
});

test('header distinguishes missing/loading data from valid zero high counts and retains data during refresh', () => {
  const missing = [null, NaN, Infinity].map(score => ({ score, ispuAssessment: null }));
  assert.deepEqual(getKerentananHighSummary(missing, 'earthquake', true), { highCount: 0, availableCount: 0, status: 'loading' });
  assert.deepEqual(getKerentananHighSummary(missing, 'earthquake'), { highCount: 0, availableCount: 0, status: 'no_data' });
  assert.equal(getKerentananHighSummary([], 'air_quality', true).status, 'loading');
  assert.deepEqual(getKerentananHighSummary([{ score: 0, ispuAssessment: null }], 'earthquake', true), { highCount: 0, availableCount: 1, status: 'available' });
});

test('header chip uses the worst Tinggi, Sedang, or Rendah band', () => {
  const items = [0.2, 0.4, 0.4, 0.8].map(score => ({ score, ispuAssessment: null }));
  assert.deepEqual(getKerentananHeaderBand(items, 'earthquake'), { level: 'Tinggi', count: 1, status: 'available' });
  items[3].score = 0.5;
  assert.deepEqual(getKerentananHeaderBand(items, 'karhutla'), { level: 'Sedang', count: 3, status: 'available' });
  assert.deepEqual(getKerentananHeaderBand(items.map(() => ({ score: 0.1, ispuAssessment: null })), 'volcanic'), { level: 'Rendah', count: 4, status: 'available' });
  assert.deepEqual(getKerentananHeaderBand([{ score: null, ispuAssessment: null }], 'earthquake', true), { level: null, count: 0, status: 'loading' });
  assert.deepEqual(getKerentananHeaderBand([], 'earthquake'), { level: null, count: 0, status: 'no_data' });

  const ispu = [0, 50, 51, 101, 200, 201, 300].map(ispuValue => ({ score: 0.1, ispuAssessment: { ispuValue } }));
  assert.deepEqual(getKerentananHeaderBand(ispu, 'air_quality'), { level: 'Tinggi', count: 2, status: 'available' });
  assert.deepEqual(getKerentananHeaderBand(ispu.slice(0, 5), 'air_quality'), { level: 'Sedang', count: 3, status: 'available' });
  assert.deepEqual(getKerentananHeaderBand(ispu.slice(0, 2), 'air_quality'), { level: 'Rendah', count: 2, status: 'available' });
});

test('header summary recomputes for updated assessments and a changed active tab', () => {
  const items = [{ score: 0.8, ispuAssessment: { ispuValue: 100 } }];
  assert.equal(getKerentananHighSummary(items, 'earthquake').highCount, 1);
  assert.equal(getKerentananHighSummary(items, 'air_quality').highCount, 0);
  items[0].score = 0.6;
  items[0].ispuAssessment.ispuValue = 300;
  assert.equal(getKerentananHighSummary(items, 'earthquake').highCount, 0);
  assert.equal(getKerentananHighSummary(items, 'air_quality').highCount, 1);
});
