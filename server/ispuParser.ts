import { getIspuCategory } from '../src/constants/ispuCategories.ts';
import type { IspuDailyReading, IspuQualityFlag } from '../src/domain/ispuHistory.ts';
import { parseSourceTime } from '../src/utils/ispuTime.ts';
export { parseSourceTime } from '../src/utils/ispuTime.ts';

export const ISPU_SOURCE_URL = 'https://ispu.kemenlh.go.id/apimobile/v1/getStations';
const DAY = 86400_000;
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';

export function wibDate(time: number): string {
  return new Date(time + 7 * 3600_000).toISOString().slice(0, 10);
}

export function numericValue(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export class InvalidStationResponse extends Error {
  counts: { stationCount: number; acceptedCount: number; rejectedCount: number; staleCount: number; undatedCount: number };
  constructor(counts: InvalidStationResponse['counts']) {
    super('ISPU response contains no valid station readings.'); this.counts = counts;
  }
}

export function parseStationResponse(payload: unknown, collectionDate: string, fetchedAt: number) {
  if (!payload || typeof payload !== 'object' || !('rows' in payload) || !Array.isArray(payload.rows) || payload.rows.length === 0) {
    throw new Error('ISPU response must contain a non-empty rows array.');
  }
  const readings: IspuDailyReading[] = [];
  const ids = new Set<string>();
  let rejectedCount = 0;
  for (const row of payload.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { rejectedCount++; continue; }
    const source = row as Record<string, unknown>;
    const stationId = text(source.id_stasiun).trim();
    const value = numericValue(source.val);
    if (!stationId || value === null || value < 0 || ids.has(stationId)) { rejectedCount++; continue; }
    ids.add(stationId);
    const sourceTimeText = text(source.waktu);
    const sourceTimeLabel = text(source.waktu_text);
    const sourceTimezone = text(source.time_z);
    const parse = (raw: string) => {
      const time = parseSourceTime(raw);
      const zone = sourceTimezone.trim().toUpperCase();
      if (raw.trim() && time.issue === 'ambiguous_timestamp' && /^(WIB|WITA|WIT|UTC|GMT)$/.test(zone)) {
        return parseSourceTime(`${raw} ${zone}`);
      }
      return time;
    };
    const time = parse(sourceTimeText || sourceTimeLabel);
    const fallbackTime = time.observedAt ? time : parse(sourceTimeLabel);
    const observedAt = fallbackTime.observedAt || time.observedAt;
    const qualityFlags: IspuQualityFlag[] = [];
    if (!observedAt) {
      qualityFlags.push('undated');
      if (time.issue || fallbackTime.issue) qualityFlags.push(time.issue || fallbackTime.issue!);
    } else {
      const age = fetchedAt - Date.parse(observedAt);
      if (age > DAY) qualityFlags.push('stale');
      if (age < 0) qualityFlags.push('future_timestamp');
    }
    const lat = numericValue(source.lat), lon = numericValue(source.lon);
    const latitude = lat !== null && lat >= -90 && lat <= 90 ? lat : null;
    const longitude = lon !== null && lon >= -180 && lon <= 180 ? lon : null;
    if (latitude === null || longitude === null) qualityFlags.push('invalid_coordinates');
    readings.push({ collectionDate, stationId, value, name: text(source.nama), city: text(source.kota), province: text(source.provinsi),
      latitude, longitude, category: getIspuCategory(value), dominantPollutant: text(source.param).replace(/<\/?sub>/gi, ''),
      sourceTimeText, sourceTimeLabel, sourceTimezone, observedAt, qualityFlags });
  }
  const counts = { stationCount: payload.rows.length, acceptedCount: readings.length, rejectedCount,
    staleCount: readings.filter(row => row.qualityFlags.includes('stale')).length,
    undatedCount: readings.filter(row => row.qualityFlags.includes('undated')).length };
  if (!readings.length) throw new InvalidStationResponse(counts);
  return { readings, ...counts };
}
