import { z } from 'zod';
import { BROWSER_PREFIX, browserStorage, readStored, writeStored, registerHistoryEvictor } from './browserStorage.ts';
import { buildIspuRankings, buildIspuSeries, ispuCityKey, validateGraphRange, wibToday, type IspuDailyReading, type IspuHistoryDirectory } from '../domain/ispuHistory.ts';

export const ReadingSchema = z.object({
  collectionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), stationId: z.string().min(1),
  name: z.string(), city: z.string(), province: z.string(), latitude: z.number().nullable(), longitude: z.number().nullable(),
  value: z.number().finite().nonnegative(), category: z.string(), dominantPollutant: z.string(),
  sourceTimeText: z.string(), sourceTimeLabel: z.string(), sourceTimezone: z.string(), observedAt: z.string().nullable(),
  qualityFlags: z.array(z.enum(['stale', 'undated', 'ambiguous_timestamp', 'invalid_timestamp', 'future_timestamp', 'invalid_coordinates'])),
}).strict();
const HISTORY_KEY = BROWSER_PREFIX + 'ispu-history';
const fields = ['stationId', 'name', 'city', 'province', 'latitude', 'longitude', 'value', 'category', 'dominantPollutant', 'sourceTimeText', 'sourceTimeLabel', 'sourceTimezone', 'observedAt', 'qualityFlags'] as const;
const numeric = new Set<string>(['latitude', 'longitude', 'value']);
interface PackedHistory { version: 1; strings: string[]; days: Record<string, (number | null)[][]> }
function pack(rows: IspuDailyReading[]): PackedHistory {
  const strings: string[] = [], indexes = new Map<string, number>();
  const intern = (value: string) => { let index = indexes.get(value); if (index === undefined) { index = strings.length; strings.push(value); indexes.set(value, index); } return index; };
  const days: PackedHistory['days'] = {};
  for (const row of rows) (days[row.collectionDate] ??= []).push(fields.map(field => {
    const value = row[field];
    if (value === null) return null;
    return numeric.has(field) ? value as number : intern(Array.isArray(value) ? value.join(',') : String(value));
  }));
  return { version: 1, strings, days };
}
export function readBrowserHistory(): IspuDailyReading[] {
  const value = readStored<PackedHistory | null>(HISTORY_KEY, null);
  if (!value || value.version !== 1 || !Array.isArray(value.strings) || !value.days) return [];
  try {
    return Object.entries(value.days).flatMap(([collectionDate, rows]) => rows.map(values => {
      const row: Record<string, unknown> = { collectionDate };
      fields.forEach((field, index) => {
        const raw = values[index];
        const decoded = raw === null ? null : numeric.has(field) ? raw : value.strings[raw];
        row[field] = field === 'qualityFlags' ? (decoded ? String(decoded).split(',') : []) : decoded;
      });
      return ReadingSchema.parse(row);
    }));
  } catch { return []; }
}
export function mergeBrowserHistory(incoming: IspuDailyReading[], now = Date.now()): void {
  const rows = new Map(readBrowserHistory().map(row => [row.collectionDate + ':' + row.stationId, row]));
  for (const row of z.array(ReadingSchema).parse(incoming)) {
    const key = row.collectionDate + ':' + row.stationId;
    if (!rows.has(key)) rows.set(key, row);
  }
  const cutoff = new Date(Date.parse(wibToday(now)) - 89 * 86400_000).toISOString().slice(0, 10);
  let retained = [...rows.values()].filter(row => row.collectionDate >= cutoff && row.collectionDate <= wibToday(now));
  let packed = pack(retained);
  while (JSON.stringify(packed).length * 2 > 2 * 1024 * 1024 && retained.length) {
    const oldest = retained.map(row => row.collectionDate).sort()[0];
    retained = retained.filter(row => row.collectionDate !== oldest);
    packed = pack(retained);
  }
  while (!writeStored(HISTORY_KEY, packed, true)) {
    if (!retained.length) throw new Error('Riwayat ISPU belum tersimpan. Penyimpanan browser tidak tersedia atau penuh.');
    const oldest = retained.map(row => row.collectionDate).sort()[0];
    retained = retained.filter(row => row.collectionDate !== oldest);
    packed = pack(retained);
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ews-history-change'));
}
registerHistoryEvictor(() => {
  const storage = browserStorage(), rows = readBrowserHistory();
  if (!storage || !rows.length) return false;
  const oldest = rows.map(row => row.collectionDate).sort()[0];
  try {
    const retained = rows.filter(row => row.collectionDate !== oldest);
    if (retained.length) storage.setItem(HISTORY_KEY, JSON.stringify(pack(retained)));
    else storage.removeItem(HISTORY_KEY);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('ews-history-change'));
    return true;
  } catch { return false; }
});
export async function recordBrowserIspu(readings: IspuDailyReading[], fetchedAt: string) {
  const today = wibToday();
  if (wibToday(Date.parse(fetchedAt)) !== today || !readings.length) return;
  const save = () => {
    if (readBrowserHistory().some(row => row.collectionDate === today)) return;
    mergeBrowserHistory(readings.filter(row => row.collectionDate === today));
  };
  if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('ews-ispu-daily', save);
  else save();
}
export function browserHistoryDirectory(rows = readBrowserHistory()): IspuHistoryDirectory {
  const stations = new Map<string, IspuHistoryDirectory['stations'][number]>();
  const cities = new Map<string, IspuHistoryDirectory['cities'][number]>();
  for (const row of [...rows].sort((a, b) => a.collectionDate.localeCompare(b.collectionDate))) {
    const previous = stations.get(row.stationId);
    stations.set(row.stationId, { stationId: row.stationId, name: row.name, city: row.city, province: row.province, cityKey: ispuCityKey(row.city, row.province),
      latitude: row.latitude ?? previous?.latitude ?? null, longitude: row.longitude ?? previous?.longitude ?? null,
      firstCollectionDate: previous?.firstCollectionDate ?? row.collectionDate, lastCollectionDate: row.collectionDate });
    const key = ispuCityKey(row.city, row.province);
    if (!key) continue;
    const city = cities.get(key) ?? { cityKey: key, city: row.city, province: row.province, stationIds: [], firstCollectionDate: row.collectionDate, lastCollectionDate: row.collectionDate };
    if (!city.stationIds.includes(row.stationId)) city.stationIds.push(row.stationId);
    city.lastCollectionDate = row.collectionDate; cities.set(key, city);
  }
  return { stations: [...stations.values()], cities: [...cities.values()], collectionDates: [...new Set(rows.map(row => row.collectionDate))].sort() };
}
export function queryBrowserHistory(params: Record<string, string>): unknown {
  const rows = readBrowserHistory(), directory = browserHistoryDirectory(rows);
  if (params.action === 'directory') return directory;
  if (params.action === 'rankings') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date) || !['station', 'city'].includes(params.groupBy)) throw new Error('Pilih tanggal dan kelompok yang valid.');
    return buildIspuRankings(rows, params.date, params.groupBy as 'station' | 'city');
  }
  const range = validateGraphRange({ from: params.from, to: params.to });
  const matching = rows.filter(row => row.collectionDate >= range.from && row.collectionDate <= range.to
    && (!params.stationId || row.stationId === params.stationId) && (!params.cityKey || ispuCityKey(row.city, row.province) === params.cityKey));
  const ids = new Set(matching.map(row => row.stationId));
  const stations = directory.stations.filter(station => ids.has(station.stationId) || station.stationId === params.stationId);
  if (params.action === 'export') return { ...range, stations, readings: matching };
  if (params.action !== 'series' || Boolean(params.stationId) === Boolean(params.cityKey)) throw new Error('Pilih satu stasiun atau kota.');
  return { ...range, scale: 'ISPU', timeZone: 'Asia/Jakarta', dateBasis: 'collection_date', series: stations.map(station => ({ stationId: station.stationId,
    name: station.name, city: station.city, province: station.province, points: buildIspuSeries(matching, { ...range, stationId: station.stationId }) })) };
}
