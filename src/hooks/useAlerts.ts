import { useEffect, useMemo, useState } from 'react';
import type { DisasterAlert, AlertSeverity } from '../types';
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
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';

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
  { id: 'ispu', name: 'ISPU Kualitas Udara', fetch: () => IspuService.fetchAirQualityAlerts() },
  { id: 'inarisk', name: 'InaRisk assessments', fetch: async () => {
    await BnpbInariskService.refreshAssessment(KPWBI_OFFICES);
    return [];
  } },
];

const REQUEST_DEADLINE_MS = 15_000;
const POLL_INTERVAL_MS = 60_000;
const recordsByFeed = new Map<string, DisasterRecord[]>();
let cachedAlerts: DisasterAlert[] = [];
let cachedIsLoading = true;
let isFetching = false;
let lastCheckedTime: Date | null = null;
let pollingIntervalId: ReturnType<typeof setInterval> | null = null;
let cachedLoadingSources: string[] = [];
let cachedFeedHealth: FeedHealth = {};
const listeners = new Set<() => void>();

const notifyListeners = () => listeners.forEach((listener) => listener());

function publish(now = Date.now()) {
  const current = new Map<string, DisasterAlert>();
  for (const records of recordsByFeed.values()) {
    for (const record of records) {
      const alert = toLegacyDisasterAlert(record);
      if (isCurrentlyUsable(alert, now)) current.set(alert.id, alert);
    }
  }
  cachedAlerts = Array.from(current.values());
  notifyListeners();
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
      for (const record of result.value) {
        try {
          const normalized = normalizeAdapterAlert(record, feed.id, checkedAt);
          if (isCurrentlyUsable(toLegacyDisasterAlert(normalized))) accepted.push(normalized);
        } catch (error) {
          console.warn(`Rejected invalid record from ${feed.name}:`, error);
        }
      }
      recordsByFeed.set(feed.id, accepted);
      cachedFeedHealth = { ...cachedFeedHealth, [feed.id]: { status: 'available', checkedAt } };
    } else {
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
  void fetchAllSources();
  pollingIntervalId = setInterval(() => void fetchAllSources(), POLL_INTERVAL_MS);
};

const stopGlobalPolling = () => {
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

  useEffect(() => {
    const handleUpdate = () => {
      setAlerts(cachedAlerts);
      setIsLoading(cachedIsLoading);
      setFetching(isFetching);
      setLastChecked(lastCheckedTime);
      setLoadingSources(cachedLoadingSources);
      setFeedHealth(cachedFeedHealth);
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
