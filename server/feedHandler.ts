import type { IncomingMessage, ServerResponse } from 'node:http';
import { FEED_SECONDS, type FeedId, type FeedResponse } from '../src/domain/feedPolicy.ts';
import { fetchLatestEarthquakes, fetchExtremeWeather, fetchEarlyWarning, fetchThreeDayForecast, fetchProvinceWeatherForecast } from '../src/services/bmkgService.ts';
import { getForecastSnapshot } from '../src/services/weatherForecastAssessment.ts';
import { MagmaService } from '../src/services/magmaService.ts';
import { SipongiService } from '../src/services/sipongiService.ts';
import { InaSiamService } from '../src/services/inaSiamService.ts';
import { parseLatestIrbiRows } from '../src/services/bnpbIrbiService.ts';
import { enableServerSourceRequests, fetchHtmlWithCorsProxy, fetchWithCorsProxy } from '../src/services/proxy.ts';
import { OFFICE_IRBI_REGION } from '../src/constants/officeIrbiRegion.ts';
import { PROVINCIAL_CAPITALS_ADM4 } from '../src/constants/provincialCapitalsAdm4.ts';
import { parseStationResponse, ISPU_SOURCE_URL, wibDate } from './ispuParser.ts';
import { parseMarkup } from './markup.ts';
import { isCalendarDate } from '../src/domain/ispuHistory.ts';

enableServerSourceRequests();
export function compactIrbi(text: string) {
  const wanted = new Set(Object.values(OFFICE_IRBI_REGION).map(region => region.pcode));
  return [...parseLatestIrbiRows(text).values()].filter(row => wanted.has(String(row.pcode))).map(row => ({
    pcode: row.pcode, tahun: row.tahun, status: 'FINAL',
    gempabumi: row.gempabumi, cuaca_ekstrem: row.cuaca_ekstrem, karlahut: row.karlahut,
  }));
}
export async function fetchFeedData(feed: FeedId, params: URLSearchParams): Promise<unknown> {
  switch (feed) {
    case 'earthquakes': return fetchLatestEarthquakes();
    case 'extreme-weather': return fetchExtremeWeather(text => parseMarkup(text, true));
    case 'early-warning': return fetchEarlyWarning();
    case 'forecast': {
      const alerts = await fetchThreeDayForecast();
      return { alerts, snapshot: getForecastSnapshot() };
    }
    case 'magma': return MagmaService.fetchLiveAlerts(parseMarkup);
    case 'volcano-report': return MagmaService.fetchDailyReport(params.get('date')!, parseMarkup);
    case 'province-weather': return fetchProvinceWeatherForecast(params.get('provinceId')!);
    case 'sipongi': return SipongiService.fetchKarhutlaAlerts();
    case 'closed-airports': return InaSiamService.fetchClosedAirports();
    case 'inasiam': return InaSiamService.fetchLiveSigmets();
    case 'irbi': return compactIrbi(await fetchHtmlWithCorsProxy('https://inarisk.bnpb.go.id/apiv4/data-irbi-full'));
    case 'ispu': {
      const now = Date.now();
      const parsed = parseStationResponse(await fetchWithCorsProxy(ISPU_SOURCE_URL), wibDate(now), now);
      return { readings: parsed.readings };
    }
  }
}

export function createFeedHandler(fetchData = fetchFeedData) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (status: number, data: unknown) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); send(405, { error: 'GET required.' }); return; }
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const feed = params.get('feed') as FeedId;
    const permitted = new Set(['feed', ...(feed === 'province-weather' ? ['provinceId'] : feed === 'volcano-report' ? ['date'] : [])]);
    if (!Object.hasOwn(FEED_SECONDS, feed) || [...params.keys()].some(key => !permitted.has(key) || params.getAll(key).length !== 1)
      || feed === 'province-weather' && !Object.hasOwn(PROVINCIAL_CAPITALS_ADM4, params.get('provinceId') || '')
      || feed === 'volcano-report' && !isCalendarDate(params.get('date') || '')) {
      send(400, { error: 'Invalid feed parameters.' }); return;
    }
    try {
      const fetchedAt = Date.now();
      const data = await fetchData(feed, params);
      const result: FeedResponse<unknown> = { version: 1, feed, fetchedAt: new Date(fetchedAt).toISOString(), freshUntil: new Date(fetchedAt + FEED_SECONDS[feed] * 1000).toISOString(), data };
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      const remaining = Math.max(1, Math.ceil((Date.parse(result.freshUntil) - Date.now()) / 1000));
      res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=' + remaining);
      send(200, result);
    } catch (error) {
      console.error('[feed]', feed, error instanceof Error ? error.message : 'Upstream failure');
      send(503, { error: 'Source temporarily unavailable.' });
    }
  };
}
