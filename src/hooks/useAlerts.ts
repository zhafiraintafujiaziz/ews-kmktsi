import { useMemo, useSyncExternalStore } from 'react';
import type { AlertSeverity, DisasterAlert } from '../types';
import { createAlertStore, type AlertFeed, type AlertStoreSnapshot } from '../domain/alertStore';
import { failForecastSnapshot } from '../services/weatherForecastAssessment';
import { fetchLatestEarthquakes, fetchExtremeWeather, fetchThreeDayForecast, fetchEarlyWarning } from '../services/bmkgService';
import { MagmaService } from '../services/magmaService';
import { SipongiService } from '../services/sipongiService';
import { InaSiamService } from '../services/inaSiamService';
import { IspuService } from '../services/ispuService';
import { refreshBackgroundAssessments } from '../services/assessmentSync';
import { logSyncFailure } from '../services/syncDiagnostics';
import { loadAlertSnapshots, persistAlertHistory, persistAlertSnapshot } from '../services/persistenceService';
import { usesBrowserStorage } from '../domain/dataMode.ts';
import { FEED_SECONDS, type FeedId } from '../domain/feedPolicy.ts';
import { peekFeed } from '../services/feedClient.ts';

export type { FeedHealth } from '../domain/alertStore';

const feeds: AlertFeed[] = [
  { id: 'earthquakes', name: 'Gempa BMKG', fetch: fetchLatestEarthquakes },
  { id: 'extreme-weather', name: 'Cuaca Buruk BMKG', fetch: fetchExtremeWeather },
  { id: 'early-warning', name: 'Peringatan Dini Cuaca BMKG', fetch: fetchEarlyWarning },
  { id: 'forecast', name: 'Prakiraan 3 Hari BMKG', fetch: fetchThreeDayForecast },
  { id: 'magma', name: 'Live Gunung Api Magma', fetch: () => MagmaService.fetchLiveAlerts() },
  { id: 'sipongi', name: 'Sipongi Karhutla', fetch: () => SipongiService.fetchKarhutlaAlerts() },
  { id: 'inasiam', name: 'Abu Vulkanik INA-SIAM', fetch: () => InaSiamService.fetchLiveAlerts() },
  { id: 'ispu', name: 'Kualitas Udara ISPU', fetch: () => IspuService.fetchAirQualityAlerts() },
];


const alertStore = createAlertStore({
  pollIntervalMs: 30_000,
  assessmentIntervalMs: 86400_000,
  canRefresh: () => typeof document === 'undefined' || document.visibilityState !== 'hidden' && navigator.onLine,
  feeds: feeds.map(feed => ({ ...feed, intervalMs: FEED_SECONDS[feed.id as FeedId] * 1000,
    freshness: () => usesBrowserStorage() ? peekFeed(feed.id as FeedId) : undefined })),
  loadSnapshots: loadAlertSnapshots,
  refreshAssessments: () => refreshBackgroundAssessments(true),
  async persist(snapshot, history, signal) {
    if (usesBrowserStorage()) { await persistAlertSnapshot(snapshot, signal); return; }
    const results = await Promise.allSettled([
      persistAlertHistory(history, signal),
      persistAlertSnapshot(snapshot, signal),
    ]);
    if (results.some(result => result.status === 'rejected')) throw new Error('Alert persistence failed');
  },
  onFeedError(feed, error) {
    if (feed.id === 'forecast') failForecastSnapshot();
    logSyncFailure({ source: feed.name, category: feed.id }, error);
  },
});

if (typeof window !== 'undefined') {
  const refresh = () => { if (alertStore.hasSubscribers() && document.visibilityState !== 'hidden' && navigator.onLine) void alertStore.refresh(); };
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('storage', event => { if (event.key?.startsWith('ews-browser:v1:cache:')) refresh(); });
}

export function useAlertField<K extends keyof AlertStoreSnapshot>(key: K): AlertStoreSnapshot[K] {
  const getSnapshot = () => alertStore.getSnapshot()[key];
  return useSyncExternalStore(alertStore.subscribe, getSnapshot, getSnapshot);
}

export const useAlerts = () => {
  const { alerts, isLoading, isFetching: fetching, lastCheckedTime: lastChecked, loadingSources,
    feedHealth, cachedSnapshotTime: snapshotTime, cachedAlertIds: cachedIds } = useSyncExternalStore(
      alertStore.subscribe, alertStore.getSnapshot, alertStore.getSnapshot,
    );
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
