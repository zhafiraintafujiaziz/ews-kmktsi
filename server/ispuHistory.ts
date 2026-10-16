import { buildIspuRankings, buildIspuSeries, ispuCityKey, validateGraphRange, validateHistoryRange, type IspuDailyReading, type IspuHistoryRange, type IspuHistorySelection, type IspuHistoryResponse, type IspuHistoryExport, type IspuRankingGroup } from '../src/domain/ispuHistory.ts';
import type { IspuStore } from './ispuStore.ts';

export async function* readIspuHistory(store: IspuStore, range: IspuHistoryRange): AsyncGenerator<IspuDailyReading> {
  validateHistoryRange(range);
  for (let offset = 0; ; offset += 1000) {
    const page = await store.history(range, 1000, offset);
    for (const row of page) yield row;
    if (page.length < 1000) break;
  }
}

// For a future Kerentanan chart: X = WIB collection date, Y = ISPU, one
// station per series. Observation time and quality flags stay on each point.
export async function queryIspuTimeSeries(store: IspuStore, range: IspuHistoryRange & { stationId: string }) {
  validateGraphRange(range);
  const readings: IspuDailyReading[] = [];
  for await (const row of readIspuHistory(store, range)) readings.push(row);
  return { stationId: range.stationId, scale: 'ISPU' as const, timeZone: 'Asia/Jakarta' as const,
    dateBasis: 'collection_date' as const, points: buildIspuSeries(readings, range) };
}

export async function queryIspuHistorySeries(store: IspuStore, range: IspuHistoryRange, selection: IspuHistorySelection): Promise<IspuHistoryResponse> {
  validateGraphRange(range);
  const directory = await store.directory();
  const ids = selection.stationId ? [selection.stationId] : directory.cities.find(city => city.cityKey === selection.cityKey)?.stationIds ?? [];
  const readings: IspuDailyReading[] = [];
  for await (const row of readIspuHistory(store, { ...range, stationId: selection.stationId })) {
    if (ids.includes(row.stationId) && (!selection.cityKey || ispuCityKey(row.city, row.province) === selection.cityKey)) readings.push(row);
  }
  return { from: range.from, to: range.to, scale: 'ISPU', timeZone: 'Asia/Jakarta', dateBasis: 'collection_date',
    series: directory.stations.filter(station => ids.includes(station.stationId)).map(station => ({ stationId: station.stationId, name: station.name || station.stationId,
      city: station.city, province: station.province, points: buildIspuSeries(readings, { ...range, stationId: station.stationId }) })) };
}

export async function queryIspuHistoryExport(store: IspuStore, range: IspuHistoryRange): Promise<IspuHistoryExport> {
  validateGraphRange(range);
  const directory = await store.directory();
  const readings: IspuDailyReading[] = [];
  for await (const row of readIspuHistory(store, { from: range.from, to: range.to })) readings.push(row);
  return { from: range.from, to: range.to, stations: directory.stations, readings };
}

export async function queryIspuRankings(store: IspuStore, date: string, groupBy: IspuRankingGroup) {
  validateHistoryRange({ from: date, to: date });
  const readings: IspuDailyReading[] = [];
  for await (const row of readIspuHistory(store, { from: date, to: date })) readings.push(row);
  return buildIspuRankings(readings, date, groupBy);
}

const CSV_COLUMNS = ['collectionDate', 'stationId', 'name', 'city', 'province', 'latitude', 'longitude', 'value', 'category',
  'dominantPollutant', 'sourceTimeText', 'sourceTimeLabel', 'sourceTimezone', 'observedAt', 'qualityFlags'] as const;

function csvCell(value: unknown): string {
  let text = value == null ? '' : Array.isArray(value) ? value.join('|') : String(value);
  // Station metadata is external input. Prevent formula execution on CSV open.
  if (typeof value !== 'number' && /^[\s]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function* exportIspuCsv(store: IspuStore, range: IspuHistoryRange): AsyncGenerator<string> {
  validateHistoryRange(range);
  yield CSV_COLUMNS.join(',') + '\r\n';
  for await (const row of readIspuHistory(store, range)) yield CSV_COLUMNS.map(key => csvCell(row[key])).join(',') + '\r\n';
}
