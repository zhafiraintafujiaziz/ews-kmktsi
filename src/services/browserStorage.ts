export const BROWSER_PREFIX = 'ews-browser:v1:';
let evictHistoryDay: (() => boolean) | undefined;
export function registerHistoryEvictor(evict: () => boolean) { evictHistoryDay = evict; }
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export function browserStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
export function keys(storage: StorageLike, prefix: string): string[] {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key && key.startsWith(prefix));
}
export function readStored<T>(key: string, fallback: T, storage = browserStorage()): T {
  try { const value = storage?.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export function writeStored(key: string, value: unknown, disposable = false, storage = browserStorage()): boolean {
  if (!storage) { if (disposable) return false; throw new Error('Penyimpanan browser tidak tersedia. Ekspor data sebelum menutup halaman.'); }
  const json = JSON.stringify(value);
  try {
    if (disposable && key.startsWith(BROWSER_PREFIX + 'cache:')) {
      const cacheKeys = keys(storage, BROWSER_PREFIX + 'cache:').filter(item => item !== key);
      let bytes = (key.length + json.length) * 2 + cacheKeys.reduce((sum, item) => sum + (item.length + (storage.getItem(item)?.length ?? 0)) * 2, 0);
      for (const item of cacheKeys) { if (bytes <= 1024 * 1024) break; bytes -= (item.length + (storage.getItem(item)?.length ?? 0)) * 2; storage.removeItem(item); }
      if (bytes > 1024 * 1024) return false;
    }
    storage.setItem(key, json); return true;
  } catch {
    // Only replaceable network caches may be removed to make room for user data.
    if (!disposable) {
      for (const item of keys(storage, BROWSER_PREFIX + 'cache:')) storage.removeItem(item);
      try { storage.setItem(key, json); return true; } catch { /* Preserve the previous saved value. */ }
      while (evictHistoryDay?.()) {
        try { storage.setItem(key, json); return true; } catch { /* Try the next oldest archive day. */ }
      }
      throw new Error('Penyimpanan browser penuh. Ekspor cadangan sebelum menghapus riwayat. Isian belum tersimpan.');
    }
    return false;
  }
}
