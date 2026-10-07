import { useState, useCallback, useEffect, useRef } from 'react';
import type { ChecklistStatus } from '../constants/preparednessChecklist';
import { loadChecklist, saveChecklist } from '../services/persistenceService';

export function usePreparednessChecklist() {
  const [data, setData] = useState<Record<string, ChecklistStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const saving = useRef(false);
  const mounted = useRef(false);

  const fetchData = useCallback(async () => {
    try {
      const items = await loadChecklist();
      const loaded: Record<string, ChecklistStatus> = {};
      for (const item of items) {
        loaded[item.officeId] ??= {};
        loaded[item.officeId][item.itemId] = item.checked;
      }
      if (mounted.current) setData(loaded);
    } catch {
      if (mounted.current) setError('Checklist gagal dimuat. Data browser lama tetap tersimpan.');
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setSaveMessage('');
    await fetchData();
  }, [fetchData]);

  useEffect(() => {
    mounted.current = true;
    // Apply database results asynchronously after mounting.
    void Promise.resolve().then(fetchData);
    return () => { mounted.current = false; };
  }, [fetchData]);

  const getStatus = useCallback(
    (officeId: string): ChecklistStatus => data[officeId] ?? {},
    [data]
  );

  const toggleItem = useCallback(async (officeId: string, itemId: string) => {
    if (isLoading || saving.current || !officeId) return;
    saving.current = true;
    setIsSaving(true);
    setError('');
    setSaveMessage('');
    try {
      const item = await saveChecklist({ officeId, itemId, checked: !data[officeId]?.[itemId] });
      setData(prev => ({ ...prev, [officeId]: { ...prev[officeId], [itemId]: item.checked } }));
      setSaveMessage('Checklist tersimpan.');
    } catch {
      setError('Checklist gagal disimpan. Silakan coba lagi.');
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }, [data, isLoading]);

  const getCompletionCount = useCallback(
    (officeId: string, items: string[]) => {
      const status = data[officeId] ?? {};
      return items.filter((id) => status[id]).length;
    },
    [data]
  );

  return { getStatus, toggleItem, getCompletionCount, isLoading, isSaving, error, saveMessage, reload };
}
