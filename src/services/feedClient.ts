import { type FeedId, type FeedResponse, isFeedResponse } from '../domain/feedPolicy.ts';
import { BROWSER_PREFIX, readStored, writeStored } from './browserStorage.ts';

const pending = new Map<string, Promise<FeedResponse<unknown>>>();
const memory = new Map<string, FeedResponse<unknown>>();
const failures = new Map<string, { count: number; retryAt: number }>();
export function feedKey(feed: FeedId, params: Record<string, string> = {}) {
  return new URLSearchParams([['feed', feed], ...Object.entries(params).sort(([a], [b]) => a.localeCompare(b))]).toString();
}
export function peekFeed(feed: FeedId, params: Record<string, string> = {}) {
  const key = feedKey(feed, params);
  const stored = readStored<unknown>(BROWSER_PREFIX + 'cache:' + key, null);
  const values = [stored, memory.get(key)].filter(value => isFeedResponse(value, feed));
  return values.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt))[0];
}
export async function requestFeedEnvelope<T>(feed: FeedId, params: Record<string, string> = {}, signal?: AbortSignal): Promise<FeedResponse<T>> {
  signal?.throwIfAborted();
  const key = feedKey(feed, params);
  const cached = peekFeed(feed, params);
  if (cached && Date.parse(cached.freshUntil) > Date.now()) return cached as FeedResponse<T>;
  let task = pending.get(key);
  if (!task) {
    const fetchOnce = async () => {
      const shared = peekFeed(feed, params);
      if (shared && Date.parse(shared.freshUntil) > Date.now()) return shared;
      const failed = failures.get(key);
      if (failed && failed.retryAt > Date.now()) throw new Error('Sumber sedang tidak tersedia. Akan dicoba kembali otomatis.');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Offline. Menampilkan data tersimpan yang masih berlaku.');
      try {
        const response = await fetch('/api/feeds?' + key, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok) throw new Error('Sumber tidak tersedia: HTTP ' + response.status);
        const value: unknown = await response.json();
        if (!isFeedResponse(value, feed)) throw new Error('Respons sumber tidak valid.');
        memory.set(key, value);
        writeStored(BROWSER_PREFIX + 'cache:' + key, value, true);
        failures.delete(key);
        return value;
      } catch (error) {
        const count = (failed?.count ?? 0) + 1;
        failures.set(key, { count, retryAt: Date.now() + Math.min(300, 30 * 2 ** Math.min(count - 1, 4)) * 1000 });
        throw error;
      }
    };
    task = (async () => typeof navigator !== 'undefined' && navigator.locks
      ? await navigator.locks.request('ews-feed:' + key, fetchOnce) : await fetchOnce())().finally(() => pending.delete(key));
    pending.set(key, task);
  }
  const value = await task;
  signal?.throwIfAborted();
  return value as FeedResponse<T>;
}
export async function requestFeed<T>(feed: FeedId, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  return (await requestFeedEnvelope<T>(feed, params, signal)).data;
}
