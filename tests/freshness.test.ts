import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentlyUsable } from '../src/domain/freshness.ts';
import type { DisasterAlert } from '../src/types/index.ts';

function record(overrides: Partial<DisasterAlert> = {}): DisasterAlert {
  return {
    id: 'synthetic-current-record',
    type: 'earthquake',
    severity: 2,
    provinceId: 'ID-JK',
    title: 'Synthetic test record',
    description: 'Test-only source record',
    timestamp: new Date(Date.UTC(2026, 9, 4, 2)).toISOString(),
    ...overrides,
  };
}

test('earthquake observations are accepted only within the preceding 24 hours', () => {
  const now = Date.UTC(2026, 9, 4, 3);
  assert.equal(isCurrentlyUsable(record(), now), true);
  assert.equal(isCurrentlyUsable(record({ timestamp: new Date(now - 24 * 60 * 60 * 1000 - 1).toISOString() }), now), false);
  assert.equal(isCurrentlyUsable(record({ timestamp: '' }), now), false);
  assert.equal(isCurrentlyUsable(record({ timestamp: new Date(now + 1).toISOString() }), now), false);
});

test('a warning issued yesterday remains eligible until its source validity ends', () => {
  const now = Date.UTC(2026, 9, 4, 3);
  assert.equal(isCurrentlyUsable(record({
    type: 'extreme_weather',
    timestamp: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
    validFrom: new Date(now - 20 * 60 * 60 * 1000).toISOString(),
    validUntil: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  }), now), true);
  assert.equal(isCurrentlyUsable(record({
    type: 'extreme_weather',
    validFrom: new Date(now - 60 * 60 * 1000).toISOString(),
    validUntil: new Date(now - 1).toISOString(),
  }), now), false);
  assert.equal(isCurrentlyUsable(record({ type: 'extreme_weather' }), now), false);
});

test('forecasts retain today until source expiry and accept future source periods', () => {
  const now = Date.UTC(2026, 9, 4, 3);
  const from = Date.UTC(2026, 9, 3, 17), until = from + 86400000;
  const forecast = record({ type: 'extreme_weather', isForecast: true, timestamp: new Date(from).toISOString(),
    validFrom: new Date(from).toISOString(), validUntil: new Date(until).toISOString(), forecastDateStr: '4 Oct 2026' });
  assert.equal(isCurrentlyUsable(forecast, now), true);
  assert.equal(isCurrentlyUsable(forecast, until - 1), true);
  assert.equal(isCurrentlyUsable(forecast, until), false);
  assert.equal(isCurrentlyUsable({ ...forecast, validFrom: new Date(until).toISOString(), validUntil: new Date(until + 86400000).toISOString() }, now), true);
  assert.equal(isCurrentlyUsable({ ...forecast, validUntil: undefined }, now), false);
  assert.equal(isCurrentlyUsable({ ...forecast, validFrom: new Date(until + 1).toISOString() }, now), false);
});

test('SIPONGI records preserve and enforce their trailing request period', () => {
  const now = Date.UTC(2026, 9, 4, 3);
  assert.equal(isCurrentlyUsable(record({
    type: 'karhutla',
    timestamp: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    validFrom: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    validUntil: new Date(now - 15 * 60 * 1000).toISOString(),
  }), now), true);
  assert.equal(isCurrentlyUsable(record({
    type: 'karhutla',
    timestamp: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    validFrom: '',
    validUntil: '',
  }), now), false);
});

test('MAGMA reports remain usable today and yesterday in the report timezone', () => {
  const now = Date.UTC(2026, 9, 4, 3);
  assert.equal(isCurrentlyUsable(record({ type: 'volcanic', timestamp: new Date(now).toISOString() }), now), true);
  assert.equal(isCurrentlyUsable(record({ type: 'volcanic', timestamp: new Date(now - 24 * 60 * 60 * 1000).toISOString() }), now), true);
  assert.equal(isCurrentlyUsable(record({ type: 'volcanic', timestamp: new Date(now - 48 * 60 * 60 * 1000).toISOString() }), now), false);
});
