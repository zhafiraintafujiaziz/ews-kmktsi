import { load } from 'cheerio';
import type { IqairLocation, IqairReading, Measurement } from '../src/domain/iqair.ts';

export function validateIqairUrl(input: string, depth?: number): URL {
  const url = new URL(input);
  const parts = url.pathname.replace(/\/$/, '').split('/').filter(Boolean);
  if (url.protocol !== 'https:' || url.hostname !== 'www.iqair.com' || url.port || url.username || url.password || url.search || url.hash ||
      parts[0] !== 'id' || parts[1] !== 'air-quality' || parts[2] !== 'indonesia' || parts.length < 3 || parts.length > 5 ||
      parts.some(p => !/^[a-z0-9-]+$/.test(p)) || (depth !== undefined && parts.length !== depth)) throw new Error('Gunakan URL publik IQAir Indonesia untuk negara, provinsi, atau kota.');
  url.pathname = '/' + parts.join('/');
  return url;
}
const name = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function numberValue(raw: string): number | undefined {
  let text = raw.trim().replace(/[\s\u00a0]/g, '');
  if (!/^-?\d+(?:[.,]\d+)*$/.test(text)) return;
  if (text.includes(',')) text = text.replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.');
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}
export function timestamp(raw: unknown, now: number): string | undefined {
  // Accept only explicit offsets, never guess the timezone/year of a page label.
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) return;
  const value = Date.parse(raw);
  return Number.isFinite(value) && value <= now + 5 * 60_000 ? new Date(value).toISOString() : undefined;
}
export function isVerificationPage(html: string): boolean {
  return /verify (?:you are|that you are)|browser verification|checking your browser|captcha|challenge-platform|just a moment|access denied|verifikasi browser|vercel security checkpoint/i.test(html);
}
export function discoverLocations(html: string, parent: string): IqairLocation[] {
  const base = validateIqairUrl(parent);
  const depth = base.pathname.split('/').filter(Boolean).length;
  if (depth >= 5 || isVerificationPage(html)) throw new Error('Direktori website tidak tersedia.');
  const $ = load(html); const found = new Map<string, IqairLocation>();
  $('a[href]').each((_, el) => {
    try {
      const url = validateIqairUrl(new URL($(el).attr('href')!, base).href, depth + 1);
      if (!url.pathname.startsWith(base.pathname + '/')) return;
      const parts = url.pathname.split('/');
      const label = $(el).text().trim();
      if (!label || label.length > 100) return;
      const province = depth === 3 ? label : parts[4].replaceAll('-', ' ');
      const id = 'web:' + parts.slice(4).join('/');
      found.set(id, { id, province, ...(depth === 4 ? { city: label } : {}), websiteUrl: url.href });
    } catch { /* Ignore links outside the permitted directory. */ }
  });
  return [...found.values()];
}

export function discoverCityLinks(html: string, parent: string): IqairLocation[] {
  const base = validateIqairUrl(parent);
  if (base.pathname.split('/').filter(Boolean).length > 4 || isVerificationPage(html)) throw new Error('Direktori website tidak tersedia.');
  const $ = load(html); const found = new Map<string, IqairLocation>();
  $('a[href]').each((_, el) => {
    try {
      const url = validateIqairUrl(new URL($(el).attr('href')!, base).href, 5);
      if (!url.pathname.startsWith(base.pathname + '/')) return;
      const parts = url.pathname.split('/'); const label = $(el).text().replace(/\s+/g, ' ').trim();
      if (!label || label.length > 100) return;
      const id = 'web:' + parts.slice(4).join('/');
      found.set(id, { id, province: parts[4].replaceAll('-', ' '), city: label, websiteUrl: url.href });
    } catch { /* Ignore non-city pages, stations and external links. */ }
  });
  return [...found.values()];
}

export function extractReading(html: string, location: IqairLocation, now = Date.now()): IqairReading {
  if (!location.websiteUrl || !location.city) throw new Error('Lokasi kota diperlukan.');
  validateIqairUrl(location.websiteUrl, 5);
  if (isVerificationPage(html)) throw new Error('Website IQAir meminta verifikasi browser.');
  const $ = load(html);
  const heading = $('h1').first().text().trim();
  const headingCity = heading.replace(/^(?:Kualitas udara di|Air quality in)\s+/i, '').trim();
  if (name(headingCity) !== name(location.city)) throw new Error('Identitas kota pada halaman tidak sesuai.');
  // Parse only explicit current data objects. Forecast/history/ranking branches are excluded.
  let structured: Record<string, unknown> | undefined;
  $('script[type="application/json"],script[type="application/ld+json"]').each((_, el) => {
    if (structured) return;
    try {
      const raw = $(el).text(); if (raw.length > 2_000_000) return;
      const walk = (value: unknown, level = 0) => {
        if (level > 18 || !value || typeof value !== 'object' || structured) return;
        const object = value as Record<string, unknown>;
        if (object.type === 'current' && typeof object.city === 'string' && name(object.city) === name(location.city!) && object.country === 'Indonesia') structured = object;
        else for (const [key, child] of Object.entries(object)) if (!/forecast|histor|ranking|article/i.test(key)) walk(child, level + 1);
      };
      walk(JSON.parse(raw));
    } catch { /* Script contents are data only. */ }
  });
  // Remove non-current sections before interpreting labeled observations.
  $('script,style,nav,footer,[data-forecast],[data-history],[data-ranking],.forecast,.ranking').remove();
  $('h2,h3').each((_, el) => {
    if (/prakiraan|forecast|peringkat|ranking|histor|sejarah|apa |what /i.test($(el).text())) {
      $(el).nextAll().remove(); $(el).remove();
    }
  });
  // Block boundaries are meaningful even when minified HTML has no whitespace.
  $('div,p,section,li,br,h1,h2,h3').prepend(' ').append(' ');
  const current = $('[data-current],.aqi-overview,.aqi-overview-container').first();
  const text = (current.length ? current : $('main').length ? $('main') : $('body')).text().replace(/\s+/g, ' ').trim();
  const match = text.match(/(?:^|\s)(\d{1,4})\s*(AQI[⁺+?]?\s*(?:US|CN)|US AQI|China AQI)(?:\s|$)/i);
  const data = structured as Record<string, unknown> | undefined;
  const index = data?.index as Record<string, unknown> | undefined;
  const value = typeof index?.value === 'number' ? index.value : match ? Number(match[1]) : undefined;
  const scale = typeof index?.scale === 'string' ? index.scale : match?.[2];
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1000 || !scale || !/^(?:AQI[⁺+?]?\s*(?:US|CN)|US AQI|China AQI)$/i.test(scale)) throw new Error('Pengukuran kualitas udara saat ini tidak dapat dikenali.');
  const category = typeof index?.category === 'string' ? index.category : text.match(/(?:AQI[⁺+?]?\s*(?:US|CN)|US AQI|China AQI)\s+(Sangat tidak sehat|Tidak sehat bagi kelompok sensitif|Tidak sehat untuk kelompok sensitif|Tidak sehat|Berbahaya|Sedang|Baik|Very unhealthy|Unhealthy for sensitive groups|Unhealthy|Hazardous|Moderate|Good)(?=\s|$)/i)?.[1];
  const dominantPollutant = typeof index?.dominantPollutant === 'string' ? index.dominantPollutant : text.match(/(?:Polutan utama|Main pollutant):?\s*(PM2\.5|PM10|O3|NO2|SO2|CO)/i)?.[1];
  const concentrations: Record<string, Measurement> = {};
  for (const match of text.matchAll(/(PM2\.5|PM10|O3|NO2|SO2|CO)\s*[:\s]\s*(\d+(?:[.,]\d+)*)\s*(µg\/m³|μg\/m³|ug\/m3|mg\/m³|ppb|ppm)/g)) {
    const amount = numberValue(match[2]); if (amount !== undefined && amount >= 0) concentrations[match[1]] = { value: amount, unit: match[3] };
  }
  const weather: Record<string, Measurement> = {};
  for (const [key, regex, unit, max] of [
    ['temperature', /(?:Suhu|Temperature)\s*:?\s*(-?\d+(?:[.,]\d+)?)\s*°C/i, '°C', 65],
    ['humidity', /(?:Kelembapan|Humidity)\s*:?\s*(\d+(?:[.,]\d+)?)\s*%/i, '%', 100],
    ['wind', /(?:Angin|Wind)\s*:?\s*(\d+(?:[.,]\d+)?)\s*km\/h/i, 'km/h', 500],
    ['pressure', /(?:Tekanan|Pressure)\s*:?\s*(\d+(?:[.,]\d+)?)\s*hPa/i, 'hPa', 1200],
  ] as const) {
    const raw = text.match(regex)?.[1]; const amount = raw && numberValue(raw);
    if (typeof amount === 'number' && amount <= max && amount >= (key === 'temperature' ? -90 : 0)) weather[key] = { value: amount, unit };
  }
  const observedAt = timestamp(data?.observedAt ?? current.find('time[datetime]').first().attr('datetime') ?? $('time[data-observation][datetime]').first().attr('datetime'), now);
  const geo = data?.coordinates;
  const coordinates: [number, number] | undefined = Array.isArray(geo) && geo.length === 2 && geo.every(v => typeof v === 'number' && Number.isFinite(v)) && Math.abs(geo[0]) <= 180 && Math.abs(geo[1]) <= 90 ? [geo[0], geo[1]] : undefined;
  const count = (regex: RegExp) => { const raw = text.match(regex)?.[1]; return raw ? numberValue(raw) : undefined; };
  const forecast: NonNullable<IqairReading['forecast']> = [];
  const forecastPage = load(html);
  forecastPage('[data-forecast] [data-at]').each((_, el) => {
    const at = timestamp(forecastPage(el).attr('data-at'), now + 7 * 86400_000);
    const raw = forecastPage(el).attr('data-aqi'); const amount = raw ? numberValue(raw) : undefined;
    const label = forecastPage(el).attr('data-scale');
    if (at && Date.parse(at) >= now && amount !== undefined && amount >= 0 && amount <= 1000 && label && /^(AQI[⁺+?]?\s*(US|CN)|US AQI|China AQI)$/i.test(label)) forecast.push({ at, index: amount, scale: label });
  });
  return { location, sourceMethod: 'website', sourceUrl: location.websiteUrl, retrievedAt: new Date(now).toISOString(), observedAt, coordinates,
    index: { value, scale, category, dominantPollutant },
    ...(Object.keys(concentrations).length ? { concentrations } : {}), ...(Object.keys(weather).length ? { weather } : {}),
    ...(forecast.length ? { forecast } : {}), stations: count(/([\d.,]+)\s*(?:stasiun|stations)/i), contributors: count(/([\d.,]+)\s*(?:contributors|kontributor)/i) };
}
