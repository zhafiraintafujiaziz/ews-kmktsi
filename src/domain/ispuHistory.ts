export type IspuQualityFlag = 'stale' | 'undated' | 'ambiguous_timestamp' | 'invalid_timestamp' | 'future_timestamp' | 'invalid_coordinates';

export interface IspuDailyReading {
  collectionDate: string;
  stationId: string;
  name: string;
  city: string;
  province: string;
  latitude: number | null;
  longitude: number | null;
  value: number;
  category: string;
  dominantPollutant: string;
  sourceTimeText: string;
  sourceTimeLabel: string;
  sourceTimezone: string;
  observedAt: string | null;
  qualityFlags: IspuQualityFlag[];
}

export interface IspuHistoryRange { from: string; to: string; stationId?: string }

export interface IspuHistoryStation {
  stationId: string; name: string; city: string; province: string; cityKey: string;
  latitude: number | null; longitude: number | null;
  firstCollectionDate: string; lastCollectionDate: string;
}
export interface IspuHistoryCity { cityKey: string; city: string; province: string; stationIds: string[]; firstCollectionDate: string; lastCollectionDate: string }
export interface IspuHistoryDirectory { stations: IspuHistoryStation[]; cities: IspuHistoryCity[]; collectionDates: string[] }
export interface IspuHistoryExport { from: string; to: string; stations: IspuHistoryStation[]; readings: IspuDailyReading[] }
export type IspuHistorySelection = { stationId: string; cityKey?: never } | { cityKey: string; stationId?: never };
export interface IspuChartSeries { stationId: string; name: string; city: string; province: string; points: IspuSeriesPoint[] }
export interface IspuHistoryResponse {
  from: string; to: string; scale: 'ISPU'; timeZone: 'Asia/Jakarta'; dateBasis: 'collection_date'; series: IspuChartSeries[];
}
export type IspuRankingGroup = 'station' | 'city';
export interface IspuRankingEntry {
  id: string; name: string; city: string; province: string; value: number; category: string;
  stationId: string; stationName: string; stationCount: number;
}
export interface IspuRankings {
  date: string; groupBy: IspuRankingGroup; best: IspuRankingEntry[]; worst: IspuRankingEntry[];
  totalCount: number; eligibleCount: number; excludedCount: number; rankedCount: number;
}

export function ispuCityKey(city: string, province: string): string {
  return city.trim() ? JSON.stringify([province.trim().toLocaleLowerCase('id'), city.trim().toLocaleLowerCase('id')]) : '';
}
export function wibToday(now = Date.now()): string { return new Date(now + 7 * 3600_000).toISOString().slice(0, 10); }
export function ispuDateRange(days: number, to = wibToday()): IspuHistoryRange {
  return { from: new Date(Date.parse(to) - (days - 1) * 86400_000).toISOString().slice(0, 10), to };
}
export function validateGraphRange(range: IspuHistoryRange): IspuHistoryRange {
  try { validateHistoryRange(range); }
  catch { throw new Error('Pilih rentang tanggal yang valid, dengan tanggal awal tidak melewati tanggal akhir.'); }
  if (Date.parse(range.to) - Date.parse(range.from) > 3660 * 86400_000) throw new Error('Rentang grafik maksimal 3.661 hari.');
  return range;
}

export function nearestArchivedStation(stations: IspuHistoryStation[], office: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  let nearest: { station: IspuHistoryStation; distanceKm: number } | null = null;
  for (const station of [...stations].sort((a, b) => a.stationId.localeCompare(b.stationId))) {
    if (station.latitude === null || station.longitude === null || !Number.isFinite(station.latitude) || !Number.isFinite(station.longitude)) continue;
    const a = Math.sin(radians(station.latitude - office.latitude) / 2) ** 2
      + Math.cos(radians(office.latitude)) * Math.cos(radians(station.latitude)) * Math.sin(radians(station.longitude - office.longitude) / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { station, distanceKm };
  }
  return nearest;
}

export function buildIspuRankings(readings: IspuDailyReading[], date: string, groupBy: IspuRankingGroup): IspuRankings {
  const rows = readings.filter(row => row.collectionDate === date);
  const excluded = new Set<IspuQualityFlag>(['stale', 'undated', 'invalid_timestamp', 'ambiguous_timestamp', 'future_timestamp']);
  const eligible = rows.filter(row => Number.isFinite(row.value) && row.value >= 0 && !!row.observedAt && Number.isFinite(Date.parse(row.observedAt))
    && !row.qualityFlags.some(flag => excluded.has(flag)) && (groupBy !== 'city' || !!ispuCityKey(row.city, row.province)));
  const entries = new Map<string, IspuRankingEntry>();
  for (const row of eligible) {
    const id = groupBy === 'station' ? row.stationId : ispuCityKey(row.city, row.province);
    const existing = entries.get(id);
    const stationCount = (existing?.stationCount ?? 0) + 1;
    if (!existing || row.value > existing.value || row.value === existing.value && row.stationId < existing.stationId) {
      entries.set(id, { id, name: groupBy === 'city' ? row.city : row.name || row.stationId, city: row.city, province: row.province,
        value: row.value, category: row.category, stationId: row.stationId, stationName: row.name || row.stationId, stationCount });
    } else existing.stationCount = stationCount;
  }
  const tie = (a: IspuRankingEntry, b: IspuRankingEntry) => a.name.localeCompare(b.name, 'id') || a.province.localeCompare(b.province, 'id') || a.id.localeCompare(b.id);
  const values = [...entries.values()];
  return { date, groupBy, best: [...values].sort((a, b) => a.value - b.value || tie(a, b)).slice(0, 10),
    worst: [...values].sort((a, b) => b.value - a.value || tie(a, b)).slice(0, 10),
    totalCount: rows.length, eligibleCount: eligible.length, excludedCount: rows.length - eligible.length, rankedCount: values.length };
}

export const ISPU_QUALITY_LABELS: Record<IspuQualityFlag, string> = {
  stale: 'Pengamatan lama saat diarsipkan', undated: 'Waktu pengamatan tidak diketahui', ambiguous_timestamp: 'Zona waktu tidak jelas',
  invalid_timestamp: 'Waktu pengamatan tidak valid', future_timestamp: 'Waktu pengamatan di masa depan', invalid_coordinates: 'Koordinat tidak valid',
};

export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validateHistoryRange(range: IspuHistoryRange): IspuHistoryRange {
  if (!isCalendarDate(range.from) || !isCalendarDate(range.to) || range.from > range.to) {
    throw new Error('Use a valid inclusive date range: YYYY-MM-DD, from <= to.');
  }
  if (range.stationId !== undefined && (!range.stationId.trim() || range.stationId.length > 250)) {
    throw new Error('Invalid station ID.');
  }
  return range;
}

export interface IspuSeriesPoint {
  date: string;
  value: number | null;
  reading: IspuDailyReading | null;
}

// A separate series per stable station ID avoids splicing different stations.
// Nulls are intentional chart gaps; callers must not interpolate missing days.
export function buildIspuSeries(readings: IspuDailyReading[], range: IspuHistoryRange & { stationId: string }): IspuSeriesPoint[] {
  validateHistoryRange(range);
  const rows = new Map(readings.filter(row => row.stationId === range.stationId).map(row => [row.collectionDate, row]));
  const points: IspuSeriesPoint[] = [];
  for (let time = Date.parse(range.from); time <= Date.parse(range.to); time += 86400_000) {
    const date = new Date(time).toISOString().slice(0, 10);
    const reading = rows.get(date) ?? null;
    points.push({ date, value: reading?.value ?? null, reading });
  }
  return points;
}
