import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDatabase } from './database.ts';
import { createIqairStore } from './iqairStore.ts';
import { createIqairService, type IqairService } from './iqairService.ts';
import { validateIqairUrl } from './iqairExtractor.ts';

let service: IqairService | undefined;
export function createIqairHandler(injected?: IqairService) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (process.env.VERCEL) { send(503, { error: 'IQAir tersedia hanya pada server lokal.' }); return; }
    if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); send(405, { error: 'Metode tidak didukung.' }); return; }
    // GETs also spend upstream quotas, so reject cross-site requests.
    const origin = req.headers.origin;
    let foreign = req.headers['sec-fetch-site'] === 'cross-site';
    try { foreign ||= !!origin && new URL(origin).host !== req.headers.host; } catch { foreign = true; }
    if (foreign) { send(403, { error: 'Permintaan lintas situs ditolak.' }); return; }
    const query = new URL(req.url || '/', 'http://localhost').searchParams;
    const action = query.get('action');
    if (!['provinces', 'cities', 'all-cities', 'observation', 'add'].includes(action || '') || (action === 'add') !== (req.method === 'POST')) { send(400, { error: 'Aksi IQAir tidak valid.' }); return; }
    if (action === 'add') {
      try { validateIqairUrl(query.get('url') || '', 5); } catch { send(400, { error: 'URL kota IQAir Indonesia tidak valid.' }); return; }
    }
    if ((action === 'cities' || action === 'observation') && (!query.get('id') || query.get('id')!.length > 250)) { send(400, { error: 'ID lokasi diperlukan.' }); return; }
    try {
      const backend = injected || (service ??= createIqairService(createIqairStore(getDatabase()), { key: process.env.IQAIR_API_KEY }));
      if (action === 'provinces') send(200, await backend.directory());
      else if (action === 'all-cities') send(200, await backend.allCities());
      else if (action === 'cities') send(200, await backend.directory(query.get('id')!));
      else if (action === 'observation') send(200, await backend.observation(query.get('id')!));
      else send(200, { location: await backend.addCity(query.get('url')!) });
    } catch {
      send(503, { error: 'Data IQAir tidak tersedia. Periksa koneksi backend dan migrasi database.' });
    }
  };
}
