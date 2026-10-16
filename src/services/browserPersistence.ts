import { z } from 'zod';
import { ReportSchema, ReportFieldsSchema, ChecklistItemSchema, AlertSnapshotSchema, type Report, type ChecklistItem, type AlertSnapshot } from '../domain/persistence.ts';
import { BROWSER_PREFIX, browserStorage, keys, readStored, writeStored } from './browserStorage.ts';
import { mergeBrowserHistory, readBrowserHistory, ReadingSchema } from './browserHistory.ts';
import { normalizeAdapterAlert, toLegacyDisasterAlert, LegacyDisasterAlertSchema } from '../domain/disasterRecord.ts';
import type { DisasterAlert } from '../types/index.ts';

const reportKey = (id: string) => BROWSER_PREFIX + 'report:' + encodeURIComponent(id);
const checklistKey = (item: Pick<ChecklistItem, 'officeId' | 'itemId'>) => BROWSER_PREFIX + 'checklist:' + encodeURIComponent(item.officeId) + ':' + encodeURIComponent(item.itemId);
export function saveBrowserReport(value: Report) {
  const report = ReportSchema.parse(value);
  const existing = ReportSchema.safeParse(readStored(reportKey(report.id), null));
  if (existing.success) return existing.data;
  writeStored(reportKey(report.id), report); return report;
}
export function saveBrowserChecklist(value: ChecklistItem) { const item = ChecklistItemSchema.parse(value); writeStored(checklistKey(item), item); return item; }
function readAll<T>(prefix: string, schema: z.ZodType<T>): T[] {
  const storage = browserStorage();
  if (!storage) return [];
  return keys(storage, prefix).flatMap(key => { const result = schema.safeParse(readStored(key, null, storage)); return result.success ? [result.data] : []; });
}
export const loadBrowserReports = () => readAll(BROWSER_PREFIX + 'report:', ReportSchema);
export const loadBrowserChecklist = () => readAll(BROWSER_PREFIX + 'checklist:', ChecklistItemSchema);
const CompactSnapshotSchema = z.object({ version: z.literal(1), feed: z.string(), checkedAt: z.string().datetime(), alerts: z.array(LegacyDisasterAlertSchema) });
export const loadBrowserSnapshots = (): AlertSnapshot[] => readAll(BROWSER_PREFIX + 'cache:snapshot:', CompactSnapshotSchema).flatMap(value => {
  try { return [{ feed: value.feed, checkedAt: value.checkedAt, records: value.alerts.map(alert => normalizeAdapterAlert(alert as DisasterAlert, value.feed, value.checkedAt)) }]; }
  catch { return []; }
});
export function saveBrowserSnapshot(value: AlertSnapshot) {
  const snapshot = AlertSnapshotSchema.parse(value);
  writeStored(BROWSER_PREFIX + 'cache:snapshot:' + snapshot.feed, { version: 1, feed: snapshot.feed, checkedAt: snapshot.checkedAt, alerts: snapshot.records.map(toLegacyDisasterAlert) }, true);
}
export function migrateBrowserData() {
  const storage = browserStorage();
  if (!storage) return;
  if (storage.getItem(BROWSER_PREFIX + 'migrated') === '1') return;
  const legacy = z.array(ReportFieldsSchema.extend({ id: z.string().min(1), timestamp: z.string().datetime().optional(), createdAt: z.string().datetime().optional() })).parse(readStored('ews-mktbi:laporan-kpw', []));
  const checklist = z.record(z.string(), z.record(z.string(), z.boolean())).parse(readStored('ews-mktbi:kpw-checklist', {}));
  for (const report of legacy) {
    const { timestamp, ...fields } = report;
    const result = ReportSchema.parse({ ...fields, createdAt: fields.createdAt ?? timestamp });
    if (storage.getItem(reportKey(result.id)) === null) saveBrowserReport(result);
  }
  for (const [officeId, items] of Object.entries(checklist)) for (const [itemId, checked] of Object.entries(items)) {
    const item = { officeId, itemId, checked };
    if (storage.getItem(checklistKey(item)) === null) saveBrowserChecklist(item);
  }
  // Retain original keys as a recovery copy until the user chooses to clear them.
  storage.setItem(BROWSER_PREFIX + 'migrated', '1');
}
const BackupSchema = z.object({ version: z.literal(1), reports: z.array(ReportSchema).max(5000), checklist: z.array(ChecklistItemSchema).max(5000), history: z.array(ReadingSchema).max(100000) }).strict();
export function exportBrowserBackup() { return { version: 1 as const, reports: loadBrowserReports(), checklist: loadBrowserChecklist(), history: readBrowserHistory() }; }
export function importBrowserBackup(value: unknown) {
  const backup = BackupSchema.parse(value), storage = browserStorage();
  if (!storage) throw new Error('Penyimpanan browser tidak tersedia.');
  for (const report of backup.reports) if (storage.getItem(reportKey(report.id)) === null) saveBrowserReport(report);
  for (const item of backup.checklist) if (storage.getItem(checklistKey(item)) === null) saveBrowserChecklist(item);
  mergeBrowserHistory(backup.history);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ews-data-change'));
}
