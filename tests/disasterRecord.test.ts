import assert from 'node:assert/strict';
import test from 'node:test';
import { DisasterRecordSchema, normalizeAdapterAlert, toLegacyDisasterAlert } from '../src/domain/disasterRecord.ts';

test('adapter output is normalized with provenance and retained raw record', () => {
  const input = {
    id: 'synthetic-earthquake-1',
    type: 'earthquake' as const,
    severity: 2 as const,
    provinceId: 'ID-JB',
    title: 'Synthetic earthquake',
    description: 'Synthetic fixture',
    timestamp: '2026-10-04T02:00:00.000Z',
    latitude: -6.8,
    longitude: 107.1,
    magnitude: 4.1,
  };
  const record = normalizeAdapterAlert(input, 'test-feed', '2026-10-04T02:05:00.000Z');

  assert.equal(DisasterRecordSchema.parse(record).hazard, 'earthquake');
  assert.equal(record.provenance.feed, 'test-feed');
  assert.deepEqual(record.provenance.rawRecord, input);
  assert.deepEqual(toLegacyDisasterAlert(record), input);
});

test('canonical records reject missing provenance', () => {
  const record = normalizeAdapterAlert({
    id: 'synthetic-alert-2', type: 'flood', severity: 1, provinceId: 'ID-JB',
    title: 'Synthetic flood', description: 'Synthetic fixture', timestamp: '2026-10-04T02:00:00.000Z',
  }, 'test-feed', '2026-10-04T02:05:00.000Z');

  assert.throws(() => DisasterRecordSchema.parse({ ...record, provenance: undefined }));
});
