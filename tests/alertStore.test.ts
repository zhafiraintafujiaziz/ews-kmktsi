import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createAlertStore, type AlertFeed } from '../src/domain/alertStore.ts';
import { normalizeAdapterAlert } from '../src/domain/disasterRecord.ts';
import type { DisasterAlert } from '../src/types/index.ts';
import type { AlertSnapshot } from '../src/domain/persistence.ts';

const NOW = Date.UTC(2026, 9, 8, 3);
function alert(overrides: Partial<DisasterAlert> = {}): DisasterAlert {
  return { id: 'fixture', type: 'earthquake', severity: 2, provinceId: 'ID-JK',
    title: 'Synthetic earthquake', description: 'Test fixture', timestamp: new Date(NOW).toISOString(), ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function feed(id: string, fetch: AlertFeed['fetch']): AlertFeed { return { id, name: id, fetch }; }
function cached(id: string, value = alert()): AlertSnapshot {
  return { feed: id, checkedAt: new Date(NOW - 1000).toISOString(), records: [normalizeAdapterAlert(value, id, new Date(NOW).toISOString())] };
}
type Options = Parameters<typeof createAlertStore>[0];
function fixture(t: TestContext, options: Partial<Options> & Pick<Options, 'feeds'>) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  const store = createAlertStore({ loadSnapshots: async () => [], warn: () => {}, ...options });
  const unsubscribe = store.subscribe(() => {});
  t.after(unsubscribe);
  return store;
}
const flush = () => setImmediate();

test('first usable live feed appears before a slow assessment finishes', async t => {
  const fast = deferred<DisasterAlert[]>(), slow = deferred<DisasterAlert[]>();
  const store = fixture(t, { feeds: [feed('fast', () => fast.promise), feed('assessment', () => slow.promise)] });
  await flush();
  assert.equal(store.getSnapshot().isLoading, true);
  t.mock.timers.tick(1000);
  fast.resolve([alert()]);
  await flush();
  const partial = store.getSnapshot();
  assert.equal(partial.alerts.length, 1);
  assert.equal(partial.isLoading, false);
  assert.equal(partial.isFetching, true);
  assert.deepEqual(partial.loadingSources, ['assessment']);
  assert.equal(partial.lastCheckedTime, null);
  t.mock.timers.tick(13_000);
  slow.resolve([]);
  await store.refresh();
  await flush();
  assert.equal(store.getSnapshot().isFetching, false);
  assert.deepEqual(store.getSnapshot().loadingSources, []);
  assert.equal(store.getSnapshot().lastCheckedTime?.getTime(), NOW + 14_000);
});

test('an empty fast feed does not dismiss initial loading before remaining feeds settle', async t => {
  const slow = deferred<DisasterAlert[]>();
  const store = fixture(t, { feeds: [feed('empty', async () => []), feed('slow', () => slow.promise)] });
  await flush();
  assert.equal(store.getSnapshot().isLoading, true);
  assert.deepEqual(store.getSnapshot().loadingSources, ['slow']);
  slow.resolve([]);
  await store.refresh();
  await flush();
  assert.equal(store.getSnapshot().isLoading, false);
  assert.equal(store.getSnapshot().alerts.length, 0);
});

test('timeout and failure settle loading without hiding fast feed results', async t => {
  const errors: string[] = [];
  const store = fixture(t, { feeds: [feed('fast', async () => [alert()]), feed('failed', async () => { throw new Error('offline'); }), feed('timeout', () => new Promise(() => {}))],
    onFeedError: source => { errors.push(source.id); } });
  await flush();
  assert.equal(store.getSnapshot().alerts.length, 1);
  t.mock.timers.tick(15_000);
  await store.refresh();
  await flush();
  assert.equal(store.getSnapshot().isFetching, false);
  assert.equal(store.getSnapshot().feedHealth.timeout.status, 'unavailable');
  assert.equal(store.getSnapshot().feedHealth.failed.status, 'unavailable');
  assert.deepEqual(errors, ['failed', 'timeout']);
});

test('all failed feeds and an unavailable cache reach a final empty state', async t => {
  const store = fixture(t, { feeds: [feed('failed', async () => { throw new Error('offline'); })], loadSnapshots: async () => { throw new Error('cache offline'); } });
  await store.refresh();
  await flush();
  assert.equal(store.getSnapshot().isLoading, false);
  assert.equal(store.getSnapshot().isFetching, false);
  assert.deepEqual(store.getSnapshot().alerts, []);
  assert.equal(store.getSnapshot().feedHealth.failed.status, 'unavailable');
});

test('valid cache appears immediately and live data removes its cached designation', async t => {
  const live = deferred<DisasterAlert[]>();
  const store = fixture(t, { feeds: [feed('live', () => live.promise)], loadSnapshots: async () => [cached('live')] });
  await flush();
  const restored = store.getSnapshot();
  assert.equal(restored.isLoading, false);
  assert.equal(restored.cachedAlertIds.has('fixture'), true);
  assert.equal(restored.cachedSnapshotTime?.getTime(), NOW - 1000);
  live.resolve([alert()]);
  await store.refresh();
  await flush();
  assert.strictEqual(store.getSnapshot().alerts, restored.alerts);
  assert.equal(store.getSnapshot().cachedAlertIds.size, 0);
  assert.equal(store.getSnapshot().cachedSnapshotTime, null);
});

test('late cache never overwrites successful live data or an empty live result', async t => {
  const cache = deferred<AlertSnapshot[]>();
  const store = fixture(t, { feeds: [feed('live', async () => [alert({ title: 'Live title' })]), feed('empty', async () => [])], loadSnapshots: () => cache.promise });
  await store.refresh();
  await flush();
  cache.resolve([cached('live'), cached('empty', alert({ id: 'removed' }))]);
  await flush();
  assert.deepEqual(store.getSnapshot().alerts.map(value => value.title), ['Live title']);
  assert.equal(store.getSnapshot().cachedAlertIds.size, 0);
});

test('expired, malformed, and unknown cache records cannot end initial loading', async t => {
  const live = deferred<DisasterAlert[]>();
  const malformed = cached('live');
  malformed.records[0].details.legacyAlert = { invalid: true };
  const store = fixture(t, { feeds: [feed('live', () => live.promise)], loadSnapshots: async () => [cached('live', alert({ timestamp: new Date(NOW - 86400001).toISOString() })), malformed, cached('unknown')] });
  await flush();
  assert.deepEqual(store.getSnapshot().alerts, []);
  assert.equal(store.getSnapshot().isLoading, true);
  live.resolve([]);
  await store.refresh();
});

test('feed completion order does not change final order or duplicate-ID precedence', async t => {
  const first = deferred<DisasterAlert[]>();
  const store = fixture(t, { feeds: [feed('first', () => first.promise), feed('second', async () => [alert({ id: 'second' }), alert({ title: 'Second wins' })])] });
  await flush();
  first.resolve([alert({ id: 'first' }), alert({ title: 'First loses' })]);
  await store.refresh();
  await flush();
  assert.deepEqual(store.getSnapshot().alerts.map(value => [value.id, value.title]), [['first', 'Synthetic earthquake'], ['fixture', 'Second wins'], ['second', 'Synthetic earthquake']]);
});

test('equivalent full payloads retain alert, array, Set and Date references', async t => {
  const original = alert({ sourceGeometry: { type: 'Polygon', coordinates: [[[100, 0], [101, 0], [100, 0]]] },
    closedAirports: [{ icao: 'TEST', name: 'Airport', reason: 'ash', detail: 'fixture' }], affectedSeaports: [{ name: 'Port', regency: 'Jakarta', status: 'open', note: 'fixture', lat: 0, lon: 100 }] });
  let values = [original];
  const store = fixture(t, { feeds: [feed('live', async () => structuredClone(values))] });
  await store.refresh();
  await flush();
  const before = store.getSnapshot();
  values = [{ ...original, sourceGeometry: { coordinates: [[[100, 0], [101, 0], [100, 0]]], type: 'Polygon' } }];
  await store.refresh();
  await flush();
  const after = store.getSnapshot();
  assert.strictEqual(after.alerts, before.alerts);
  assert.strictEqual(after.alerts[0], before.alerts[0]);
  assert.strictEqual(after.cachedAlertIds, before.cachedAlertIds);
  assert.strictEqual(after.lastCheckedTime, before.lastCheckedTime);
});

test('geometry, airport and seaport edits, ordering, additions, deletions and expiry update snapshots', async t => {
  let values = [alert({ sourceGeometry: { coordinates: [[100, 0]] }, closedAirports: [{ icao: 'TEST', name: 'Airport', reason: 'ash', detail: 'before' }],
    affectedSeaports: [{ name: 'Port', regency: 'Jakarta', status: 'open', note: 'before', lat: 0, lon: 100 }] }), alert({ id: 'other' })];
  const store = fixture(t, { feeds: [feed('live', async () => structuredClone(values))] });
  await store.refresh();
  await flush();
  let previous = store.getSnapshot().alerts;
  for (const modify of [
    () => { values[0].sourceGeometry = { coordinates: [[101, 0]] }; },
    () => { values[0].closedAirports![0].detail = 'after'; },
    () => { values[0].affectedSeaports![0].note = 'after'; },
    () => { values.reverse(); },
    () => { values.push(alert({ id: 'added' })); },
    () => { values.pop(); },
    () => { values = values.map(value => ({ ...value, timestamp: new Date(NOW - 86400001).toISOString() })); },
  ]) {
    modify();
    await store.refresh();
    await flush();
    assert.notStrictEqual(store.getSnapshot().alerts, previous);
    previous = store.getSnapshot().alerts;
  }
  assert.deepEqual(previous, []);
});

test('metadata-only progress preserves alert references and same-turn results publish together', async t => {
  const a = deferred<DisasterAlert[]>(), b = deferred<DisasterAlert[]>();
  const store = fixture(t, { feeds: [feed('a', () => a.promise), feed('b', () => b.promise)], loadSnapshots: async () => [cached('a')] });
  await flush();
  const before = store.getSnapshot();
  let alertChanges = 0;
  let previous = before.alerts;
  const unsubscribe = store.subscribe(() => { const alerts = store.getSnapshot().alerts; if (previous !== alerts) alertChanges++; previous = alerts; });
  t.after(unsubscribe);
  a.resolve([alert()]);
  b.resolve([]);
  await store.refresh();
  await flush();
  assert.strictEqual(store.getSnapshot().alerts, before.alerts);
  assert.equal(alertChanges, 0);
  assert.deepEqual(store.getSnapshot().loadingSources, []);
});

test('different feeds completing in the same turn publish one combined alert change', async t => {
  const a = deferred<DisasterAlert[]>(), b = deferred<DisasterAlert[]>();
  const store = fixture(t, { feeds: [feed('a', () => a.promise), feed('b', () => b.promise)] });
  await flush();
  const changes: string[][] = [];
  let previous = store.getSnapshot().alerts;
  const unsubscribe = store.subscribe(() => {
    const alerts = store.getSnapshot().alerts;
    if (alerts !== previous) changes.push(alerts.map(value => value.id));
    previous = alerts;
  });
  t.after(unsubscribe);
  a.resolve([alert({ id: 'a' })]);
  b.resolve([alert({ id: 'b' })]);
  await store.refresh();
  await flush();
  assert.deepEqual(changes, [['a', 'b']]);
});

test('a failed refresh retains only alerts that are still usable', async t => {
  let failing = false;
  const store = fixture(t, { feeds: [feed('live', async () => {
    if (failing) throw new Error('offline');
    return [alert({ timestamp: new Date(NOW - 86400000 + 1000).toISOString() })];
  })] });
  await store.refresh();
  await flush();
  const previous = store.getSnapshot().alerts;
  failing = true;
  await store.refresh();
  await flush();
  assert.strictEqual(store.getSnapshot().alerts, previous);
  t.mock.timers.tick(1001);
  await store.refresh();
  await flush();
  assert.deepEqual(store.getSnapshot().alerts, []);
});

test('pending cache and persistence are cancelled when the last subscriber leaves', async t => {
  const signals: AbortSignal[] = [];
  const store = fixture(t, { feeds: [feed('live', async () => [alert()])], loadSnapshots: signal => { signals.push(signal); return new Promise(() => {}); },
    persist: (_snapshot, _history, signal) => { signals.push(signal); return new Promise(() => {}); } });
  await store.refresh();
  await flush();
  // fixture owns one subscription; collect and remove it through its cleanup.
  assert.equal(signals.length, 2);
  t.after(() => assert.ok(signals.every(signal => signal.aborted)));
});

test('StrictMode replay and screen subscribers share one cycle and one interval', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  const live = deferred<DisasterAlert[]>();
  let requests = 0;
  const store = createAlertStore({ feeds: [feed('live', () => { requests++; return requests === 1 ? live.promise : Promise.resolve([alert()]); })], loadSnapshots: async () => [], warn: () => {} });
  const first = store.subscribe(() => {});
  first();
  const second = store.subscribe(() => {}), third = store.subscribe(() => {});
  await flush();
  assert.equal(requests, 1);
  live.resolve([alert()]);
  await store.refresh();
  await flush();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(requests, 2);
  second();
  third();
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(requests, 2);
});

test('persistence and regional assessment never block usable data or cycle completion', async t => {
  let writtenAfterPublication = false;
  const store = fixture(t, { feeds: [feed('live', async () => [alert()])], refreshAssessments: () => new Promise(() => {}),
    persist: () => { writtenAfterPublication = store.getSnapshot().alerts.length === 1; return new Promise(() => {}); } });
  await store.refresh();
  await flush();
  assert.equal(writtenAfterPublication, true);
  assert.equal(store.getSnapshot().isFetching, false);
  assert.equal(store.getSnapshot().alerts.length, 1);
});

test('one shared scheduler refreshes alerts and background assessments immediately and every minute', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  let feeds = 0, assessments = 0;
  const store = createAlertStore({
    feeds: [feed('live', async () => { feeds++; return [alert()]; })], loadSnapshots: async () => [],
    refreshAssessments: async () => { assessments++; },
  });
  const first = store.subscribe(() => {}), second = store.subscribe(() => {});
  t.after(first); t.after(second);
  await flush();
  assert.deepEqual([feeds, assessments], [1, 1]);
  t.mock.timers.tick(59_999);
  await flush();
  assert.deepEqual([feeds, assessments], [1, 1]);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual([feeds, assessments], [2, 2]);
  first();
  t.mock.timers.tick(60_000);
  await flush();
  assert.deepEqual([feeds, assessments], [3, 3]);
  second();
  t.mock.timers.tick(60_000);
  await flush();
  assert.deepEqual([feeds, assessments], [3, 3]);
});

test('a background assessment rejection stays out of feed health and later cycles recover', async t => {
  const failure = new Error('InaRISK timed out after 14000 ms');
  const warnings: unknown[] = [];
  let attempts = 0;
  const store = fixture(t, { feeds: [feed('live', async () => [alert()])],
    refreshAssessments: async () => { if (++attempts === 1) throw failure; },
    warn: (message, error) => { warnings.push([message, error]); },
  });
  await flush();
  assert.deepEqual(warnings, [['Assessment bahaya gagal:', failure]]);
  assert.deepEqual(Object.keys(store.getSnapshot().feedHealth), ['live']);
  assert.equal(store.getSnapshot().isLoading, false);
  assert.equal(store.getSnapshot().isFetching, false);
  assert.deepEqual(store.getSnapshot().loadingSources, []);
  t.mock.timers.tick(60_000);
  await flush();
  assert.equal(attempts, 2);
  assert.equal(warnings.length, 1);
  assert.equal(store.getSnapshot().alerts.length, 1);
});
test('five-minute feed policy avoids early refreshes and pauses requests while hidden', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: NOW });
  let calls = 0, active = true;
  const store = createAlertStore({ feeds: [{ id: 'earthquakes', name: 'Gempa', intervalMs: 300_000, fetch: async () => { calls++; return [alert()]; } }],
    pollIntervalMs: 30_000, canRefresh: () => active, loadSnapshots: async () => [] });
  const leave = store.subscribe(() => {});
  await setImmediate(); assert.equal(calls, 1);
  t.mock.timers.tick(299_999); await setImmediate(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await setImmediate(); assert.equal(calls, 2);
  active = false; t.mock.timers.tick(300_000); await setImmediate(); assert.equal(calls, 2);
  active = true; await store.refresh(); assert.equal(calls, 3);
  leave();
});
