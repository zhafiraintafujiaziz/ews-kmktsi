export const FEED_SECONDS = {
  earthquakes: 300, 'extreme-weather': 300, 'early-warning': 300, inasiam: 300,
  ispu: 900, sipongi: 900, 'closed-airports': 900,
  forecast: 3600, magma: 3600, 'province-weather': 3600, 'volcano-report': 3600,
  irbi: 86400,
} as const;
export type FeedId = keyof typeof FEED_SECONDS;
export interface FeedResponse<T> {
  version: 1;
  feed: FeedId;
  fetchedAt: string;
  freshUntil: string;
  data: T;
}
export function isFeedResponse(value: unknown, feed: FeedId): value is FeedResponse<unknown> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<FeedResponse<unknown>>;
  const start = Date.parse(v.fetchedAt ?? ''), end = Date.parse(v.freshUntil ?? '');
  return v.version === 1 && v.feed === feed && 'data' in v && Number.isFinite(start)
    && Number.isFinite(end) && end > start && end - start <= FEED_SECONDS[feed] * 1000
    && start <= Date.now() + 30_000;
}
