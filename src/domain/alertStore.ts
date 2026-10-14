import type { DisasterAlert } from '../types/index.ts';
import { normalizeAdapterAlert, toLegacyDisasterAlert, type DisasterRecord } from './disasterRecord.ts';
import { isCurrentlyUsable } from './freshness.ts';
import { applyAlertSnapshots } from './alertCache.ts';
import type { AlertSnapshot } from './persistence.ts';

export type AlertFeed = { id: string; name: string; fetch: () => Promise<DisasterAlert[]> };
export type FeedHealth = Record<string, { status: 'available' | 'unavailable'; checkedAt: string }>;
export interface AlertStoreSnapshot {
  alerts: DisasterAlert[];
  isLoading: boolean;
  isFetching: boolean;
  loadingSources: string[];
  feedHealth: FeedHealth;
  lastCheckedTime: Date | null;
  cachedSnapshotTime: Date | null;
  cachedAlertIds: ReadonlySet<string>;
}

type Clock = Pick<typeof globalThis, 'setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'queueMicrotask'> & { now: () => number };
interface AlertStoreOptions {
  feeds: readonly AlertFeed[];
  loadSnapshots: (signal: AbortSignal) => Promise<AlertSnapshot[]>;
  persist?: (snapshot: AlertSnapshot, history: DisasterRecord[], signal: AbortSignal) => Promise<void>;
  refreshAssessments?: () => Promise<void>;
  onFeedError?: (feed: AlertFeed, error: unknown) => void;
  warn?: (message: string, error?: unknown) => void;
  clock?: Clock;
}

// Compare complete JSON payloads, not notification fingerprints. Key order does
// not matter; geometry coordinates and other ordered arrays still do.
function equalPayload(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => equalPayload(value, b[index]));
  }
  if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalPayload(left[key], right[key]));
}

function stableArray<T>(previous: T[], next: T[]): T[] {
  return previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next;
}
function stableDate(previous: Date | null, time: number | null): Date | null {
  return previous?.getTime() === time || (previous === null && time === null) ? previous : time === null ? null : new Date(time);
}

export function createAlertStore(options: AlertStoreOptions) {
  const clock = options.clock ?? {
    now: Date.now,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
    queueMicrotask: globalThis.queueMicrotask.bind(globalThis),
  };
  const warn = options.warn ?? console.warn;
  const recordsByFeed = new Map<string, DisasterRecord[]>();
  const successfulFeeds = new Set<string>();
  const cachedFeeds = new Map<string, string>();
  const knownFeeds = new Set(options.feeds.map(feed => feed.id));
  const listeners = new Set<() => void>();
  const converted = new WeakMap<DisasterRecord, DisasterAlert>();
  const writes = new Set<AbortController>();
  const pendingWrites: { snapshot: AlertSnapshot; history: DisasterRecord[] }[] = [];
  const pendingFeeds = new Set<string>();
  let cacheLoaded = false;
  let cacheController: AbortController | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let cycle: Promise<void> | null = null;
  let fetching = false;
  let initialComplete = false;
  let hasLoadedData = false;
  let lastChecked: number | null = null;
  let feedHealth: FeedHealth = {};
  let publishQueued = false;
  let snapshot: AlertStoreSnapshot = {
    alerts: [], isLoading: true, isFetching: false, loadingSources: [], feedHealth,
    lastCheckedTime: null, cachedSnapshotTime: null, cachedAlertIds: new Set(),
  };

  function legacy(record: DisasterRecord): DisasterAlert {
    let alert = converted.get(record);
    if (!alert) { alert = toLegacyDisasterAlert(record); converted.set(record, alert); }
    return alert;
  }

  function publish() {
    publishQueued = false;
    const current = new Map<string, DisasterAlert>();
    const cachedIds = new Set<string>();
    const cacheTimes: number[] = [];
    const previous = new Map(snapshot.alerts.map(alert => [alert.id, alert]));
    const now = clock.now();
    // Fixed feed order also fixes duplicate-ID precedence regardless of timing.
    for (const feed of options.feeds) {
      let hasUsable = false;
      for (const record of recordsByFeed.get(feed.id) ?? []) {
        const alert = legacy(record);
        if (!isCurrentlyUsable(alert, now)) continue;
        const old = previous.get(alert.id);
        current.set(alert.id, old && equalPayload(old, alert) ? old : alert);
        hasUsable = true;
        if (cachedFeeds.has(feed.id)) cachedIds.add(alert.id);
        else cachedIds.delete(alert.id);
      }
      if (hasUsable && cachedFeeds.has(feed.id)) cacheTimes.push(Date.parse(cachedFeeds.get(feed.id)!));
    }
    const alerts = stableArray(snapshot.alerts, [...current.values()]);
    if (alerts.length) hasLoadedData = true;
    const next: AlertStoreSnapshot = {
      alerts, isLoading: !hasLoadedData && !initialComplete, isFetching: fetching,
      loadingSources: stableArray(snapshot.loadingSources, options.feeds.filter(feed => pendingFeeds.has(feed.id)).map(feed => feed.name)),
      feedHealth,
      lastCheckedTime: stableDate(snapshot.lastCheckedTime, lastChecked),
      cachedSnapshotTime: stableDate(snapshot.cachedSnapshotTime, cacheTimes.length ? Math.min(...cacheTimes) : null),
      cachedAlertIds: snapshot.cachedAlertIds.size === cachedIds.size && [...cachedIds].every(id => snapshot.cachedAlertIds.has(id)) ? snapshot.cachedAlertIds : cachedIds,
    };
    if ((Object.keys(next) as (keyof AlertStoreSnapshot)[]).some(key => next[key] !== snapshot[key])) {
      snapshot = next;
      listeners.forEach(listener => listener());
    }
    // Publish usable data before starting persistence; never await database writes.
    for (const write of pendingWrites.splice(0)) {
      if (!options.persist || !listeners.size) continue;
      const controller = new AbortController();
      writes.add(controller);
      void Promise.resolve().then(() => {
        if (!controller.signal.aborted) return options.persist!(write.snapshot, write.history, controller.signal);
      }).catch(error => {
        if (!controller.signal.aborted) warn('Riwayat atau cache peringatan gagal disimpan; pemantauan langsung tetap berjalan.', error);
      }).finally(() => writes.delete(controller));
    }
  }

  function schedulePublish() {
    if (publishQueued) return;
    publishQueued = true;
    clock.queueMicrotask(publish);
  }

  async function hydrate(controller: AbortController) {
    try {
      const snapshots = await options.loadSnapshots(controller.signal);
      if (controller.signal.aborted || !listeners.size) return;
      cacheLoaded = true;
      for (const [feed, checkedAt] of applyAlertSnapshots(recordsByFeed, snapshots, successfulFeeds, knownFeeds, clock.now())) cachedFeeds.set(feed, checkedAt);
      schedulePublish();
    } catch (error) {
      if (!controller.signal.aborted) warn('Cache peringatan tidak tersedia; mengambil data langsung.', error);
    } finally {
      if (cacheController === controller) cacheController = null;
    }
  }

  function withDeadline(feed: AlertFeed): Promise<DisasterAlert[]> {
    return new Promise((resolve, reject) => {
      const timeout = clock.setTimeout(() => reject(new Error(`${feed.name} request timed out`)), 15_000);
      Promise.resolve().then(feed.fetch).then(resolve, reject).finally(() => clock.clearTimeout(timeout));
    });
  }

  function refresh(): Promise<void> {
    if (cycle) return cycle;
    fetching = true;
    options.feeds.forEach(feed => pendingFeeds.add(feed.id));
    schedulePublish();
    if (options.refreshAssessments) void Promise.resolve().then(options.refreshAssessments).catch(error => warn('Assessment bahaya gagal:', error));
    const checkedAt = new Date(clock.now()).toISOString();
    const tasks = options.feeds.map(async feed => {
      try {
        const result = await withDeadline(feed);
        const accepted: DisasterRecord[] = [], history: DisasterRecord[] = [];
        for (const alert of result) {
          try {
            const record = normalizeAdapterAlert(alert, feed.id, checkedAt);
            history.push(record);
            if (isCurrentlyUsable(legacy(record), clock.now())) accepted.push(record);
          } catch (error) { warn(`Rejected invalid record from ${feed.name}:`, error); }
        }
        recordsByFeed.set(feed.id, accepted);
        successfulFeeds.add(feed.id);
        cachedFeeds.delete(feed.id);
        feedHealth = { ...feedHealth, [feed.id]: { status: 'available', checkedAt } };
        pendingWrites.push({ snapshot: { feed: feed.id, checkedAt, records: accepted }, history });
      } catch (error) {
        recordsByFeed.set(feed.id, (recordsByFeed.get(feed.id) ?? []).filter(record => isCurrentlyUsable(legacy(record), clock.now())));
        feedHealth = { ...feedHealth, [feed.id]: { status: 'unavailable', checkedAt } };
        options.onFeedError?.(feed, error);
      } finally {
        pendingFeeds.delete(feed.id);
        schedulePublish();
      }
    });
    cycle = Promise.allSettled(tasks).then(() => {
      fetching = false;
      initialComplete = true;
      lastChecked = clock.now();
      cycle = null;
      schedulePublish();
    });
    return cycle;
  }

  function stop() {
    cacheController?.abort();
    cacheController = null;
    writes.forEach(controller => controller.abort());
    writes.clear();
    if (interval !== null) clock.clearInterval(interval);
    interval = null;
  }

  return {
    getSnapshot: () => snapshot,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        schedulePublish();
        if (!cacheLoaded && !cacheController) {
          cacheController = new AbortController();
          void hydrate(cacheController);
        }
        void refresh();
        interval = clock.setInterval(() => void refresh(), 60_000);
      }
      return () => { listeners.delete(listener); if (!listeners.size) stop(); };
    },
  };
}
