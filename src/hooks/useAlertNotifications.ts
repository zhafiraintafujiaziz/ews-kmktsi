import { useSyncExternalStore } from 'react';
import { alertNotifications } from '../domain/alertNotifications';

export function useAlertNotifications() {
  return useSyncExternalStore(alertNotifications.subscribe, alertNotifications.getSnapshot, alertNotifications.getSnapshot);
}
