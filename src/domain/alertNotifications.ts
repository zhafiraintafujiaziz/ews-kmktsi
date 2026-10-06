import type { DisasterAlert } from '../types';

export const KNOWN_ALERTS_STORAGE_KEY = 'ews_known_alert_fingerprints_v1';

type NotificationStorage = Pick<Storage, 'getItem' | 'setItem'>;

function normalizedTime(value?: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value.trim();
}

export function alertFingerprint(alert: DisasterAlert): string {
  // SIPONGI timestamps describe a moving request window, and IDs include a sort index.
  if (alert.type === 'karhutla' && alert.id.startsWith('sipongi-karhutla-')) {
    return JSON.stringify([
      'v1', alert.type, alert.provinceId,
      (alert.affectedArea ?? alert.title).trim().replace(/\s+/g, ' ').toLowerCase(),
      alert.severity, alert.hotspotCount ?? null,
    ]);
  }
  return JSON.stringify([
    'v1', alert.type, alert.id, normalizedTime(alert.timestamp),
    normalizedTime(alert.validFrom), normalizedTime(alert.validUntil), alert.severity,
  ]);
}

export function createAlertNotificationStore(
  getStorage: () => NotificationStorage | null = () => typeof window === 'undefined' ? null : window.localStorage,
) {
  const known = new Set<string>();
  const sounded = new Set<string>();
  const listeners = new Set<() => void>();
  let revision = 0;

  try {
    const raw = getStorage()?.getItem(KNOWN_ALERTS_STORAGE_KEY);
    if (raw) {
      const data: unknown = JSON.parse(raw);
      if (Array.isArray(data) && data.every(value => typeof value === 'string')) {
        data.forEach(value => known.add(value));
      }
    }
  } catch {
    // Keep notifications usable when storage is blocked or contains invalid JSON.
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => revision,
    isKnown: (alert: DisasterAlert) => known.has(alertFingerprint(alert)),
    markKnown(alert: DisasterAlert) {
      const fingerprint = alertFingerprint(alert);
      if (known.has(fingerprint)) return;
      known.add(fingerprint);
      try {
        getStorage()?.setItem(KNOWN_ALERTS_STORAGE_KEY, JSON.stringify([...known]));
      } catch {
        // The in-memory record still survives screen navigation.
      }
      revision++;
      listeners.forEach(listener => listener());
    },
    claimSound(alert: DisasterAlert) {
      const fingerprint = alertFingerprint(alert);
      if (known.has(fingerprint) || sounded.has(fingerprint)) return false;
      sounded.add(fingerprint);
      return true;
    },
  };
}

export const alertNotifications = createAlertNotificationStore();

/** Select one pending alert by source time, regardless of severity or feed order. */
export function latestUnknownAlert(
  alerts: readonly DisasterAlert[],
  store: Pick<ReturnType<typeof createAlertNotificationStore>, 'isKnown'>,
): DisasterAlert | null {
  let latest: DisasterAlert | null = null;
  for (const alert of alerts) {
    if (store.isKnown(alert)) continue;
    const timestamp = Date.parse(alert.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    if (!latest || timestamp > Date.parse(latest.timestamp)
      || (timestamp === Date.parse(latest.timestamp) && alert.id.localeCompare(latest.id) < 0)) {
      latest = alert;
    }
  }
  return latest;
}
