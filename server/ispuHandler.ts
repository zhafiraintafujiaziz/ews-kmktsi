import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getDatabase } from './database.ts';
import { createIspuCollector } from './ispuCollector.ts';
import { createIspuStore } from './ispuStore.ts';
import { wibDate } from './ispuParser.ts';

export function createIspuHandler(injected?: ReturnType<typeof createIspuCollector>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, body: unknown) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); send(405, { error: 'Method not allowed' }); return; }
    const secret = process.env.CRON_SECRET;
    if (!secret?.trim()) { send(503, { error: 'CRON_SECRET is not configured.' }); return; }
    const expected = Buffer.from(`Bearer ${secret}`), actual = Buffer.from(req.headers.authorization || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { send(401, { error: 'Unauthorized' }); return; }
    const startedAt = Date.now();
    try {
      const collect = injected || createIspuCollector(createIspuStore(getDatabase()));
      const result = await collect();
      send(result.outcome === 'failed' ? 503 : 200, result);
    } catch (error) {
      console.error(JSON.stringify({ event: 'ispu_daily_collection', collectionDate: wibDate(startedAt), durationMs: Date.now() - startedAt,
        outcome: 'failed', error: error instanceof Error ? error.message : 'Database unavailable' }));
      send(503, { error: 'ISPU archive unavailable. Check database configuration and apply migrations.' });
    }
  };
}
