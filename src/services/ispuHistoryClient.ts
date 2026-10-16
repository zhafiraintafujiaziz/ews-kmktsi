import { usesBrowserStorage } from '../domain/dataMode.ts';
import { queryBrowserHistory } from './browserHistory.ts';

export async function requestIspuHistory<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  if (usesBrowserStorage()) { signal?.throwIfAborted(); return queryBrowserHistory(params) as T; }
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  requestSignal.throwIfAborted();
  const response = await fetch('/api/ispu-history?' + new URLSearchParams(params), { signal: requestSignal, cache: 'no-store' });
  const value = await response.json();
  requestSignal.throwIfAborted();
  if (!response.ok) throw new Error(value.error || 'Riwayat ISPU tidak tersedia.');
  return value as T;
}
