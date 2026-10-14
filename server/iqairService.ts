import { JAKARTA, observationFreshness, usAqiCategory, type IqairDirectory, type IqairLocation, type IqairReading, type IqairResult, type Measurement } from '../src/domain/iqair.ts';
import { discoverCityLinks, discoverLocations, extractReading, isVerificationPage, timestamp, validateIqairUrl } from './iqairExtractor.ts';
import type { IqairStore } from './iqairStore.ts';

const COUNTRY = 'https://www.iqair.com/id/air-quality/indonesia';
const HOUR = 3600_000;
type Fetch = typeof fetch;
export function createIqairService(store: IqairStore, options: { fetch?: Fetch; key?: string; now?: () => number } = {}) {
  const request = options.fetch || fetch; const now = options.now || Date.now;
  const pending = new Map<string, Promise<unknown>>();
  function dedupe<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (pending.has(key)) return pending.get(key) as Promise<T>;
    const promise = operation().finally(() => pending.delete(key)); pending.set(key, promise); return promise;
  }
  async function website(input: string): Promise<string> {
    let url = validateIqairUrl(input);
    const signal = AbortSignal.timeout(10_000);
    for (let hops = 0; hops < 4; hops++) {
      await store.reserve('website', now());
      const response = await request(url, { redirect: 'manual', signal, headers: { Accept: 'text/html' } });
      if (response.status === 403 || response.status === 429) {
        const retry = response.headers.get('retry-after');
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - now()) : 0;
        await store.pause(now() + Math.max(30 * 60_000, Number.isFinite(delay) ? delay : 0));
        await response.body?.cancel(); throw new Error(`Website IQAir diblokir (${response.status}).`);
      }
      if (response.status >= 300 && response.status < 400) {
        const target = response.headers.get('location'); await response.body?.cancel();
        if (!target) throw new Error('Redirect IQAir tidak valid.');
        const next = validateIqairUrl(new URL(target, url).href);
        if (next.pathname !== url.pathname) throw new Error('Redirect mengubah identitas lokasi.');
        url = next; continue;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) { await response.body?.cancel(); throw new Error('Dokumen IQAir tidak valid.'); }
      // Limit decompressed data, including responses without Content-Length.
      const reader = response.body?.getReader(); if (!reader) throw new Error('Halaman IQAir kosong.');
      let size = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4_000_000) { await reader.cancel(); throw new Error('Halaman IQAir terlalu besar.'); } chunks.push(value); } }
      finally { reader.releaseLock(); }
      const html = Buffer.concat(chunks).toString('utf8');
      if (isVerificationPage(html)) { await store.pause(now() + 30 * 60_000); throw new Error('Website IQAir meminta verifikasi browser.'); }
      return html;
    }
    throw new Error('Terlalu banyak redirect IQAir.');
  }
  async function api(endpoint: 'states' | 'cities' | 'city', params: Record<string, string>): Promise<unknown> {
    if (!options.key) throw new Error('Backup API belum dikonfigurasi.');
    await store.reserve('api', now());
    const url = new URL(`https://api.airvisual.com/v2/${endpoint}`);
    url.search = new URLSearchParams({ ...params, country: 'Indonesia', key: options.key }).toString();
    const response = await request(url, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
    if (!response.ok) throw new Error('API IQAir tidak tersedia.');
    const body = await response.json() as { status?: string; data?: unknown };
    if (body.status !== 'success') throw new Error('API IQAir tidak mengembalikan data.');
    return body.data;
  }
  function apiDirectory(state?: string): Promise<IqairLocation[]> {
    return dedupe('api-directory:' + (state || 'states'), () => apiDirectoryOperation(state));
  }
  async function apiDirectoryOperation(state?: string): Promise<IqairLocation[]> {
    const key = 'directory:api:' + (state || 'states'); const cached = await store.read<IqairLocation[]>(key);
    if (cached && now() - cached.at < 24 * HOUR) return cached.value;
    const data = await api(state ? 'cities' : 'states', state ? { state } : {});
    if (!Array.isArray(data)) throw new Error('Direktori API tidak valid.');
    const items = data.flatMap((item: { state?: unknown; city?: unknown }) => {
      const label = state ? item.city : item.state;
      if (typeof label !== 'string' || !label || label.length > 100) return [];
      return [{ id: `api:${state || label}${state ? '/' + label : ''}`, province: state || label, apiState: state || label, ...(state ? { city: label, apiCity: label } : {}) }];
    });
    await store.write(key, items, now()); await store.saveLocations(items); return items;
  }
  async function directory(provinceId?: string): Promise<IqairDirectory> {
    return dedupe('directory:' + (provinceId || 'states'), async () => {
      await store.saveLocations([JAKARTA, { id: 'web:jakarta', province: 'Jakarta', websiteUrl: COUNTRY + '/jakarta' }]);
      const known = await store.locations();
      const province = provinceId ? known.find(item => item.id === provinceId && !item.city) : undefined;
      if (provinceId && !province) throw new Error('Provinsi tidak ditemukan.');
      let message: string | undefined;
      const url = province?.websiteUrl || (!province ? COUNTRY : undefined);
      if (url) {
        const key = 'directory:web:' + url; const cached = await store.read<IqairLocation[]>(key);
        if (!cached || now() - cached.at >= 24 * HOUR) {
          try {
            const items = discoverLocations(await website(url), url);
            if (!items.length) throw new Error('Tautan direktori IQAir tidak ditemukan.');
            if (province) items.forEach(item => { item.province = province.province; });
            await store.write(key, items, now()); await store.saveLocations(items);
          } catch (error) { message = error instanceof Error ? error.message : 'Direktori website tidak tersedia.'; }
        }
      }
      if ((!url || message) && options.key) {
        try {
          if (province) {
            const states = await apiDirectory(); const exact = states.find(item => item.province === province.province);
            if (!exact) throw new Error('Nama provinsi tidak cocok dengan direktori API.');
            await apiDirectory(exact.apiState);
          } else await apiDirectory();
        } catch (error) { message = error instanceof Error ? error.message : 'Direktori API tidak tersedia.'; }
      } else if (message && !options.key) message += ' Backup API belum dikonfigurasi; lokasi tersimpan tetap tersedia.';
      const all = await store.locations();
      return { locations: all.filter(item => province ? item.city && item.province === province.province : !item.city), message };
    });
  }
  async function apiReading(location: IqairLocation): Promise<IqairReading> {
    let state = location.apiState; let city = location.apiCity;
    // Resolve both names against API directories. Never substitute a nearby city.
    const states = await apiDirectory();
    const exact = states.find(item => item.province === (state || location.province));
    if (!exact?.apiState) throw new Error('Provinsi tidak cocok dengan direktori API.');
    state = exact.apiState;
    const cities = await apiDirectory(state);
    city = cities.find(item => item.city === (city || location.city))?.apiCity;
    if (!city) throw new Error('Kota tidak cocok dengan direktori API.');
    const raw = await api('city', { state, city });
    return parseApiReading(raw, location, state, city, now());
  }
  async function allCities(): Promise<IqairDirectory> {
    return dedupe('all-cities', async () => {
      await store.saveLocations([JAKARTA, { id: 'web:jakarta', province: 'Jakarta', websiteUrl: COUNTRY + '/jakarta' }]);
      const pages = async () => {
        const known = await store.locations();
        const urls = [...new Set([COUNTRY, ...known.filter(item => !item.city && item.websiteUrl).map(item => item.websiteUrl!)])];
        return Promise.all(urls.map(async url => ({ url, cached: await store.read<IqairLocation[]>('directory:web:' + url), failure: await store.read<{ message: string; retryAt: number }>('crawl-error:' + url) })));
      };
      let state = await pages();
      const stale = (page: typeof state[number]) => !page.cached || now() - page.cached.at >= 24 * HOUR;
      const target = state.find(page => stale(page) && (!page.failure || page.failure.value.retryAt <= now()));
      const available = await store.websiteAvailability();
      let message: string | undefined;
      // One directory page per call. Active clients advance the crawl every 15s.
      // Reservations remain authoritative across clients and server restarts.
      if (target && Math.max(available.pausedUntil, available.nextAttemptAt) <= now()) {
        try {
          const html = await website(target.url);
          const known = await store.locations();
          const discovered = [...discoverLocations(html, target.url), ...discoverCityLinks(html, target.url)];
          if (!discovered.length) throw new Error('Tautan lokasi tidak ditemukan pada halaman direktori IQAir.');
          const parent = known.find(item => !item.city && item.websiteUrl === target.url);
          for (const item of discovered) {
            if (item.city) item.province = parent?.province || discovered.find(p => !p.city && p.id === item.id.slice(0, item.id.lastIndexOf('/')))?.province || known.find(p => !p.city && p.id === item.id.slice(0, item.id.lastIndexOf('/')))?.province || item.province;
          }
          // Country rankings can link cities before their province links appear.
          const parents = discovered.filter(item => item.city).map(item => ({ id: item.id.slice(0, item.id.lastIndexOf('/')), province: item.province, websiteUrl: item.websiteUrl!.slice(0, item.websiteUrl!.lastIndexOf('/')) }));
          await store.saveLocations([...parents, ...discovered]);
          await store.write('directory:web:' + target.url, discovered, now());
        } catch (error) {
          message = error instanceof Error ? error.message : 'Direktori website tidak tersedia.';
          await store.write('crawl-error:' + target.url, { message, retryAt: now() + 30 * 60_000 }, now());
        }
        state = await pages();
      }
      const remaining = state.filter(stale);
      const limits = await store.websiteAvailability();
      const nextPageAt = remaining.length ? Math.min(...remaining.map(page => page.failure && page.failure.value.retryAt > now() ? page.failure.value.retryAt : now())) : now();
      const retryAt = Math.max(limits.pausedUntil, limits.nextAttemptAt, nextPageAt);
      const status = !remaining.length ? 'complete' : limits.pausedUntil > now() || nextPageAt > now() ? 'paused' : 'pending';
      if (!message && status === 'paused') message = limits.pausedUntil > now() ? 'Pengumpulan direktori dijeda oleh IQAir. Kota yang sudah ditemukan tetap tersedia.' : remaining.find(page => page.failure)?.failure?.value.message;
      const known = await store.locations();
      return {
        locations: known.filter(item => !!item.city).sort((a, b) => (a.city || '').localeCompare(b.city || '', 'id') || a.province.localeCompare(b.province, 'id')),
        provinces: known.filter(item => !item.city).sort((a, b) => a.province.localeCompare(b.province, 'id')),
        crawl: { status, completedPages: state.length - remaining.length, totalPages: state.length, ...(remaining.length ? { retryAt: new Date(retryAt).toISOString() } : {}) },
        message,
      };
    });
  }
  async function observe(location: IqairLocation): Promise<IqairResult> {
    return dedupe('reading:' + location.id, async () => {
      const cached = (await Promise.all(['website', 'api'].map(method => store.read<IqairReading>(`reading:${location.id}:${method}`))))
        .filter((item): item is { at: number; value: IqairReading } => !!item).sort((a, b) => b.at - a.at);
      const fresh = cached.find(item => now() - item.at < HOUR && observationFreshness(item.value, now()) !== 'outdated');
      if (fresh) return { reading: fresh.value, delivery: 'cache', freshness: observationFreshness(fresh.value, now()) };
      const errors: string[] = [];
      if (location.websiteUrl) {
        try {
          const reading = extractReading(await website(location.websiteUrl), location, now());
          await store.write(`reading:${location.id}:website`, reading, now());
          if (observationFreshness(reading, now()) !== 'outdated') return { reading, delivery: 'live', freshness: observationFreshness(reading, now()) };
          cached.unshift({ at: now(), value: reading }); errors.push('Observasi website lebih lama dari dua jam.');
        } catch (error) { errors.push(error instanceof Error ? error.message : 'Website tidak tersedia.'); }
      }
      if (options.key) {
        try {
          const reading = await apiReading(location);
          await store.write(`reading:${location.id}:api`, reading, now());
          return { reading, delivery: 'live', freshness: observationFreshness(reading, now()), message: errors.join(' ') || undefined };
        } catch (error) { errors.push(error instanceof Error ? error.message : 'Backup API tidak tersedia.'); }
      } else errors.push('Backup API belum dikonfigurasi.');
      const last = cached[0]?.value;
      return { reading: last, delivery: last ? 'cache' : 'unavailable', freshness: last ? 'outdated' : 'unknown', message: errors.join(' ') };
    });
  }
  return {
    directory,
    allCities,
    async observation(id: string) {
      const location = (await store.locations()).find(item => item.id === id) || (id === JAKARTA.id ? JAKARTA : undefined);
      if (!location?.city) throw new Error('Kota tidak ditemukan.');
      return observe(location);
    },
    async addCity(input: string) {
      const url = validateIqairUrl(input, 5); const parts = url.pathname.split('/');
      // A validated URL can be saved during a website outage. The reading still requires city validation.
      const location: IqairLocation = { id: 'web:' + parts.slice(4).join('/'), province: parts[4].replaceAll('-', ' '), city: parts[5].replaceAll('-', ' '), websiteUrl: url.href };
      const locations = await store.locations();
      const known = locations.find(item => item.websiteUrl === url.href);
      if (known) return known;
      location.province = locations.find(item => item.id === 'web:' + parts[4] && !item.city)?.province || location.province;
      await store.saveLocations([location, { id: 'web:' + parts[4], province: location.province, websiteUrl: COUNTRY + '/' + parts[4] }]);
      return location;
    },
  };
}
export function parseApiReading(raw: unknown, location: IqairLocation, state: string, city: string, now: number): IqairReading {
  const data = raw as { city?: string; state?: string; country?: string; location?: { coordinates?: unknown }; current?: { pollution?: Record<string, unknown>; weather?: Record<string, unknown> } };
  if (!data || data.city !== city || data.state !== state || data.country !== 'Indonesia') throw new Error('Identitas kota API tidak sesuai.');
  const pollution = data.current?.pollution; const value = pollution?.aqius;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) throw new Error('Nilai AQI API tidak valid.');
  const weather: Record<string, Measurement | string> = {};
  const weatherRaw = data.current?.weather;
  for (const [field, key, unit, min, max] of [['tp', 'temperature', '°C', -90, 65], ['hu', 'humidity', '%', 0, 100], ['pr', 'pressure', 'hPa', 0, 1200], ['ws', 'wind', 'm/s', 0, 150], ['wd', 'windDirection', '°', 0, 360], ['tf', 'feltTemperature', '°C', -100, 100]] as const) {
    const amount = weatherRaw?.[field]; if (typeof amount === 'number' && Number.isFinite(amount) && amount >= min && amount <= max) weather[key] = { value: amount, unit };
  }
  if (typeof weatherRaw?.ic === 'string' && /^[0-9]{2}[dn]$/.test(weatherRaw.ic)) weather.condition = weatherRaw.ic;
  const geo = data.location?.coordinates;
  const coordinates: [number, number] | undefined = Array.isArray(geo) && geo.length === 2 && geo.every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(geo[0]) <= 180 && Math.abs(geo[1]) <= 90 ? [geo[0], geo[1]] : undefined;
  return { location, sourceMethod: 'api', sourceUrl: 'https://api.airvisual.com/v2/city', retrievedAt: new Date(now).toISOString(), observedAt: timestamp(pollution?.ts, now), weatherObservedAt: timestamp(weatherRaw?.ts, now), coordinates,
    index: { value, scale: 'US AQI', category: usAqiCategory(value), dominantPollutant: typeof pollution?.mainus === 'string' ? pollution.mainus : undefined },
    ...(typeof pollution?.aqicn === 'number' && Number.isFinite(pollution.aqicn) && pollution.aqicn >= 0 && pollution.aqicn <= 1000 ? { chinaIndex: { value: pollution.aqicn, dominantPollutant: typeof pollution.maincn === 'string' ? pollution.maincn : undefined } } : {}),
    ...(Object.keys(weather).length ? { weather } : {}) };
}
export type IqairService = ReturnType<typeof createIqairService>;
