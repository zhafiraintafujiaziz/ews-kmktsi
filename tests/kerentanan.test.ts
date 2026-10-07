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
const { INARISK_HAZARD_SERVICES, INARISK_CATEGORIES, getHazardLevel, getHazardSeverity } = await import('../src/constants/kerentananCategories.ts');
const { scoreAlertForOffice, mapInariskToHazard, isInaRiskSupportedType } = await import('../src/utils/riskCalculator.ts');
const { fetchWithCorsProxy } = await import('../src/services/proxy.ts');
const { KPWBI_OFFICES } = await import('../src/constants/kpwbiOffices.ts');
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
  if (target.pathname.endsWith('/identify')) {
    return Response.json({ results: [{ layerId: 0, attributes: { 'Stretch.Pixel Value': value } }] });
  }
  return Response.json({ samples: offices.map((o, locationId) => ({
    locationId, value, location: { x: o.longitude, y: o.latitude, spatialReference: { wkid: 4326 } },
  })) });
}

test('six tabs use four portal Bahaya services; ash shares eruption data', () => {
  assert.deepEqual(INARISK_CATEGORIES.map(c => c.key), [...sources, 'volcanic_ash', 'air_quality']);
  assert.deepEqual(INARISK_HAZARD_SERVICES, {
    earthquake: 'layer_bahaya_gempabumi/MapServer',
    extreme_weather: 'layer_bahaya_banjir/ImageServer',
    karhutla: 'layer_bahaya_kebakaran_hutan_dan_lahan/ImageServer',
    volcanic: 'layer_bahaya_letusan_gunungapi/ImageServer',
  });
  assert.equal(INARISK_CATEGORIES.find(c => c.key === 'extreme_weather')?.inariskLabel, 'Banjir');
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

test('earthquake uses the Kerentanan page InaRISK factor with severity-only elevation', t => {
  const lookup = t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => 0);
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

test('MapServer identify and reordered multipoint samples map each value to its office', async t => {
  const urls: URL[] = [];
  const offices = [office, secondOffice, missingOffice];
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    urls.push(target);
    const geometry = JSON.parse(target.searchParams.get('geometry')!);
    assert.equal(geometry.spatialReference.wkid, 4326);
    if (target.pathname.endsWith('/identify')) {
      assert.equal(target.searchParams.get('geometryType'), 'esriGeometryPoint');
      assert.equal(target.searchParams.get('sr'), '4326');
      assert.equal(target.searchParams.get('layers'), 'all:0');
      assert.equal(target.searchParams.get('tolerance'), '0');
      assert.equal(target.searchParams.get('imageDisplay'), '256,256,96');
      assert.deepEqual(target.searchParams.get('mapExtent')!.split(',').map(Number), [geometry.x - 0.01, geometry.y - 0.01, geometry.x + 0.01, geometry.y + 0.01]);
      const value = geometry.x === office.longitude ? '0' : geometry.x === secondOffice.longitude ? '0.61' : 'NoData';
      return Response.json({ results: [
        { layerId: 9, attributes: { 'Stretch.Pixel Value': '1' } },
        { layerId: 0, attributes: { 'Stretch.Pixel Value': value } },
      ] });
    }
    if (target.pathname.includes(INARISK_HAZARD_SERVICES.extreme_weather)) {
      assert.deepEqual(JSON.parse(target.searchParams.get('renderingRule')!), { rasterFunction: 'None' });
      assert.equal(target.searchParams.get('interpolation'), 'RSP_NearestNeighbor');
    }
    assert.equal(target.searchParams.get('geometryType'), 'esriGeometryMultipoint');
    assert.deepEqual(geometry.points, offices.map(o => [o.longitude, o.latitude]));
    return Response.json({ samples: [
      { value: '0.61', locationId: 1 }, { value: '0', locationId: 0 },
      ...[null, '', 'NoData', true, 3].map(value => ({ value, locationId: 2 })),
      { value: 0.8, location: { x: 0, y: 0 } }, { value: 0.9 }, null,
    ] });
  });
  await BnpbInariskService.refreshAssessment(offices);
  assert.equal(urls.length, offices.length + 3);
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
    if (failWeather && target.pathname.includes(INARISK_HAZARD_SERVICES.extreme_weather)) return Response.json({ error: { code: 503, message: 'Synthetic category failure' } });
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
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    return Response.json(malformed ? {} : target.pathname.endsWith('/identify') ? { results: [] } : { samples: [] });
  });
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

test('one failed earthquake point preserves successful points and distinguishes NoData', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    if (target.pathname.endsWith('/identify')) {
      const point = JSON.parse(target.searchParams.get('geometry')!);
      if (point.x === secondOffice.longitude) return Response.json({ error: { message: 'Point unavailable' } });
      return fixture(target, [office], point.x === missingOffice.longitude ? '' : 0.4);
    }
    return fixture(target, [office, secondOffice, missingOffice]);
  });
  await BnpbInariskService.refreshAssessment([office, secondOffice, missingOffice]);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake'), 0.4);
  const status = BnpbInariskService.getAssessmentStatus('earthquake');
  assert.equal(status.status, 'partial');
  assert.equal(status.valueCount, 1);
  assert.equal(status.failedOfficeCount, 1);
  assert.match(BnpbInariskService.getAssessmentMessage('earthquake', secondOffice.id), /gagal merespons/);
  assert.match(BnpbInariskService.getAssessmentMessage('earthquake', missingOffice.id), /tidak menyediakan nilai/);
  assert.equal(BnpbInariskService.getLocalHazardIndex(office.id, 'extreme_weather'), 0.8);
});

test('earthquake requests never exceed four concurrent identifies', async t => {
  const offices = Array.from({ length: 9 }, (_, i) => ({ ...office, id: 'concurrency-' + i, longitude: office.longitude + i * 0.01 }));
  let active = 0;
  let maxActive = 0;
  let identifies = 0;
  t.mock.method(globalThis, 'fetch', async input => {
    const target = targetOf(input);
    if (target.pathname.endsWith('/identify')) {
      identifies++;
      maxActive = Math.max(maxActive, ++active);
      await nextTurn();
      active--;
    }
    return fixture(target, offices);
  });
  await BnpbInariskService.refreshAssessment(offices);
  assert.equal(maxActive, 4);
  assert.equal(identifies, offices.length);
  assert.equal(BnpbInariskService.getAssessmentStatus('earthquake').valueCount, offices.length);
});

test('the 14-second category deadline aborts pending identifies and retains completed values', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const offices = Array.from({ length: 8 }, (_, i) => ({ ...office, id: 'deadline-' + i, longitude: office.longitude + i * 0.01 }));
  const pendingSignals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const target = targetOf(input);
    if (target.pathname.endsWith('/identify') && JSON.parse(target.searchParams.get('geometry')!).x !== offices[0].longitude) {
      pendingSignals.push(options!.signal!);
      return new Promise<Response>(() => {});
    }
    return fixture(target, offices);
  });
  const refresh = BnpbInariskService.refreshAssessment(offices);
  await nextTurn();
  assert(pendingSignals.length > 0);
  t.mock.timers.tick(14_000);
  await refresh;
  assert(pendingSignals.every(s => s.aborted));
  const status = BnpbInariskService.getAssessmentStatus('earthquake');
  assert.equal(status.status, 'partial');
  assert.equal(status.valueCount, 1);
  assert.equal(status.failedOfficeCount, offices.length - 1);
  assert.equal(BnpbInariskService.getLocalHazardIndex(offices[0].id, 'earthquake'), 0.8);
  assert.equal(BnpbInariskService.getAssessmentStatus('extreme_weather').status, 'available');
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
