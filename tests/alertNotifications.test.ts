import assert from 'node:assert/strict';
import test from 'node:test';
import {
  alertFingerprint,
  createAlertNotificationStore,
  KNOWN_ALERTS_STORAGE_KEY,
  latestUnknownAlert,
} from '../src/domain/alertNotifications.ts';
import type { DisasterAlert } from '../src/types/index.ts';

function alert(overrides: Partial<DisasterAlert> = {}): DisasterAlert {
  return {
    id: 'bmkg-earthquake-1', type: 'earthquake', severity: 3, provinceId: 'ID-JK',
    title: 'Test earthquake', description: 'Synthetic source report',
    timestamp: '2026-10-06T02:00:00Z', ...overrides,
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test('identical reports and equivalent source timestamps share a fingerprint', () => {
  const original = alert({ validFrom: '2026-10-06T02:00:00Z', validUntil: '2026-10-06T05:00:00Z' });
  const refreshed = { ...original, timestamp: '2026-10-06T09:00:00+07:00',
    validFrom: '2026-10-06T02:00:00.000Z', validUntil: '2026-10-06T12:00:00+07:00',
    title: 'Reformatted title', description: 'Reformatted description' };
  assert.equal(alertFingerprint(original), alertFingerprint(refreshed));
});

test('new source reports, events, hazards, validity periods and severities remain eligible', () => {
  const original = alert();
  const store = createAlertNotificationStore(() => null);
  store.markKnown(original);
  for (const update of [
    { id: 'bmkg-earthquake-2' }, { timestamp: '2026-10-06T03:00:00Z' },
    { type: 'volcanic' as const }, { severity: 2 as const },
    { validFrom: '2026-10-06T02:00:00Z' }, { validUntil: '2026-10-06T05:00:00Z' },
  ]) assert.equal(store.isKnown(alert(update)), false);
});

test('SIPONGI ignores moving request windows and sorting indices, but tracks hotspot updates', () => {
  const original = alert({ id: 'sipongi-karhutla-riau-kampar-0', type: 'karhutla',
    provinceId: 'ID-RI', affectedArea: 'KAMPAR', hotspotCount: 120,
    validFrom: '2026-10-05T02:00:00Z', validUntil: '2026-10-06T02:00:00Z' });
  const refreshed = { ...original, id: 'sipongi-karhutla-riau-kampar-3', affectedArea: ' kampar ',
    timestamp: '2026-10-05T02:01:00Z', validFrom: '2026-10-05T02:01:00Z', validUntil: '2026-10-06T02:01:00Z' };
  assert.equal(alertFingerprint(original), alertFingerprint(refreshed));
  for (const update of [{ hotspotCount: 121 }, { severity: 2 as const },
    { affectedArea: 'SIAK' }, { provinceId: 'ID-JK' }]) {
    assert.notEqual(alertFingerprint(original), alertFingerprint({ ...refreshed, ...update }));
  }
  // Other karhutla integrations keep their genuine source IDs and timestamps.
  assert.notEqual(alertFingerprint({ ...original, id: 'other-source' }),
    alertFingerprint({ ...original, id: 'other-source', timestamp: '2026-10-06T03:00:00Z' }));
});

test('dismissals survive navigation, refresh and reopening, and notify both popup consumers', () => {
  const storage = memoryStorage();
  const store = createAlertNotificationStore(() => storage);
  const updates: number[] = [];
  const unsubscribe = store.subscribe(() => updates.push(store.getSnapshot()));
  store.markKnown(alert());
  assert.equal(store.isKnown({ ...alert() }), true);
  assert.equal(latestUnknownAlert([alert()], store), null);
  assert.equal(store.claimSound(alert()), false);
  assert.equal(createAlertNotificationStore(() => storage).isKnown(alert()), true);
  assert.equal(storage.getItem(KNOWN_ALERTS_STORAGE_KEY), JSON.stringify([alertFingerprint(alert())]));
  store.markKnown({ ...alert() });
  assert.deepEqual(updates, [1]);
  unsubscribe();
  store.markKnown(alert({ id: 'new-event' }));
  assert.deepEqual(updates, [1]);
});

test('the retired global mute does not suppress fresh events', () => {
  const storage = memoryStorage();
  storage.setItem('bima_toast_disabled', 'true');
  const store = createAlertNotificationStore(() => storage);
  assert.equal(store.isKnown(alert()), false);
  assert.equal(latestUnknownAlert([alert()], store)?.id, alert().id);
});

test('invalid persisted JSON and malformed records recover to a working store', () => {
  for (const raw of ['{broken', 'null', '{}', '[42]', '["fingerprint", null]']) {
    const storage = memoryStorage();
    storage.setItem(KNOWN_ALERTS_STORAGE_KEY, raw);
    const store = createAlertNotificationStore(() => storage);
    assert.equal(store.isKnown(alert()), false);
    store.markKnown(alert());
    assert.equal(createAlertNotificationStore(() => storage).isKnown(alert()), true);
  }
});

test('unavailable storage and failed writes keep dismissals in memory', () => {
  for (const getStorage of [
    () => null,
    () => { throw new Error('Storage access denied'); },
    () => ({ getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } }),
    () => ({ getItem: () => { throw new Error('Reads denied'); }, setItem: () => {} }),
  ]) {
    const store = createAlertNotificationStore(getStorage);
    store.markKnown(alert());
    assert.equal(store.isKnown({ ...alert() }), true);
    assert.equal(latestUnknownAlert([alert()], store), null);
  }
});

test('sound is emitted once per fingerprint across popup consumers and effect replay', () => {
  const store = createAlertNotificationStore(() => null);
  assert.equal(store.claimSound(alert()), true);
  assert.equal(store.claimSound({ ...alert() }), false);
  assert.equal(store.claimSound(alert({ severity: 2 })), true);
  assert.equal(store.claimSound(alert({ timestamp: '2026-10-06T03:00:00Z' })), true);
});

test('newest source timestamp takes priority over severity and incoming array order', () => {
  const store = createAlertNotificationStore(() => null);
  const olderHigh = alert({ id: 'older-high', severity: 3 });
  const newer = alert({ id: 'newer', severity: 2, timestamp: '2026-10-06T03:00:00Z' });
  for (const records of [[olderHigh, newer], [newer, olderHigh]]) {
    assert.equal(latestUnknownAlert(records, store)?.id, 'newer');
  }
});

test('closing one popup advances to the newest remaining unknown alert', () => {
  const store = createAlertNotificationStore(() => null);
  const records = [0, 1, 2].map(i => alert({ id: String(i), timestamp: '2026-10-06T0' + (i + 2) + ':00:00Z' }));
  for (const id of ['2', '1', '0']) {
    const current = latestUnknownAlert(records, store);
    assert.equal(current?.id, id);
    store.markKnown(current!);
  }
  assert.equal(latestUnknownAlert(records, store), null);
});

test('a newer incoming alert becomes the single selection without acknowledging pending alerts', () => {
  const store = createAlertNotificationStore(() => null);
  const original = alert();
  const incoming = alert({ id: 'incoming', timestamp: '2026-10-06T04:00:00Z' });
  assert.equal(latestUnknownAlert([original], store)?.id, original.id);
  assert.equal(latestUnknownAlert([original, incoming], store)?.id, incoming.id);
  assert.equal(store.isKnown(original), false);
  store.markKnown(incoming);
  assert.equal(latestUnknownAlert([original, incoming], store)?.id, original.id);
});

test('selection is stable for equal timestamps and ignores invalid timestamps', () => {
  const store = createAlertNotificationStore(() => null);
  const records = [alert({ id: 'b' }), alert({ id: 'a' }), alert({ id: 'invalid', timestamp: '' })];
  assert.equal(latestUnknownAlert(records, store)?.id, 'a');
  assert.equal(latestUnknownAlert([...records].reverse(), store)?.id, 'a');
  assert.equal(latestUnknownAlert([], store), null);
});
