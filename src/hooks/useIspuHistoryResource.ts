import { useEffect, useState } from 'react';
import { requestIspuHistory } from '../services/ispuHistoryClient';
import { usesBrowserStorage } from '../domain/dataMode.ts';

export function useIspuHistoryResource<T>(active: boolean, params: Record<string, string> | null, revision: number) {
  const [storageRevision, setStorageRevision] = useState(0);
  useEffect(() => {
    if (!active || !usesBrowserStorage()) return;
    const changed = () => setStorageRevision(value => value + 1);
    const stored = (event: StorageEvent) => { if (event.key === 'ews-browser:v1:ispu-history') changed(); };
    window.addEventListener('ews-history-change', changed); window.addEventListener('storage', stored);
    return () => { window.removeEventListener('ews-history-change', changed); window.removeEventListener('storage', stored); };
  }, [active]);
  const key = params ? JSON.stringify(params) + ':' + revision + ':' + storageRevision : '';
  const query = params ? JSON.stringify(params) : '';
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  useEffect(() => {
    if (!active || !key) return;
    const controller = new AbortController();
    void requestIspuHistory<T>(JSON.parse(query), controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data });
    }, error => {
      if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : 'Riwayat tidak tersedia.' });
    });
    return () => controller.abort();
  }, [active, key, query]);
  return { data: state.key === key ? state.data : undefined, error: state.key === key ? state.error : undefined,
    loading: active && !!key && state.key !== key };
}
