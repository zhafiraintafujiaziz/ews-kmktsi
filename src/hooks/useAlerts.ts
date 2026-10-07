import { useEffect, useMemo, useState } from 'react';
import type { DisasterAlert, AlertSeverity } from '../types';
import { failForecastSnapshot } from '../services/weatherForecastAssessment';
import { isCurrentlyUsable } from '../domain/freshness';
import { normalizeAdapterAlert, toLegacyDisasterAlert, type DisasterRecord } from '../domain/disasterRecord';
import {
  fetchLatestEarthquakes,
  fetchExtremeWeather,
  fetchThreeDayForecast,
  fetchHighRainfallWarning,
  fetchEarlyWarning,
} from '../services/bmkgService';
import { MagmaService } from '../services/magmaService';
import { SipongiService } from '../services/sipongiService';
import { InaSiamService } from '../services/inaSiamService';
import { IspuService } from '../services/ispuService';
import { BnpbInariskService } from '../services/bnpbInariskService';
import { KarhutlaRegionalService } from '../services/karhutlaRegionalService';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { loadAlertSnapshots, persistAlertHistory, persistAlertSnapshot } from '../services/persistenceService';
import { applyAlertSnapshots } from '../domain/alertCache';

type Feed = {
  id: string;
  name: string;
  fetch: () => Promise<DisasterAlert[]>;
};

export type FeedHealth = Record<string, { status: 'available' | 'unavailable'; checkedAt: string }>;

const feeds: Feed[] = [
  { id: 'earthquakes', name: 'Gempa BMKG', fetch: fetchLatestEarthquakes },
  { id: 'extreme-weather', name: 'Cuaca Buruk BMKG', fetch: fetchExtremeWeather },
  { id: 'early-warning', name: 'Peringatan Dini Cuaca BMKG', fetch: fetchEarlyWarning },
  { id: 'forecast', name: 'Prakiraan 3 Hari BMKG', fetch: fetchThreeDayForecast },
  { id: 'rainfall', name: 'Curah Hujan Tinggi BMKG', fetch: fetchHighRainfallWarning },
  { id: 'magma', name: 'Live Gunung Api Magma', fetch: () => MagmaService.fetchLiveAlerts() },
  { id: 'sipongi', name: 'Sipongi Karhutla', fetch: () => SipongiService.fetchKarhutlaAlerts() },
  { id: 'inasiam', name: 'Abu Vulkanik INA-SIAM', fetch: () => InaSiamService.fetchLiveAlerts() },
  { id: 'ispu', name: 'Kualitas Udara ISPU', fetch: () => IspuService.fetchAirQualityAlerts() },
  { id: 'inarisk', name: 'Analisis Bahaya InaRISK', fetch: async () => {
    await BnpbInariskService.refreshAssessment(KPWBI_OFFICES, ['earthquake', 'extreme_weather']);
    return [];
  } },
];

const REQUEST_DEADLINE_MS = 15_000;
const POLL_INTERVAL_MS = 60_000;
const recordsByFeed = new Map<string, DisasterRecord[]>();
const successfulFeeds = new Set<string>();
const cachedFeeds = new Map<string, string>();
const knownFeeds = new Set(feeds.map(feed => feed.id));
let cachedSnapshotTime: Date | null = null;
let cachedAlertIds: ReadonlySet<string> = new Set();
let cacheLoaded = false;
let cacheController: AbortController | null = null;
let cachedAlerts: DisasterAlert[] = [];
let cachedIsLoading = true;
let isFetching = false;
let lastCheckedTime: Date | null = null;
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;
let cachedLoadingSources: string[] = [];
let cachedFeedHealth: FeedHealth = {};
const listeners = new Set<() => void>();
const historyWrites = new Set<AbortController>();

const notifyListeners = () => listeners.forEach((listener) => listener());

function publish(now = Date.now()) {
  const current = new Map<string, DisasterAlert>();
  const cachedIds = new Set<string>();
  const cacheTimes: string[] = [];
  for (const [feed, records] of recordsByFeed) {
    let hasUsable = false;
    for (const record of records) {
      const alert = toLegacyDisasterAlert(record);
      if (isCurrentlyUsable(alert, now)) {
        current.set(alert.id, alert);
        hasUsable = true;
        if (cachedFeeds.has(feed)) cachedIds.add(alert.id);
        else cachedIds.delete(alert.id);
      }
    }
    if (hasUsable && cachedFeeds.has(feed)) cacheTimes.push(cachedFeeds.get(feed)!);
  }
  cachedAlertIds = cachedIds;
  cachedSnapshotTime = cacheTimes.length ? new Date(cacheTimes.sort()[0]) : null;
  cachedAlerts = Array.from(current.values());
  notifyListeners();
}

async function hydrateCache(controller: AbortController) {
  try {
    const snapshots = await loadAlertSnapshots(controller.signal);
    if (controller.signal.aborted || !listeners.size) return;
    cacheLoaded = true;
    for (const [feed, checkedAt] of applyAlertSnapshots(recordsByFeed, snapshots, successfulFeeds, knownFeeds)) {
      cachedFeeds.set(feed, checkedAt);
    }
    if (cachedFeeds.size) cachedIsLoading = false;
    publish();
  } catch {
    if (!controller.signal.aborted) console.warn('Cache peringatan tidak tersedia; mengambil data langsung.');
  } finally {
    if (cacheController === controller) cacheController = null;
  }
}

function withDeadline<T>(promise: Promise<T>, name: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${name} request timed out`)), REQUEST_DEADLINE_MS);
    promise.then(resolve, reject).finally(() => clearTimeout(timeout));
  });
}

async function fetchAllSources() {
  if (isFetching) return;
  isFetching = true;
  // Regional raster statistics publish independently, so live feeds need not wait
  // for 48 area calculations. Successful areas are cached for six hours.
  void KarhutlaRegionalService.refresh(KPWBI_OFFICES).catch(error => console.error('Statistik Karhutla gagal:', error));
  cachedLoadingSources = feeds.map((feed) => feed.name);
  notifyListeners();

  const checkedAt = new Date().toISOString();
  const results = await Promise.allSettled(
    feeds.map((feed) => withDeadline(feed.fetch(), feed.name))
  );

  results.forEach((result, index) => {
    const feed = feeds[index];
    if (!feed) return;
    if (result.status === 'fulfilled') {
      // A successful empty response clears this feed. Invalid or expired records
      // never enter the current-record repository.
      const accepted: DisasterRecord[] = [];
      const history: DisasterRecord[] = [];
      for (const record of result.value) {
        try {
          const normalized = normalizeAdapterAlert(record, feed.id, checkedAt);
          history.push(normalized);
          if (isCurrentlyUsable(toLegacyDisasterAlert(normalized))) accepted.push(normalized);
        } catch (error) {
          console.warn(`Rejected invalid record from ${feed.name}:`, error);
        }
      }
      recordsByFeed.set(feed.id, accepted);
      successfulFeeds.add(feed.id);
      cachedFeeds.delete(feed.id);
      if (listeners.size > 0) {
        const controller = new AbortController();
        historyWrites.add(controller);
        // Wait for both writes so closing the dashboard can cancel either one.
        void Promise.allSettled([
          persistAlertHistory(history, controller.signal),
          persistAlertSnapshot({ feed: feed.id, checkedAt, records: accepted }, controller.signal),
        ]).then(results => {
          if (!controller.signal.aborted && results.some(result => result.status === 'rejected')) {
            console.warn('Riwayat atau cache peringatan gagal disimpan; pemantauan langsung tetap berjalan.');
          }
        })
          .finally(() => historyWrites.delete(controller));
      }
      cachedFeedHealth = { ...cachedFeedHealth, [feed.id]: { status: 'available', checkedAt } };
    } else {
      if (feed.id === 'forecast') failForecastSnapshot();
      console.error(`Failed to fetch ${feed.name}:`, result.reason);
      const retained = (recordsByFeed.get(feed.id) || []).filter((record) => isCurrentlyUsable(toLegacyDisasterAlert(record)));
      recordsByFeed.set(feed.id, retained);
      cachedFeedHealth = { ...cachedFeedHealth, [feed.id]: { status: 'unavailable', checkedAt } };
    }
    publish();
  });

  cachedLoadingSources = [];
  cachedIsLoading = false;
  isFetching = false;
  lastCheckedTime = new Date();
  publish();
}

const startGlobalPolling = () => {
  if (pollingIntervalId) return;
  publish();
  if (!cacheLoaded && !cacheController) {
    cacheController = new AbortController();
    void hydrateCache(cacheController);
  }
  void fetchAllSources();
  pollingIntervalId = setInterval(() => void fetchAllSources(), POLL_INTERVAL_MS);
};

const stopGlobalPolling = () => {
  cacheController?.abort();
  cacheController = null;
  historyWrites.forEach(controller => controller.abort());
  historyWrites.clear();
  if (!pollingIntervalId) return;
  clearInterval(pollingIntervalId);
  pollingIntervalId = null;
};

export const useAlerts = () => {
  const [alerts, setAlerts] = useState<DisasterAlert[]>(cachedAlerts);
  const [isLoading, setIsLoading] = useState(cachedIsLoading);
  const [fetching, setFetching] = useState(isFetching);
  const [lastChecked, setLastChecked] = useState<Date | null>(lastCheckedTime);
  const [loadingSources, setLoadingSources] = useState<string[]>(cachedLoadingSources);
  const [feedHealth, setFeedHealth] = useState<FeedHealth>(cachedFeedHealth);
  const [snapshotTime, setSnapshotTime] = useState<Date | null>(cachedSnapshotTime);
  const [cachedIds, setCachedIds] = useState<ReadonlySet<string>>(cachedAlertIds);

  useEffect(() => {
    const handleUpdate = () => {
      setAlerts(cachedAlerts);
      setIsLoading(cachedIsLoading);
      setFetching(isFetching);
      setLastChecked(lastCheckedTime);
      setLoadingSources(cachedLoadingSources);
      setFeedHealth(cachedFeedHealth);
      setSnapshotTime(cachedSnapshotTime);
      setCachedIds(cachedAlertIds);
    };
    listeners.add(handleUpdate);
    handleUpdate();
    if (listeners.size === 1) startGlobalPolling();
    return () => {
      listeners.delete(handleUpdate);
      if (listeners.size === 0) stopGlobalPolling();
    };
  }, []);

  const stats = useMemo(
    () => alerts.reduce(
      (acc, alert) => { acc[alert.severity]++; acc.total++; return acc; },
      { 3: 0, 2: 0, 1: 0, total: 0 } as Record<AlertSeverity | 'total', number>
    ),
    [alerts]
  );

  return {
    alerts,
    stats,
    isLoading,
    isFetching: fetching,
    loadingSources,
    feedHealth,
    lastCheckedTime: lastChecked,
    cachedSnapshotTime: snapshotTime,
    cachedAlertIds: cachedIds,
    criticalAlerts: useMemo(() => alerts.filter((a) => a.severity === 3), [alerts]),
    warningAlerts: useMemo(() => alerts.filter((a) => a.severity === 2), [alerts]),
    watchAlerts: useMemo(() => alerts.filter((a) => a.severity === 1), [alerts]),
    getAlertsByProvince: (provinceId: string) => alerts.filter((a) => a.provinceId === provinceId),
    getActiveAlertForProvince: (provinceId: string): DisasterAlert | undefined => {
      const list = alerts.filter((a) => a.provinceId === provinceId);
      return list.reduce<DisasterAlert | undefined>((highest, current) =>
        !highest || current.severity > highest.severity ? current : highest, undefined);
    },
  };
};
