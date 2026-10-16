import { z } from 'zod';
import { AlertSnapshotSchema, BrowserImportSchema, ChecklistItemSchema, ReportFieldsSchema, ReportSchema, type Report, type ChecklistItem, type AlertSnapshot } from '../domain/persistence.ts';
import type { DisasterRecord } from '../domain/disasterRecord.ts';
import { usesBrowserStorage } from '../domain/dataMode.ts';
import { migrateBrowserData, saveBrowserReport, loadBrowserReports, saveBrowserChecklist, loadBrowserChecklist, saveBrowserSnapshot, loadBrowserSnapshots } from './browserPersistence.ts';

const REPORTS_KEY = 'ews-mktbi:laporan-kpw';
const CHECKLIST_KEY = 'ews-mktbi:kpw-checklist';
const BROWSER_KEY = 'ews-mktbi:database-browser-id';
const LegacyReportSchema = ReportFieldsSchema.extend({ id: z.string().min(1), timestamp: z.string().datetime() }).strip();
const LegacyChecklistSchema = z.record(z.string(), z.record(z.string(), z.boolean()));
let initialization: Promise<void> | undefined;

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error('Penyimpanan database gagal. Silakan coba lagi.');
  return payload as T;
}

export function readBrowserImport(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let browserId = storage.getItem(BROWSER_KEY);
  if (!browserId) {
    browserId = crypto.randomUUID();
    storage.setItem(BROWSER_KEY, browserId);
  }
  const legacyReports = z.array(LegacyReportSchema).parse(JSON.parse(storage.getItem(REPORTS_KEY) || '[]'));
  const legacyChecklist = LegacyChecklistSchema.parse(JSON.parse(storage.getItem(CHECKLIST_KEY) || '{}'));
  return BrowserImportSchema.parse({
    browserId,
    reports: legacyReports.map(({ timestamp, ...report }) => ({ ...report, createdAt: timestamp })),
    checklistItems: Object.entries(legacyChecklist).flatMap(([officeId, items]) =>
      Object.entries(items).map(([itemId, checked]) => ({ officeId, itemId, checked }))),
  });
}

export function initializePersistence(): Promise<void> {
  if (usesBrowserStorage()) return Promise.resolve().then(migrateBrowserData);
  initialization ??= Promise.resolve().then(async () => {
    const input = readBrowserImport(localStorage);
    await request('/api/import', 'POST', input);
  }).catch(error => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

export async function saveReport(report: Report): Promise<Report> {
  await initializePersistence();
  if (usesBrowserStorage()) return saveBrowserReport(report);
  const response = await request<{ report: Report }>('/api/reports', 'POST', ReportSchema.parse(report));
  return ReportSchema.parse(response.report);
}

export async function loadReports(): Promise<Report[]> {
  await initializePersistence();
  if (usesBrowserStorage()) return loadBrowserReports();
  const response = await request<{ reports: Report[] }>('/api/reports');
  return z.array(ReportSchema).parse(response.reports);
}

export async function loadChecklist(): Promise<ChecklistItem[]> {
  await initializePersistence();
  if (usesBrowserStorage()) return loadBrowserChecklist();
  const response = await request<{ items: ChecklistItem[] }>('/api/checklist');
  return z.array(ChecklistItemSchema.strip()).parse(response.items);
}

export async function saveChecklist(item: ChecklistItem): Promise<ChecklistItem> {
  await initializePersistence();
  if (usesBrowserStorage()) return saveBrowserChecklist(item);
  const response = await request<{ item: ChecklistItem }>('/api/checklist', 'PUT', ChecklistItemSchema.parse(item));
  return ChecklistItemSchema.strip().parse(response.item);
}

export async function persistAlertHistory(records: DisasterRecord[], signal?: AbortSignal): Promise<void> {
  if (usesBrowserStorage()) return;
  // Small bounded requests; no background timer and no dependency on legacy imports.
  for (let offset = 0; offset < records.length; offset += 20) {
    signal?.throwIfAborted();
    await request('/api/alerts', 'POST', { records: records.slice(offset, offset + 20) }, signal);
  }
}

export async function loadAlertSnapshots(signal?: AbortSignal): Promise<AlertSnapshot[]> {
  if (usesBrowserStorage()) return loadBrowserSnapshots();
  const response = await request<{ snapshots: AlertSnapshot[] }>('/api/alert-cache', 'GET', undefined, signal);
  return z.array(AlertSnapshotSchema).parse(response.snapshots);
}

export async function persistAlertSnapshot(snapshot: AlertSnapshot, signal?: AbortSignal): Promise<void> {
  if (usesBrowserStorage()) { saveBrowserSnapshot(snapshot); return; }
  await request('/api/alert-cache', 'POST', AlertSnapshotSchema.parse(snapshot), signal);
}
