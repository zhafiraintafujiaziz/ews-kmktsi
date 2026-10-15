import { setTimeout as delay } from 'node:timers/promises';
import { InvalidStationResponse, ISPU_SOURCE_URL, parseStationResponse, wibDate } from './ispuParser.ts';
import type { IspuRun, IspuStore } from './ispuStore.ts';

class CollectionError extends Error {
  retryable: boolean;
  constructor(message: string, retryable = false) { super(message); this.retryable = retryable; }
}

export interface CollectionResult {
  outcome: 'success' | 'already_collected' | 'failed';
  run: Omit<IspuRun, 'rawResponse'>;
}
interface Options {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  log?: (event: Record<string, unknown>) => void;
}

export function createIspuCollector(store: IspuStore, options: Options = {}) {
  const request = options.fetch || fetch;
  const now = options.now || Date.now;
  const sleep = options.sleep || delay;
  const log = options.log || (event => console.log(JSON.stringify(event)));
  return async (): Promise<CollectionResult> => {
    const startedAt = now();
    const collectionDate = wibDate(startedAt);
    let run: IspuRun = { collectionDate, scheduledAt: `${collectionDate}T01:30:00.000Z`, fetchedAt: null,
      completedAt: new Date(startedAt).toISOString(), status: 'failed', attemptCount: 0,
      stationCount: 0, acceptedCount: 0, rejectedCount: 0, staleCount: 0, undatedCount: 0, errorSummary: null, rawResponse: null };
    const finish = (outcome: CollectionResult['outcome'], saved: IspuRun): CollectionResult => {
      log({ event: 'ispu_daily_collection', collectionDate, durationMs: now() - startedAt, outcome,
        attemptCount: run.attemptCount, stationCount: saved.stationCount, acceptedCount: saved.acceptedCount,
        rejectedCount: saved.rejectedCount, staleCount: saved.staleCount, undatedCount: saved.undatedCount, error: saved.errorSummary });
      const { rawResponse: _raw, ...summary } = saved;
      void _raw;
      return { outcome, run: summary };
    };
    try {
      const existing = await store.run(collectionDate);
      if (existing?.status === 'success') return finish('already_collected', existing);
      for (let attempt = 1; attempt <= 3; attempt++) {
        let parsed: ReturnType<typeof parseStationResponse>;
        let rawResponse: string;
        const fetchedAt = now();
        if (wibDate(fetchedAt) !== collectionDate) throw new CollectionError('Collection crossed WIB midnight. Invoke again for the new date.');
        run.attemptCount = attempt;
        run.fetchedAt = new Date(fetchedAt).toISOString();
        try {
          // The signal covers the complete body read as well as response headers.
          const response = await request(ISPU_SOURCE_URL, { cache: 'no-store', redirect: 'error',
            headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(10_000) });
          if (!response.ok) throw new CollectionError(`KemenLH HTTP ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500);
          rawResponse = await response.text();
          let payload: unknown;
          try { payload = JSON.parse(rawResponse); } catch { throw new CollectionError('KemenLH returned invalid JSON.', true); }
          try { parsed = parseStationResponse(payload, collectionDate, fetchedAt); }
          catch (error) {
            if (error instanceof InvalidStationResponse) run = { ...run, ...error.counts };
            throw new CollectionError(error instanceof Error ? error.message : 'Malformed ISPU response.', true);
          }
          if (wibDate(now()) !== collectionDate) throw new CollectionError('Collection crossed WIB midnight. Invoke again for the new date.');
        } catch (error) {
          const retryable = error instanceof CollectionError ? error.retryable
            : error instanceof TypeError || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
          if (!retryable || attempt === 3) throw error;
          await sleep(attempt === 1 ? 2000 : 5000);
          continue;
        }
        const { readings, ...counts } = parsed;
        run = { ...run, ...counts, completedAt: new Date(now()).toISOString(), status: 'success', rawResponse };
        const committed = await store.commit(run, readings);
        if (committed) return finish('success', run);
        const winner = await store.run(collectionDate);
        if (!winner || winner.status !== 'success') throw new Error('Concurrent snapshot is unavailable.');
        return finish('already_collected', winner);
      }
      throw new Error('ISPU attempts exhausted.');
    } catch (error) {
      run = { ...run, status: 'failed', rawResponse: null, completedAt: new Date(now()).toISOString(),
        errorSummary: (error instanceof Error ? error.message : String(error)).slice(0, 1000) };
      try {
        await store.failure(run);
        const winner = await store.run(collectionDate);
        if (winner?.status === 'success') return finish('already_collected', winner);
      } catch { log({ event: 'ispu_failure_persistence_failed', collectionDate }); }
      return finish('failed', run);
    }
  };
}
