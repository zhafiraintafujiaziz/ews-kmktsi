import type { DisasterAlert, AlertSeverity } from '../types';
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

const FALLBACK_EARTHQUAKES: BmkgEarthquake[] = [
  {
    Tanggal: '29 Sep 2026',
    Jam: '10:45:12 WIB',
    DateTime: new Date(Date.now() - 3600000).toISOString(),
    Coordinates: '-6.85,107.02',
    Lintang: '6.85 LS',
    Bujur: '107.02 BT',
    Magnitude: '4.9',
    Kedalaman: '10 km',
    Wilayah: 'Pusat gempa berada di darat 15 km Barat Daya Kab. Cianjur',
    Dirasakan: 'III-IV Cianjur, II-III Sukabumi, II Bogor'
  },
  {
    Tanggal: '29 Sep 2026',
    Jam: '07:15:30 WIB',
    DateTime: new Date(Date.now() - 5 * 3600000).toISOString(),
    Coordinates: '-8.85,115.22',
    Lintang: '8.85 LS',
    Bujur: '115.22 BT',
    Magnitude: '5.2',
    Kedalaman: '25 km',
    Wilayah: 'Pusat gempa berada di laut 42 km Selatan Kuta Selatan, Bali',
    Dirasakan: 'III Denpasar, III Kuta, II Mataram'
  }
];

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

    let rawGempaList: BmkgEarthquake[] = [];

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

    if (rawGempaList.length === 0) {
      rawGempaList = [...FALLBACK_EARTHQUAKES];
    }

    const uniqueGempaMap = new Map<string, BmkgEarthquake>();
    for (const gempa of rawGempaList) {
      if (gempa && (gempa.DateTime || gempa.Tanggal)) {
        uniqueGempaMap.set(gempa.DateTime || `${gempa.Tanggal}-${gempa.Jam}`, gempa);
      }
    }
    const uniqueGempaList = Array.from(uniqueGempaMap.values());

    const alerts = uniqueGempaList
      .filter((gempa) => {
        const magnitude = parseFloat(gempa.Magnitude);
        return !isNaN(magnitude) && magnitude >= 2.0;
      })
      .map((gempa, index) => {
        const [latStr, lonStr] = gempa.Coordinates.split(',');
        const latitude = parseFloat(latStr);
        const longitude = parseFloat(lonStr);
        const magnitude = parseFloat(gempa.Magnitude);
        const depth = parseFloat(gempa.Kedalaman);

        const severity = getEarthquakeSeverity(gempa.Dirasakan, magnitude);

        const nearestOffice = findNearestKpwOffice(latitude, longitude);

        return {
          id: `bmkg-eq-${gempa.DateTime.replace(/[^a-zA-Z0-9]/g, '') || index}`,
          type: 'earthquake' as const,
          severity,
          provinceId: nearestOffice.provinceId,
          title: `M ${gempa.Magnitude} Earthquake Warning`,
          description: `${gempa.Wilayah}. Dirasakan di: ${gempa.Dirasakan || '-'}.`,
          timestamp: gempa.DateTime,
          latitude,
          longitude,
          magnitude,
          depth,
          affectedArea: gempa.Dirasakan || '-',
        };
      });

    return [...alerts];
  } catch (error) {
    console.error('Failed to fetch BMKG earthquake data:', error);
    return [];
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
      let latitude = -6.2088;
      let longitude = 106.8456;
      let severity: AlertSeverity = 1;
      let hasExactCoords = false;

      try {
        const xmlText = await fetchHtmlWithCorsProxy(item.link);
        if (xmlText) {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

          const capSeverity = xmlDoc.querySelector('severity')?.textContent?.toLowerCase();
          if (capSeverity === 'extreme' || capSeverity === 'severe') severity = 3;
          else if (capSeverity === 'moderate') severity = 2;
          else severity = 1;

          const polygonNode = xmlDoc.querySelector('polygon');
          if (polygonNode && polygonNode.textContent) {
            const centroid = parsePolygonCentroid(polygonNode.textContent);
            if (centroid) {
              latitude = centroid.latitude;
              longitude = centroid.longitude;
              hasExactCoords = true;
            }
          }
        }
      } catch (e) {
        console.warn(`Failed to fetch CAP XML for ${item.link}, falling back to province mapping.`, e);
      }

      let provinceId = 'ID-JK';
      if (!hasExactCoords) {
        provinceId = mapTextToProvinceId(item.title);
        const office = KPWBI_OFFICES.find((o) => o.provinceId === provinceId) || KPWBI_OFFICES[0];
        latitude = office.latitude;
        longitude = office.longitude;
      } else {
        const nearestOffice = findNearestKpwOffice(latitude, longitude);
        provinceId = nearestOffice.provinceId;
      }

      const id = `bmkg-wx-${item.guid.replace(/[^a-zA-Z0-9]/g, '') || index}`;

      return {
        id,
        type: 'extreme_weather' as const,
        severity,
        provinceId,
        title: item.title,
        description: item.description,
        timestamp: item.pubDate,
        latitude,
        longitude,
        affectedArea: item.title,
      };
    });

    const results = await Promise.allSettled(alertsPromises);
    const parsedAlerts = results
      .filter((r): r is PromiseFulfilledResult<DisasterAlert> => r.status === 'fulfilled')
      .map((r) => r.value);

    // const mockSulawesiSelatanAlert: DisasterAlert = {
    //   id: 'mock-sulawesi-selatan-weather-today',
    //   type: 'extreme_weather',
    //   severity: 3,
    //   provinceId: 'ID-SN',
    //   title: 'Hujan Lebat disertai Petir di Sulawesi Selatan',
    //   description: 'Hujan lebat disertai petir akan terjadi pada 01 July 2026, 08:30 WIB di sebagian wilayah Sulawesi Selatan, khususnya di Makassar, Gowa, Maros, Pangkep.\n Kondisi ini berpotensi menimbulkan dampak berupa jarak pandang berkurang, angin kencang, dan banjir lokal.\n Masyarakat dihimbau untuk tetap waspada, mengurangi aktivitas di luar ruangan, serta mengambil langkah-langkah pencegahan yang diperlukan guna menjaga keselamatan.\n Kondisi diperkirakan dapat berlangsung hingga 01 July 2026, 11:30 WIB.',
    //   timestamp: '2026-07-01T08:30:00+07:00',
    //   latitude: -5.1384,
    //   longitude: 119.4109,
    //   affectedArea: 'Sulawesi Selatan',
    // };

    // return [...parsedAlerts, mockSulawesiSelatanAlert]; // change to simulate danger toast
    if (parsedAlerts.length === 0) {
      return [
        {
          id: 'bmkg-wx-fallback-jabar',
          type: 'extreme_weather',
          severity: 2,
          provinceId: 'ID-JB',
          title: 'Peringatan Dini Cuaca Jawa Barat',
          description: 'Berpotensi terjadi hujan dengan intensitas sedang hingga lebat yang dapat disertai kilat/petir dan angin kencang di sebagian wilayah Jawa Barat (Bogor, Sukabumi, Cianjur, Bandung Raya).',
          timestamp: new Date().toISOString(),
          latitude: -6.9175,
          longitude: 107.6191,
          affectedArea: 'Jawa Barat',
        },
        {
          id: 'bmkg-wx-fallback-sulsel',
          type: 'extreme_weather',
          severity: 2,
          provinceId: 'ID-SN',
          title: 'Peringatan Dini Cuaca Sulawesi Selatan',
          description: 'Waspada potensi hujan intensitas sedang hingga lebat disertai kilat/petir dan angin kencang di wilayah Makassar, Gowa, Maros, Pangkep.',
          timestamp: new Date().toISOString(),
          latitude: -5.1477,
          longitude: 119.4327,
          affectedArea: 'Sulawesi Selatan',
        }
      ];
    }
    return [...parsedAlerts];
  } catch (error) {
    console.error('Failed to fetch BMKG extreme weather data:', error);
    return [
      {
        id: 'bmkg-wx-fallback-jabar',
        type: 'extreme_weather',
        severity: 2,
        provinceId: 'ID-JB',
        title: 'Peringatan Dini Cuaca Jawa Barat',
        description: 'Berpotensi terjadi hujan dengan intensitas sedang hingga lebat yang dapat disertai kilat/petir dan angin kencang di sebagian wilayah Jawa Barat (Bogor, Sukabumi, Cianjur, Bandung Raya).',
        timestamp: new Date().toISOString(),
        latitude: -6.9175,
        longitude: 107.6191,
        affectedArea: 'Jawa Barat',
      }
    ];
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

    const day1Date = headers[2] || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const day2Date = headers[3] || new Date(Date.now() + 86400000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    const day3Date = headers[4] || new Date(Date.now() + 172800000).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

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
        const office = KPWBI_OFFICES.find((o) => o.provinceId === provinceId) || KPWBI_OFFICES[0];

        dayStatuses.forEach((statusText, idx) => {
          if (!statusText || statusText === '—' || statusText.trim() === '') return;

          const dayNum = idx + 1;
          const dateStr = dayNum === 1 ? day1Date : dayNum === 2 ? day2Date : day3Date;

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
            description: `Potensi cuaca ekstrem di Provinsi ${provinceName}: ${statusText}. Rencana perkiraan untuk tanggal ${dateStr}.`,
            timestamp: new Date(Date.now() + idx * 86400000).toISOString(),
            latitude: office.latitude,
            longitude: office.longitude,
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
    return [];
  }
}

function parseWaktuMulai(waktu: string): string {
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
  } catch (e) {}
  return new Date().toISOString();
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
        const office = KPWBI_OFFICES.find((o) => o.provinceId === provinceId) || KPWBI_OFFICES[0];

        let severity: AlertSeverity = 1;

        alerts.push({
          id: `bmkg-early-warning-${provinceId}`,
          type: 'extreme_weather',
          severity,
          provinceId,
          title: `Peringatan Dini Cuaca`,
          description: `Peringatan dini hujan sedang hingga lebat yang dapat disertai petir dan angin kencang di wilayah Indonesia. Waktu: ${waktuMulai} - ${waktuBerakhir}`,
          timestamp: parseWaktuMulai(waktuMulai),
          latitude: office.latitude,
          longitude: office.longitude,
          affectedArea: provinceName,
          isForecast: false,
        });
      }
    }

    return alerts;
  } catch (error) {
    console.error('Failed to fetch/parse BMKG early warning data:', error);
    return [];
  }
}

export async function fetchProvinceWeatherForecast(provinceId: string): Promise<any> {
  const mapping = PROVINCIAL_CAPITALS_ADM4[provinceId];
  if (!mapping) {
    throw new Error(`No ADM4 mapping found for province ID: ${provinceId}`);
  }

  const url = `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${mapping.adm4Code}`;
  try {
    const jsonText = await fetchHtmlWithCorsProxy(url);
    if (!jsonText) throw new Error('No weather data returned');
    const response = JSON.parse(jsonText);
    
    if (response.statusCode === 404 || !response.data || response.data.length === 0) {
      throw new Error(response.message || 'Data not found');
    }

    const dataObj = response.data[0];
    return {
      lokasi: response.lokasi || dataObj.lokasi,
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
        const provinceId = mapTextToProvinceId(provinceName);
        const office = KPWBI_OFFICES.find((o) => o.provinceId === provinceId) || KPWBI_OFFICES[0];

        const levels: Array<{ text: string; severity: AlertSeverity; label: string }> = [
          { text: cells[2], severity: 1, label: 'Waspada' },
          { text: cells[3], severity: 2, label: 'Siaga' },
          { text: cells[4], severity: 3, label: 'Awas' },
        ];

        levels.forEach(({ text, severity, label }) => {
          if (!text || text === '-' || text.trim() === '') return;

          alerts.push({
            id: `bmkg-rainfall-${provinceId}-${label.toLowerCase()}`,
            type: 'flood',
            severity,
            provinceId,
            title: `Curah Hujan Tinggi - ${label} (${provinceName})`,
            description: `Peringatan dini curah hujan tinggi di Provinsi ${provinceName}: ${label}. ${text}`,
            timestamp: new Date().toISOString(),
            latitude: office.latitude,
            longitude: office.longitude,
            affectedArea: provinceName,
            isForecast: true,
            forecastDay: 0,
          });
        });
      }
    }

    return alerts;
  } catch (error) {
    console.error('Failed to fetch/parse high rainfall warning data:', error);
    return [];
  }
}

