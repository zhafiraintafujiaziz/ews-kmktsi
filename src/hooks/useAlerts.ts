import { useState, useMemo, useEffect } from 'react';
import type { DisasterAlert, AlertSeverity } from '../types';
import { fetchLatestEarthquakes, fetchExtremeWeather, fetchThreeDayForecast, fetchHighRainfallWarning, fetchEarlyWarning } from '../services/bmkgService';
import { MagmaService } from '../services/magmaService';
import { SipongiService } from '../services/sipongiService';
import { InaSiamService } from '../services/inaSiamService';
import { IspuService } from '../services/ispuService';

// InaRisk / BNPB data is shown in the Kerentanan screen, not as live alerts.
// This hook only aggregates real-time BMKG alert streams.

// Global cache variables to persist data across component mounts
const ALERTS_STORAGE_KEY = 'ews_cached_alerts';

const MONTH_MAP: Record<string, string> = {
  jan: 'Jan',
  feb: 'Feb',
  mar: 'Mar',
  apr: 'Apr',
  mei: 'May',
  jun: 'Jun',
  jul: 'Jul',
  agt: 'Aug',
  sep: 'Sep',
  okt: 'Oct',
  nov: 'Nov',
  des: 'Dec',
};

function getWaktuBerakhir(description: string): Date | null {
  try {
    if (!description.includes('Waktu:')) return null;
    const timePart = description.split('Waktu:')[1];
    const parts = timePart.split('-').map((p) => p.trim());
    if (parts.length < 2) return null;

    const waktuBerakhirStr = parts[1];
    const clean = waktuBerakhirStr.replace('•', ' ').trim();
    const subParts = clean.split(/\s+/);
    if (subParts.length >= 5) {
      let tzOffset = '+0700'; // WIB
      const tz = subParts[4].toUpperCase();
      if (tz === 'WITA') tzOffset = '+0800';
      if (tz === 'WIT') tzOffset = '+0900';

      const indMonth = subParts[1].toLowerCase();
      const engMonth = MONTH_MAP[indMonth] || subParts[1];

      const dateStr = `${subParts[0]} ${engMonth} ${subParts[2]} ${subParts[3].replace('.', ':')}:00 ${tzOffset}`;
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d;
    }
  } catch (e) {
    console.error('Error parsing waktuBerakhir:', e);
  }
  return null;
}

let cachedAlerts: DisasterAlert[] = [];
try {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(ALERTS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DisasterAlert[];
      const now = new Date();
      cachedAlerts = parsed.filter((a) => {
        if (a.title === 'Peringatan Dini Cuaca') {
          const end = getWaktuBerakhir(a.description);
          if (end && now > end) return false;
        }
        return true;
      }).map((a) => {
        if ((a.type === 'volcanic' || a.type === 'volcanic_ash') && (!a.pentagonCoords || a.pentagonCoords.length === 0)) {
          const sig = InaSiamService.getSigmetForVolcano(a.title || a.affectedArea || '');
          if (sig) {
            return {
              ...a,
              pentagonCoords: sig.coordinates,
              ashHeight: a.ashHeight || sig.flightLevel,
              movementDirection: a.movementDirection || sig.directionText,
              windBearing: a.windBearing ?? sig.bearing,
            };
          }
        }
        return a;
      });
      if (cachedAlerts.length !== parsed.length) {
        localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(cachedAlerts));
      }
    }
  }
} catch (e) {
  console.error('Failed to parse cached alerts from localStorage', e);
}

let cachedIsLoading = cachedAlerts.length === 0;
let isFetching = false;
let lastCheckedTime: Date | null = null;
let pollingIntervalId: any = null;
let cachedLoadingSources: string[] = [];
const listeners = new Set<() => void>();

const notifyListeners = () => {
  listeners.forEach((listener) => listener());
};

const mergeAlerts = (existing: DisasterAlert[], incoming: DisasterAlert[]) => {
  const map = new Map(existing.map((a) => [a.id, a]));
  let hasChanges = false;
  
  incoming.forEach((a) => {
    let alertToAdd = a;
    if ((alertToAdd.type === 'volcanic' || alertToAdd.type === 'volcanic_ash') && (!alertToAdd.pentagonCoords || alertToAdd.pentagonCoords.length === 0)) {
      const sig = InaSiamService.getSigmetForVolcano(alertToAdd.title || alertToAdd.affectedArea || '');
      if (sig) {
        alertToAdd = {
          ...alertToAdd,
          pentagonCoords: sig.coordinates,
          ashHeight: alertToAdd.ashHeight || sig.flightLevel,
          movementDirection: alertToAdd.movementDirection || sig.directionText,
          windBearing: alertToAdd.windBearing ?? sig.bearing,
        };
      }
    }

    if (!map.has(alertToAdd.id)) {
      map.set(alertToAdd.id, alertToAdd);
      hasChanges = true;
    } else {
      const existingAlert = map.get(alertToAdd.id)!;
      if (!existingAlert.pentagonCoords && alertToAdd.pentagonCoords) {
        map.set(alertToAdd.id, { ...existingAlert, ...alertToAdd });
        hasChanges = true;
      }
    }
  });
  
  const merged = Array.from(map.values());
  const now = new Date();
  const filtered = merged.filter((a) => {
    if (a.title === 'Peringatan Dini Cuaca') {
      const end = getWaktuBerakhir(a.description);
      if (end && now > end) {
        hasChanges = true;
        return false;
      }
    }
    return true;
  });
  
  if (hasChanges || existing.length === 0) {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(filtered));
      }
    } catch (e) {
      console.error('Failed to save alerts to localStorage', e);
    }
  }
  
  return filtered;
};

const fetchAllSources = async () => {
  if (isFetching) return;
  isFetching = true;

  // Cleanup expired alerts from the in-memory cache and localStorage
  const now = new Date();
  const activeAlerts = cachedAlerts.filter((a) => {
    if (a.title === 'Peringatan Dini Cuaca') {
      const end = getWaktuBerakhir(a.description);
      if (end && now > end) return false;
    }
    return true;
  });

  if (activeAlerts.length !== cachedAlerts.length) {
    cachedAlerts = activeAlerts;
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(cachedAlerts));
      }
    } catch (e) {
      console.error('Failed to save alerts to localStorage', e);
    }
  }

  cachedLoadingSources = ['Gempa BMKG', 'Cuaca Buruk BMKG', 'Peringatan Dini Cuaca BMKG', 'Prakiraan 3 Hari BMKG', 'Curah Hujan Tinggi BMKG', 'Live Gunung Api Magma', 'Sipongi Karhutla', 'Abu Vulkanik INA-SIAM', 'ISPU Kualitas Udara'];
  notifyListeners();

  const apis = [
    { call: fetchLatestEarthquakes, name: 'Gempa BMKG' },
    { call: fetchExtremeWeather, name: 'Cuaca Buruk BMKG' },
    { call: fetchEarlyWarning, name: 'Peringatan Dini Cuaca BMKG' },
    { call: fetchThreeDayForecast, name: 'Prakiraan 3 Hari BMKG' },
    { call: fetchHighRainfallWarning, name: 'Curah Hujan Tinggi BMKG' },
    { call: () => MagmaService.fetchLiveAlerts(false), name: 'Live Gunung Api Magma' },
    { call: () => SipongiService.fetchKarhutlaAlerts(true), name: 'Sipongi Karhutla' },
    { call: () => InaSiamService.fetchLiveAlerts(), name: 'Abu Vulkanik INA-SIAM' },
    { call: () => IspuService.fetchAirQualityAlerts(), name: 'ISPU Kualitas Udara' }
  ];

  let pending = apis.length;

  apis.forEach(({ call, name }) => {
    call()
      .then((data) => {
        if (data && data.length > 0) {
          cachedAlerts = mergeAlerts(cachedAlerts, data);
          notifyListeners();
        }
      })
      .catch((e) => {
        console.error(`Failed to fetch ${name}:`, e);
        if (name === 'Live Gunung Api Magma') {
          MagmaService.fetchLiveAlerts(true)
            .then((data) => {
              if (data && data.length > 0) {
                cachedAlerts = mergeAlerts(cachedAlerts, data);
                notifyListeners();
              }
            })
            .catch((err) => console.error('Fallback fetch for Magma failed:', err));
        }
        if (name === 'Sipongi Karhutla') {
          SipongiService.fetchKarhutlaAlerts(false)
            .then((data) => {
              if (data && data.length > 0) {
                cachedAlerts = mergeAlerts(cachedAlerts, data);
                notifyListeners();
              }
            })
            .catch((err) => console.error('Fallback fetch for Sipongi Karhutla failed:', err));
        }
      })
      .finally(() => {
        cachedLoadingSources = cachedLoadingSources.filter((s) => s !== name);
        pending--;
        if (pending === 0) {
          cachedIsLoading = false;
          isFetching = false;
          lastCheckedTime = new Date();
          notifyListeners();
        }
      });
  });
};

const startGlobalPolling = () => {
  if (pollingIntervalId) return;
  fetchAllSources();
  pollingIntervalId = setInterval(() => {
    fetchAllSources();
  }, 60000); // Poll every 60 seconds
};

const stopGlobalPolling = () => {
  if (pollingIntervalId) {
    clearInterval(pollingIntervalId);
    pollingIntervalId = null;
  }
};

export const useAlerts = () => {
  const [alerts, setAlerts] = useState<DisasterAlert[]>(cachedAlerts);
  const [isLoading, setIsLoading] = useState(cachedIsLoading);
  const [fetching, setFetching] = useState(isFetching);
  const [lastChecked, setLastChecked] = useState<Date | null>(lastCheckedTime);
  const [loadingSources, setLoadingSources] = useState<string[]>(cachedLoadingSources);

  useEffect(() => {
    const handleUpdate = () => {
      setAlerts(cachedAlerts);
      setIsLoading(cachedIsLoading);
      setFetching(isFetching);
      setLastChecked(lastCheckedTime);
      setLoadingSources(cachedLoadingSources);
    };

    listeners.add(handleUpdate);

    if (listeners.size === 1) {
      startGlobalPolling();
    }

    return () => {
      listeners.delete(handleUpdate);
      if (listeners.size === 0) {
        stopGlobalPolling();
      }
    };
  }, []);

  const stats = useMemo(
    () =>
      alerts.reduce(
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
    lastCheckedTime: lastChecked,
    criticalAlerts: useMemo(() => alerts.filter((a) => a.severity === 3), [alerts]),
    warningAlerts: useMemo(() => alerts.filter((a) => a.severity === 2), [alerts]),
    watchAlerts: useMemo(() => alerts.filter((a) => a.severity === 1), [alerts]),
    getAlertsByProvince: (provinceId: string) => alerts.filter((a) => a.provinceId === provinceId),
    getActiveAlertForProvince: (provinceId: string): DisasterAlert | undefined => {
      const list = alerts.filter((a) => a.provinceId === provinceId);
      if (list.length === 0) return undefined;
      return list.reduce((h, c) => (c.severity || 0) > (h.severity || 0) ? c : h);
    },
  };
};