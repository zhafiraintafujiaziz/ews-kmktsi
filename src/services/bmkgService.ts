import type { DisasterAlert, AlertSeverity } from '../types';
import type { WeatherData } from '../types/weather';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { findNearestKpwOffice } from '../utils/geo';
import { mapTextToProvinceId } from '../utils/provinceMap';
import { PROVINCIAL_CAPITALS_ADM4 } from '../constants/provincialCapitalsAdm4';
import { fetchHtmlWithCorsProxy, fetchWithCorsProxy } from './proxy';

interface BmkgEarthquake {
  Tanggal: string;
  Jam: string;
  DateTime: string;
  Coordinates: string;
  Lintang: string;
  Bujur: string;
  Magnitude: string;
  Kedalaman: string;
  Wilayah: string;
  Dirasakan: string;
}

interface BmkgResponse {
  Infogempa?: {
    gempa?: BmkgEarthquake[] | BmkgEarthquake;
  };
}

function parsePolygonCentroid(polygonStr: string): { latitude: number; longitude: number } | null {
  if (!polygonStr) return null;
  const pairs = polygonStr.trim().split(/\s+/);
  let totalLat = 0;
  let totalLon = 0;
  let count = 0;
  for (const pair of pairs) {
    const coords = pair.split(',');
    if (coords.length === 2) {
      const lat = parseFloat(coords[0]);
      const lon = parseFloat(coords[1]);
      if (!isNaN(lat) && !isNaN(lon)) {
        totalLat += lat;
        totalLon += lon;
        count++;
      }
    }
  }
  if (count === 0) return null;
  return { latitude: totalLat / count, longitude: totalLon / count };
}

function parseBmkgDate(value: string): Date | null {
  const months: Record<string, string> = {
    januari: 'January', februari: 'February', maret: 'March', april: 'April', mei: 'May',
    juni: 'June', juli: 'July', agustus: 'August', september: 'September', oktober: 'October',
    november: 'November', desember: 'December', jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr',
    jun: 'Jun', jul: 'Jul', agu: 'Aug', agt: 'Aug', sep: 'Sep', okt: 'Oct', nov: 'Nov', des: 'Dec',
  };
  const normalized = value.replace(/\b[A-Za-z]+\b/g, (month) => months[month.toLowerCase()] ?? month);
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

// Removed local fetchWithProxy in favor of fetchHtmlWithCorsProxy from proxy.ts

function getEarthquakeSeverity(dirasakan: string, magnitude: number): AlertSeverity {
  if (dirasakan && dirasakan !== '-') {
    const mmiMap: Record<string, number> = {
      'XII': 12, 'XI': 11, 'X': 10, 'IX': 9, 'VIII': 8,
      'VII': 7, 'VI': 6, 'V': 5, 'IV': 4, 'III': 3, 'II': 2, 'I': 1
    };
    
    const regex = /\b(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\b/g;
    let match;
    let max = 0;
    
    while ((match = regex.exec(dirasakan)) !== null) {
      const val = mmiMap[match[1]];
      if (val > max) max = val;
    }
    
    if (max >= 9) return 3; // IX - XII (Tinggi)
    if (max >= 5) return 2; // V - VIII (Sedang)
    if (max > 0) return 1; // I - IV (Rendah)
  }
  
  // Fallback to magnitude
  if (magnitude >= 5.5) return 3;
  if (magnitude >= 3.5) return 2;
  return 1;
}

export async function fetchLatestEarthquakes(): Promise<DisasterAlert[]> {
  try {
    const [dirasakanData, autoData] = await Promise.all([
      fetchWithCorsProxy('https://data.bmkg.go.id/DataMKG/TEWS/gempadirasakan.json').catch(e => {
        console.error('Failed to fetch gempadirasakan:', e);
        return null;
      }),
      fetchWithCorsProxy('https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json').catch(e => {
        console.error('Failed to fetch autogempa:', e);
        return null;
      })
    ]);

    const rawGempaList: BmkgEarthquake[] = [];

    if (dirasakanData && (dirasakanData as BmkgResponse).Infogempa?.gempa) {
      const gempa = (dirasakanData as BmkgResponse).Infogempa!.gempa!;
      if (Array.isArray(gempa)) {
        rawGempaList.push(...gempa);
      } else {
        rawGempaList.push(gempa);
      }
    }

    if (autoData && (autoData as BmkgResponse).Infogempa?.gempa) {
      const gempa = (autoData as BmkgResponse).Infogempa!.gempa!;
      if (Array.isArray(gempa)) {
        rawGempaList.push(...gempa);
      } else {
        rawGempaList.push(gempa);
      }
    }

    const uniqueGempaMap = new Map<string, BmkgEarthquake>();
    for (const gempa of rawGempaList) {
      if (gempa && (gempa.DateTime || gempa.Tanggal)) {
        uniqueGempaMap.set(gempa.DateTime || `${gempa.Tanggal}-${gempa.Jam}`, gempa);
      }
    }
    const uniqueGempaList = Array.from(uniqueGempaMap.values());

    const now = Date.now();
    const alerts = uniqueGempaList
      .filter((gempa) => {
        const magnitude = parseFloat(gempa.Magnitude);
        const observedAt = Date.parse(gempa.DateTime || '');
        return !isNaN(magnitude) && magnitude >= 2.0 && Number.isFinite(observedAt) && observedAt <= now && now - observedAt <= 24 * 60 * 60 * 1000;
      })
      .map((gempa, index) => {
        const [latStr, lonStr] = (gempa.Coordinates || '').split(',');
        const latitude = parseFloat(latStr);
        const longitude = parseFloat(lonStr);
        const magnitude = parseFloat(gempa.Magnitude);
        const depth = parseFloat(gempa.Kedalaman);

        const severity = getEarthquakeSeverity(gempa.Dirasakan, magnitude);

        const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
        const nearestOffice = hasCoordinates ? findNearestKpwOffice(latitude, longitude) : null;

        return {
          id: `bmkg-eq-${gempa.DateTime.replace(/[^a-zA-Z0-9]/g, '') || index}`,
          type: 'earthquake' as const,
          severity,
          provinceId: nearestOffice?.provinceId ?? mapTextToProvinceId(gempa.Wilayah || ''),
          title: `M ${gempa.Magnitude} Earthquake Warning`,
          description: `${gempa.Wilayah}. Dirasakan di: ${gempa.Dirasakan || '-'}.`,
          timestamp: gempa.DateTime,
          ...(hasCoordinates ? { latitude, longitude } : {}),
          magnitude,
          depth,
          affectedArea: gempa.Dirasakan || '-',
        };
      });

    return [...alerts];
  } catch (error) {
    console.error('Failed to fetch BMKG earthquake data:', error);
    throw error;
  }
}

export async function fetchExtremeWeather(): Promise<DisasterAlert[]> {
  try {
    const response = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://www.bmkg.go.id/alerts/nowcast/id/rss.xml');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    if (data.status !== 'ok') throw new Error('RSS-to-JSON API status not ok');
    const rawItems = data.items || [];
    const items = rawItems.slice(0, 15);

    const alertsPromises = items.map(async (item: { guid: string; link: string; title: string; description: string; pubDate: string }, index: number) => {
      let latitude: number | undefined;
      let longitude: number | undefined;
      let severity: AlertSeverity | null = null;
      let validFrom: string | undefined;
      let validUntil: string | undefined;
      let sourceGeometry: unknown;

      try {
        const xmlText = await fetchHtmlWithCorsProxy(item.link);
        if (xmlText) {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

          const capSeverity = xmlDoc.querySelector('severity')?.textContent?.toLowerCase();
          if (capSeverity === 'extreme' || capSeverity === 'severe') severity = 3;
          else if (capSeverity === 'moderate') severity = 2;
          else if (capSeverity === 'minor') severity = 1;
          validFrom = xmlDoc.querySelector('onset')?.textContent || xmlDoc.querySelector('effective')?.textContent || undefined;
          validUntil = xmlDoc.querySelector('expires')?.textContent || undefined;
          if (!validUntil || !Number.isFinite(Date.parse(validUntil)) || Date.parse(validUntil) < Date.now()) return null;
          if (validFrom && (!Number.isFinite(Date.parse(validFrom)) || Date.parse(validFrom) > Date.now())) return null;

          const polygonNode = xmlDoc.querySelector('polygon');
          if (polygonNode && polygonNode.textContent) {
            const centroid = parsePolygonCentroid(polygonNode.textContent);
            if (centroid) {
              latitude = centroid.latitude;
              longitude = centroid.longitude;
              sourceGeometry = { type: 'Polygon', coordinates: polygonNode.textContent };
            }
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch CAP XML for ${item.link}.`, e);
      }

      if (severity === null || !validUntil || !Number.isFinite(Date.parse(item.pubDate)) || Date.parse(item.pubDate) > Date.now()) return null;
      const provinceId = latitude !== undefined && longitude !== undefined
        ? findNearestKpwOffice(latitude, longitude).provinceId
        : mapTextToProvinceId(item.title);

      const id = `bmkg-wx-${item.guid.replace(/[^a-zA-Z0-9]/g, '') || index}`;

      return {
        id,
        type: 'extreme_weather' as const,
        severity,
        provinceId,
        title: item.title,
        description: item.description,
        timestamp: item.pubDate,
        ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
        affectedArea: item.title,
        validFrom,
        validUntil,
        sourceGeometry,
      };
    });

    const results = await Promise.allSettled(alertsPromises);
    const parsedAlerts = results
      .filter((r): r is PromiseFulfilledResult<DisasterAlert | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((alert): alert is DisasterAlert => alert !== null);
    return [...parsedAlerts];
  } catch (error) {
    console.error('Failed to fetch BMKG extreme weather data:', error);
    throw error;
  }
}

export async function fetchThreeDayForecast(): Promise<DisasterAlert[]> {
  try {
    const html = await fetchHtmlWithCorsProxy('https://www.bmkg.go.id/cuaca/potensi-cuaca-ekstrem');
    if (!html) throw new Error('No HTML content returned');

    const theadMatch = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
    const headers: string[] = [];
    if (theadMatch) {
      const rxTh = /<th[^>]*>([\s\S]*?)<\/th>/gi;
      let mTh;
      while ((mTh = rxTh.exec(theadMatch[1])) !== null) {
        headers.push(mTh[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      }
    }

    const day1Date = headers[2];
    const day2Date = headers[3];
    const day3Date = headers[4];

    const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) return [];

    const tbody = tbodyMatch[1];
    const alerts: DisasterAlert[] = [];
    const rxTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let mTr;

    while ((mTr = rxTr.exec(tbody)) !== null) {
      const trContent = mTr[1];
      const rxTd = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let mTd;
      const cells: string[] = [];
      while ((mTd = rxTd.exec(trContent)) !== null) {
        cells.push(mTd[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      }

      if (cells.length >= 5) {
        const provinceName = cells[1];
        const dayStatuses = [cells[2], cells[3], cells[4]];
        const provinceId = mapTextToProvinceId(provinceName);
        const office = KPWBI_OFFICES.find((o) => o.provinceId === provinceId);

        dayStatuses.forEach((statusText, idx) => {
          if (!statusText || statusText === '—' || statusText.trim() === '') return;

          const dayNum = idx + 1;
          const dateStr = dayNum === 1 ? day1Date : dayNum === 2 ? day2Date : day3Date;
          const forecastTime = dateStr ? parseBmkgDate(dateStr) : null;
          if (!forecastTime || forecastTime.getTime() + 86400000 <= Date.now()) return;

          let severity: AlertSeverity = 1;
          const lowerStatus = statusText.toLowerCase();
          if (lowerStatus.includes('siaga')) severity = 3;
          else if (lowerStatus.includes('waspada')) severity = 2;

          alerts.push({
            id: `bmkg-forecast-${provinceId}-${dayNum}`,
            type: 'extreme_weather',
            severity,
            provinceId,
            title: `${statusText} (${dateStr})`,
            description: `Potensi Cuaca Buruk di Provinsi ${provinceName}: ${statusText}. Rencana perkiraan untuk tanggal ${dateStr}.`,
            timestamp: forecastTime.toISOString(),
            validFrom: forecastTime.toISOString(),
            validUntil: new Date(forecastTime.getTime() + 86400000).toISOString(),
            ...(office ? { latitude: office.latitude, longitude: office.longitude } : {}),
            affectedArea: provinceName,
            isForecast: true,
            forecastDay: dayNum,
            forecastDateStr: dateStr,
          });
        });
      }
    }

    return alerts;
  } catch (error) {
    console.error('Failed to fetch/parse 3-day BMKG weather forecast:', error);
    throw error;
  }
}

function parseWaktuMulai(waktu: string): string | null {
  try {
    const clean = waktu.replace('•', ' ').trim();
    const parts = clean.split(/\s+/);
    if (parts.length >= 5) {
      let tzOffset = '+0700'; // WIB
      const tz = parts[4].toUpperCase();
      if (tz === 'WITA') tzOffset = '+0800';
      if (tz === 'WIT') tzOffset = '+0900';
      
      const dateStr = `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3].replace('.', ':')}:00 ${tzOffset}`;
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  } catch {
    return null;
  }
  return null;
}

export async function fetchEarlyWarning(): Promise<DisasterAlert[]> {
  try {
    const html = await fetchHtmlWithCorsProxy('https://www.bmkg.go.id/cuaca/peringatan-dini-cuaca');
    if (!html) throw new Error('No HTML content returned');

    const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
    if (!tbodyMatch) return [];

    const tbody = tbodyMatch[1];
    const alerts: DisasterAlert[] = [];
    const rxTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let mTr;

    while ((mTr = rxTr.exec(tbody)) !== null) {
      const trContent = mTr[1];
      const rxTd = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let mTd;
      const cells: string[] = [];
      while ((mTd = rxTd.exec(trContent)) !== null) {
        cells.push(mTd[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      }

      if (cells.length >= 5) {
        const provinceName = cells[1];
        const waktuMulai = cells[2];
        const waktuBerakhir = cells[3];

        const provinceId = mapTextToProvinceId(provinceName);
        const office = KPWBI_OFFICES.find((o) => o.provinceId === provinceId);
        const timestamp = parseWaktuMulai(waktuMulai);
        const validUntil = parseWaktuMulai(waktuBerakhir);
        if (!timestamp || !validUntil || Date.parse(timestamp) > Date.now() || Date.parse(validUntil) < Date.now()) continue;

        const severity: AlertSeverity = 1;

        alerts.push({
          id: `bmkg-early-warning-${provinceId}`,
          type: 'extreme_weather',
          severity,
          provinceId,
          title: `Peringatan Dini Cuaca`,
          description: `Peringatan dini hujan sedang hingga lebat yang dapat disertai petir dan angin kencang di wilayah Indonesia. Waktu: ${waktuMulai} - ${waktuBerakhir}`,
          timestamp,
          validFrom: timestamp,
          validUntil,
          ...(office ? { latitude: office.latitude, longitude: office.longitude } : {}),
          affectedArea: provinceName,
          isForecast: false,
        });
      }
    }

    return alerts;
  } catch (error) {
    console.error('Failed to fetch/parse BMKG early warning data:', error);
    throw error;
  }
}

interface BmkgWeatherResponse {
  statusCode?: number;
  message?: string;
  lokasi?: WeatherData['lokasi'];
  data?: Array<Partial<WeatherData>>;
}

export async function fetchProvinceWeatherForecast(provinceId: string): Promise<WeatherData> {
  const mapping = PROVINCIAL_CAPITALS_ADM4[provinceId];
  if (!mapping) {
    throw new Error(`No ADM4 mapping found for province ID: ${provinceId}`);
  }

  const url = `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${mapping.adm4Code}`;
  try {
    const jsonText = await fetchHtmlWithCorsProxy(url);
    if (!jsonText) throw new Error('No weather data returned');
    const response = JSON.parse(jsonText) as BmkgWeatherResponse;
    
    if (response.statusCode === 404 || !response.data || response.data.length === 0) {
      throw new Error(response.message || 'Data not found');
    }

    const dataObj = response.data[0];
    const lokasi = response.lokasi || dataObj.lokasi;
    if (!lokasi) throw new Error('Weather location not found');
    return {
      lokasi,
      cuaca: dataObj.cuaca || []
    };
  } catch (error) {
    console.error(`Failed to fetch weather forecast for province ${provinceId} (${mapping.provinceName}):`, error);
    throw error;
  }
}

export async function fetchHighRainfallWarning(): Promise<DisasterAlert[]> {
  try {
    const html = await fetchHtmlWithCorsProxy('https://www.bmkg.go.id/iklim/peringatan-dini-hujan-tinggi');
    if (!html) throw new Error('No HTML content returned');
    // This table does not expose a verifiable validity period, so it cannot
    // create an operational alert until its source dates can be parsed.
    return [];
  } catch (error) {
    console.error('Failed to fetch/parse high rainfall warning data:', error);
    throw error;
  }
}

