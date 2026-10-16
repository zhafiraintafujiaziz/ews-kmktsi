import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

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

const { EARTHQUAKE_WMS_SERVICE, INARISK_WMS_SERVICE, earthquakeHazardUrl, inaRiskPointHazardUrl,
  parseEarthquakeHazardValue, parseInaRiskPointHazardValue } =
  await import('../src/services/earthquakeHazard.ts');
const { INARISK_CATEGORIES, getInaRiskAssessmentEndpoint } =
  await import('../src/constants/kerentananCategories.ts');

test('earthquake and extreme weather query only their official raw Bahaya layers at the office point', () => {
  assert.equal(EARTHQUAKE_WMS_SERVICE, 'https://inarisk1.bnpb.go.id/geoserver/ows');
  assert.equal(INARISK_WMS_SERVICE, EARTHQUAKE_WMS_SERVICE);
  for (const [source, layer] of [
    ['earthquake', 'raster:INDEKS_BAHAYA_GEMPABUMI1'],
    ['extreme_weather', 'raster:INDEKS_BAHAYA_CUACAEKSTRIM1'],
  ] as const) {
  for (const office of [
    { longitude: 95.3184, latitude: 5.5562 },
    { longitude: 106.8216, latitude: -6.1823 },
    { longitude: 119.8519, latitude: -0.8953 },
  ]) {
    const url = new URL(inaRiskPointHazardUrl(office, source));
    assert.equal(url.origin + url.pathname, EARTHQUAKE_WMS_SERVICE);
    const parameters = url.searchParams;
    assert.equal(parameters.get('service'), 'WMS');
    assert.equal(parameters.get('version'), '1.1.1');
    assert.equal(parameters.get('request'), 'GetFeatureInfo');
    assert.equal(parameters.get('layers'), layer);
    assert.equal(parameters.get('query_layers'), layer);
    assert.equal(parameters.get('srs'), 'EPSG:4326');
    assert.equal(parameters.get('format'), 'image/png');
    assert.equal(parameters.get('info_format'), 'application/json');
    assert.equal(parameters.get('styles'), '');
    for (const parameter of ['width', 'height', 'feature_count']) {
      assert.equal(parameters.get(parameter), '1');
    }
    for (const parameter of ['x', 'y', 'buffer']) assert.equal(parameters.get(parameter), '0');
    const [west, south, east, north] = parameters.get('bbox')!.split(',').map(Number);
    assert.ok(Math.abs((west + east) / 2 - office.longitude) < 1e-12);
    assert.ok(Math.abs((south + north) / 2 - office.latitude) < 1e-12);
    assert.ok(Math.abs(east - west - 0.0001) < 1e-12);
    assert.ok(Math.abs(north - south - 0.0001) < 1e-12);
    assert.doesNotMatch(url.href, /RISIKO|KERENTANAN|KAPASITAS/i);
    if (source === 'earthquake') assert.equal(earthquakeHazardUrl(office), url.href);
  }
  }
});

test('weather describes Cuaca Ekstrim and shares the WMS endpoint with earthquake', () => {
  assert.equal(INARISK_CATEGORIES.find(category => category.key === 'extreme_weather')?.inariskLabel, 'Cuaca Ekstrim');
  for (const source of ['earthquake', 'extreme_weather'] as const) {
    assert.equal(getInaRiskAssessmentEndpoint(source), INARISK_WMS_SERVICE);
  }
});

test('invalid or nonfinite office coordinates cannot produce requests', () => {
  for (const source of ['earthquake', 'extreme_weather'] as const) {
  for (const latitude of [NaN, Infinity, -Infinity, -90.0001, 90.0001]) {
    assert.throws(() => inaRiskPointHazardUrl({ latitude, longitude: 106 }, source), /Invalid.*coordinates/);
  }
  for (const longitude of [NaN, Infinity, -Infinity, -180.0001, 180.0001]) {
    assert.throws(() => inaRiskPointHazardUrl({ longitude, latitude: -6 }, source), /Invalid.*coordinates/);
  }
  }
});

test('raw values preserve exact indices, zero, and explicit NoData', () => {
  for (const parse of [parseInaRiskPointHazardValue, parseEarthquakeHazardValue]) {
  for (const value of [0, 1, 0.5538657903671265, 0.036089926958084106, 0.3815937042236328,
    0.5028058290481567, '0', null, 'NoData', -3.4028230607370965e38, undefined]) {
    assert.equal(parse({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: { GRAY_INDEX: value } }],
    }), value);
  }
  assert.equal(parse({ type: 'FeatureCollection', features: [] }), null);
  }
});

test('malformed feature collections and missing raster values are errors', () => {
  for (const data of [
    {}, { error: 'service unavailable' }, { type: 'FeatureCollection' },
    { type: 'FeatureCollection', features: null },
    { type: 'Feature', features: [] },
    { type: 'FeatureCollection', features: [null] },
    { type: 'FeatureCollection', features: [[]] },
    { type: 'FeatureCollection', features: [{}] },
    { type: 'FeatureCollection', features: [{ properties: null }] },
    { type: 'FeatureCollection', features: [{ properties: [] }] },
    { type: 'FeatureCollection', features: [{ properties: { index: 0.8 } }] },
    { type: 'FeatureCollection', features: [{ properties: Object.create({ GRAY_INDEX: 0.8 }) }] },
  ]) {
    for (const parse of [parseInaRiskPointHazardValue, parseEarthquakeHazardValue]) {
      assert.throws(() => parse(data), /Invalid|Missing/);
    }
  }
});
