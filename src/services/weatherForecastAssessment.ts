import type { AlertSeverity } from '../types';
import { PROVINCES } from '../constants/provinces';
import { mapTextToProvinceId } from '../utils/provinceMap';

export const FORECAST_SOURCE = 'https://www.bmkg.go.id/cuaca/potensi-cuaca-ekstrem';
const DAY = 86400000;
export interface ForecastCell {
  provinceId: string;
  date: string;
  validFrom: string;
  validUntil: string;
  label: string;
  severity: AlertSeverity | 0 | null;
}
export interface ForecastSnapshot {
  dates: string[];
  cells: ForecastCell[];
  checkedAt: string;
  error: string | null;
}
let snapshot: ForecastSnapshot | null = null;
let revision = 0;
const listeners = new Set<() => void>();
export const subscribeForecast = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const getForecastRevision = () => revision;
function notify() { revision++; listeners.forEach(listener => listener()); }
export function publishForecastSnapshot(value: ForecastSnapshot) { snapshot = value; notify(); }
export function failForecastSnapshot() {
  snapshot = { dates: [], cells: [], checkedAt: new Date().toISOString(), error: 'Data prakiraan BMKG tidak tersedia.' };
  notify();
}
export function getForecastSnapshot() { return snapshot; }
export function jakartaDayStart(now: number): number {
  return Math.floor((now + 7 * 3600000) / DAY) * DAY - 7 * 3600000;
}
export function parseForecastDate(text: string): number | null {
  const months: Record<string, number> = {
    jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2,
    mar: 3, march: 3, maret: 3, apr: 4, april: 4, may: 5, mei: 5,
    jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7,
    aug: 8, august: 8, agu: 8, agt: 8, agustus: 8,
    sep: 9, september: 9, oct: 10, okt: 10, october: 10, oktober: 10,
    nov: 11, november: 11, dec: 12, des: 12, december: 12, desember: 12,
  };
  const match = text.trim().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
  if (!match || !months[match[2].toLowerCase()]) return null;
  const day = Number(match[1]), month = months[match[2].toLowerCase()], year = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const checked = new Date(utc);
  return checked.getUTCDate() === day && checked.getUTCMonth() === month - 1 ? utc - 7 * 3600000 : null;
}
export function mapForecastWarning(text: string): AlertSeverity | 0 | null {
  const value = text.trim().toLowerCase();
  if (/^(?:[-—–]|nihil|tidak ada)$/.test(value)) return 0;
  if (/\b(?:awas|siaga)\b/.test(value)) return 3;
  if (/\bwaspada\b/.test(value)) return 2;
  if (/\bpotensi\b|angin kencang/.test(value)) return 1;
  return null;
}
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&(?:nbsp|#160);/g, ' ').replace(/&(?:mdash|#8212);/g, '—').replace(/&(?:ndash|#8211);/g, '–').replace(/\s+/g, ' ').trim();
export function parseForecastTable(html: string, now = Date.now()): ForecastSnapshot {
  const today = jakartaDayStart(now);
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const headers = [...(table[1].match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '').matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m => plain(m[1]));
    const provinceColumn = headers.findIndex(header => /provinsi/i.test(header));
    const columns = headers.flatMap((label, index) => {
      const starts = parseForecastDate(label);
      return starts !== null && starts >= today && starts < today + 3 * DAY ? [{ index, label, starts }] : [];
    }).sort((a, b) => a.starts - b.starts);
    if (provinceColumn < 0 || columns.length === 0) continue;
    const cells: ForecastCell[] = [];
    const body = table[1].match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
    if (!body) continue;
    for (const row of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const values = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => plain(m[1]));
      const name = values[provinceColumn] || '';
      const provinceId = PROVINCES.find(p => p.name.toLowerCase() === name.toLowerCase())?.id ?? mapTextToProvinceId(name);
      if (provinceId === 'unknown' || !provinceId) continue;
      for (const column of columns) {
        const label = values[column.index] || '';
        cells.push({ provinceId, date: column.label, label, severity: mapForecastWarning(label),
          validFrom: new Date(column.starts).toISOString(), validUntil: new Date(column.starts + DAY).toISOString() });
      }
    }
    if (cells.length) return { dates: [...new Set(columns.map(c => c.label))], cells, checkedAt: new Date(now).toISOString(), error: null };
  }
  throw new Error('BMKG forecast table has no recognized current date columns or province rows');
}
export function getProvinceForecast(provinceId: string, now = Date.now()) {
  const today = jakartaDayStart(now);
  const cells = (snapshot?.cells || []).filter(cell => cell.provinceId === provinceId && Date.parse(cell.validUntil) > now && Date.parse(cell.validFrom) < today + 3 * DAY);
  const dates = (snapshot?.dates || []).filter(date => { const start = parseForecastDate(date); return start !== null && start >= today && start < today + 3 * DAY; });
  const incomplete = dates.length < 3 || cells.length < dates.length || cells.some(cell => cell.severity === null);
  // Unknown cells cannot establish the maximum unless a high warning already dominates.
  const known = cells.filter(cell => cell.severity !== null);
  const max = known.length ? Math.max(...known.map(cell => cell.severity!)) as AlertSeverity | 0 : null;
  const severity = cells.some(cell => cell.severity === null) && max !== 3 ? null : max;
  return { severity, cells, dates, incomplete, checkedAt: snapshot?.checkedAt ?? null,
    status: snapshot?.error ? 'error' : !snapshot ? 'loading' : severity === null ? 'no_data' : 'available' } as const;
}
