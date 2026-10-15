import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { BROWSER_PREFIX, writeStored, type StorageLike } from '../src/services/browserStorage.ts';
import { exportBrowserBackup, importBrowserBackup, loadBrowserReports, loadBrowserChecklist, migrateBrowserData, saveBrowserReport, saveBrowserChecklist } from '../src/services/browserPersistence.ts';
import { mergeBrowserHistory, readBrowserHistory, recordBrowserIspu, queryBrowserHistory } from '../src/services/browserHistory.ts';
import { wibToday, type IspuDailyReading, type IspuHistoryResponse } from '../src/domain/ispuHistory.ts';
import { saveReport, loadReports, saveChecklist, loadChecklist, loadAlertSnapshots, persistAlertHistory } from '../src/services/persistenceService.ts';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>(); limit = Infinity;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) {
    const size = [...this.values].filter(([item]) => item !== key).reduce((sum, [item, text]) => sum + (item.length + text.length) * 2, (key.length + value.length) * 2);
    if (size > this.limit) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
}
const report = { id: 'report-1', createdAt: '2026-10-15T00:00:00.000Z', officeId: 'office', officeName: 'KPw', sumberGangguan: 'Gempa', lokasi: '', penyebab: '', dampak: '', dampakGedung: '', evakuasi: false, responCepat: '' };
function storage(t: TestContext) {
  const memory = new MemoryStorage();
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'localStorage', old); else Reflect.deleteProperty(globalThis, 'localStorage'); });
  return memory;
}
function reading(date = wibToday(), stationId = 'station'): IspuDailyReading {
  return { collectionDate: date, stationId, name: stationId, city: 'Jakarta', province: 'Jakarta', latitude: -6.2, longitude: 106.8, value: 42, category: 'BAIK', dominantPollutant: 'PM2.5',
    sourceTimeText: date + 'T08:00:00+07:00', sourceTimeLabel: '08:00 WIB', sourceTimezone: 'WIB', observedAt: date + 'T01:00:00.000Z', qualityFlags: [] };
}

test('browser mode saves and reloads user data without any API calls', async t => {
  storage(t);
  Object.assign(globalThis, { __EWS_DATA_MODE__: 'browser' });
  t.after(() => Reflect.deleteProperty(globalThis, '__EWS_DATA_MODE__'));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected network request'); });
  await saveReport(report); await saveChecklist({ officeId: 'office', itemId: 'one', checked: true });
  assert.deepEqual(await loadReports(), [report]);
  assert.equal((await loadChecklist())[0].checked, true);
  assert.deepEqual(await loadAlertSnapshots(), []);
  await persistAlertHistory([]);
});

test('migration is repeatable, supports both report timestamps, and preserves existing browser changes', t => {
  const memory = storage(t);
  const { createdAt, ...old } = report;
  memory.setItem('ews-mktbi:laporan-kpw', JSON.stringify([{ ...old, timestamp: createdAt }, { ...report, id: 'current' }]));
  memory.setItem('ews-mktbi:kpw-checklist', JSON.stringify({ office: { one: false, two: true } }));
  saveBrowserChecklist({ officeId: 'office', itemId: 'one', checked: true });
  migrateBrowserData(); migrateBrowserData();
  assert.equal(loadBrowserReports().length, 2);
  assert.equal(loadBrowserChecklist().find(item => item.itemId === 'one')?.checked, true);
  assert.ok(memory.getItem('ews-mktbi:laporan-kpw'));
});

test('cache eviction and quota failures never remove saved user data', t => {
  const memory = storage(t);
  saveBrowserReport(report);
  writeStored(BROWSER_PREFIX + 'cache:large', 'x'.repeat(300_000), true);
  writeStored(BROWSER_PREFIX + 'cache:new', 'y'.repeat(300_000), true);
  assert.deepEqual(loadBrowserReports(), [report]);
  assert.equal(memory.getItem(BROWSER_PREFIX + 'cache:large'), null);
  memory.limit = JSON.stringify(report).length * 2 + 200;
  assert.throws(() => saveBrowserReport({ ...report, id: 'too-large', dampak: 'z'.repeat(5000) }), /penuh/);
  assert.deepEqual(loadBrowserReports(), [report]);
});

test('backup validates before import and merges without overwriting existing identities', t => {
  storage(t); saveBrowserReport(report); saveBrowserChecklist({ officeId: 'office', itemId: 'one', checked: true });
  mergeBrowserHistory([reading()]);
  const backup = exportBrowserBackup();
  importBrowserBackup({ ...backup, reports: [{ ...report, dampak: 'older import' }, { ...report, id: 'new' }] });
  assert.equal(loadBrowserReports().length, 2);
  assert.equal(loadBrowserReports().find(row => row.id === report.id)?.dampak, '');
  assert.equal(readBrowserHistory().length, 1);
  assert.throws(() => importBrowserBackup({ ...backup, reports: [{ ...report, id: 'invalid', createdAt: 'bad' }] }));
  assert.equal(loadBrowserReports().length, 2);
});

test('daily browser archive keeps its first sample and does not backfill from a previous-day cache', async t => {
  storage(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-15T00:05:00.000Z') });
  await recordBrowserIspu([reading('2026-10-14')], '2026-10-14T16:59:00.000Z');
  assert.equal(readBrowserHistory().length, 0);
  await recordBrowserIspu([reading()], new Date().toISOString());
  await recordBrowserIspu([{ ...reading(), value: 150 }], new Date().toISOString());
  assert.equal(readBrowserHistory()[0].value, 42);
  assert.deepEqual(readBrowserHistory()[0], reading());
  const response = queryBrowserHistory({ action: 'series', from: '2026-10-14', to: '2026-10-15', stationId: 'station' }) as IspuHistoryResponse;
  assert.equal(response.series[0].points[0].reading, null);
  assert.equal(response.series[0].points[1].value, 42);
});

test('history keeps at most ninety days and preserves station metadata changes and quality flags', t => {
  storage(t);
  const now = Date.parse('2026-10-15T08:00:00.000Z');
  const rows = Array.from({ length: 100 }, (_, i) => reading(new Date(Date.parse('2026-10-15') - i * 86400_000).toISOString().slice(0, 10)));
  rows[0] = { ...rows[0], name: 'Moved station', latitude: -7, qualityFlags: ['stale'] };
  mergeBrowserHistory(rows, now);
  assert.equal(readBrowserHistory().length, 90);
  assert.deepEqual(readBrowserHistory().find(row => row.collectionDate === '2026-10-15'), rows[0]);
});
