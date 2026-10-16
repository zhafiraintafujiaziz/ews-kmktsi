import * as XLSX from 'xlsx';
import { ISPU_QUALITY_LABELS, validateGraphRange } from '../domain/ispuHistory.ts';
import type { IspuDailyReading, IspuHistoryExport, IspuHistoryStation } from '../domain/ispuHistory.ts';

type IspuWorkbookData = Pick<IspuHistoryExport, 'from' | 'to' | 'readings'> & {
  stations: Pick<IspuHistoryStation, 'stationId' | 'name' | 'city' | 'province'>[];
};

export function buildIspuHistoryWorkbook(data: IspuWorkbookData, sheetName = 'ISPU semua stasiun') {
  validateGraphRange(data);
  const dates: string[] = [];
  for (let time = Date.parse(data.from); time <= Date.parse(data.to); time += 86400_000) {
    dates.push(new Date(time).toISOString().slice(0, 10));
  }
  const byStation = new Map<string, Map<string, IspuDailyReading>>();
  for (const reading of data.readings) {
    if (reading.collectionDate < data.from || reading.collectionDate > data.to) continue;
    const days = byStation.get(reading.stationId) ?? new Map<string, IspuDailyReading>();
    days.set(reading.collectionDate, reading);
    byStation.set(reading.stationId, days);
  }
  const sheet = XLSX.utils.aoa_to_sheet([
    ['ID stasiun', 'Stasiun', 'Kota / kabupaten', 'Provinsi', ...dates],
    ...data.stations.map(station => [station.stationId, station.name || station.stationId, station.city, station.province,
      ...dates.map(date => byStation.get(station.stationId)?.get(date)?.value ?? null)]),
  ]);
  data.stations.forEach((station, row) => {
    dates.forEach((date, column) => {
      const reading = byStation.get(station.stationId)?.get(date);
      if (reading?.qualityFlags.length) {
        sheet[XLSX.utils.encode_cell({ r: row + 1, c: column + 4 })].c = [{ a: 'Catatan kualitas',
          t: reading.qualityFlags.map(flag => ISPU_QUALITY_LABELS[flag]).join('; ') }];
      }
    });
  });
  sheet['!cols'] = [20, 30, 24, 24, ...dates.map(() => 14)].map(wch => ({ wch }));
  sheet['!autofilter'] = { ref: sheet['!ref']! };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return workbook;
}
