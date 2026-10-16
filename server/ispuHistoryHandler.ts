import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDatabase } from './database.ts';
import { createIspuStore, type IspuStore } from './ispuStore.ts';
import { queryIspuHistorySeries, queryIspuHistoryExport, queryIspuRankings } from './ispuHistory.ts';
import { isCalendarDate, validateGraphRange } from '../src/domain/ispuHistory.ts';

export function createIspuHistoryHandler(injected?: IspuStore) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    if (process.env.VERCEL) { send(503, { error: 'Riwayat ISPU tersedia hanya pada server lokal.' }); return; }
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); send(405, { error: 'Metode tidak didukung.' }); return; }
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const action = params.get('action');
    const range = { from: params.get('from') || '', to: params.get('to') || '' };
    const stationId = params.get('stationId'), cityKey = params.get('cityKey');
    const date = params.get('date') || '', groupBy = params.get('groupBy');
    try {
      if (!['directory', 'series', 'rankings', 'export'].includes(action || '')) throw new Error('Aksi tidak valid.');
      if (action === 'series' || action === 'export') validateGraphRange(range);
      if (action === 'series') {
        if (Boolean(stationId) === Boolean(cityKey) || stationId !== null && (!stationId.trim() || stationId.length > 250)
          || cityKey !== null && (!cityKey.trim() || cityKey.length > 1000)) throw new Error('Pilih satu stasiun atau kota yang valid.');
      }
      if (action === 'rankings' && (!isCalendarDate(date) || !['station', 'city'].includes(groupBy || ''))) throw new Error('Tanggal atau kelompok peringkat tidak valid.');
    } catch (error) { send(400, { error: error instanceof Error ? error.message : 'Permintaan tidak valid.' }); return; }
    try {
      const store = injected || createIspuStore(getDatabase());
      if (action === 'directory') send(200, await store.directory());
      else if (action === 'export') send(200, await queryIspuHistoryExport(store, range));
      else if (action === 'series') send(200, await queryIspuHistorySeries(store, range, stationId ? { stationId } : { cityKey: cityKey! }));
      else send(200, await queryIspuRankings(store, date, groupBy as 'station' | 'city'));
    } catch { send(503, { error: 'Riwayat ISPU tidak tersedia. Periksa database lokal dan migrasinya.' }); }
  };
}
