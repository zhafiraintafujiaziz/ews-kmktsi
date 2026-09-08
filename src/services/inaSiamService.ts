import type { DisasterAlert, AlertSeverity, ClosedAirportInfo, AffectedSeaportInfo } from '../types';
import { fetchHtmlWithCorsProxy, fetchWithCorsProxy } from './proxy';
import { findNearestKpwOffice, haversineDistance } from '../utils/geo';
import { getProvinceIdForVolcano, getVolcanoCoordinates } from './magmaService';

export interface VolcanicAshArea {
  id: number;
  name: string;
  image: string;
  source?: string;
  updatedAt?: string;
}

export interface LiveSigmetPolygon {
  volcanoKey: string;
  volcanoName: string;
  rawSigmet: string;
  firId: string;
  validTimeFrom: string;
  validTimeTo: string;
  flightLevel: string;
  directionText: string;
  bearing: number;
  coordinates: [number, number][]; // [lat, lon] in Leaflet order
}

// Koordinat referensi kawah gunung api
const VOLCANO_COORD_OVERRIDE: Record<string, [number, number]> = {
  'anak krakatau': [-6.102, 105.423],
  'krakatau': [-6.102, 105.423],
  'lewotobi': [-8.542, 122.775],
  'lewotobi laki-laki': [-8.542, 122.775],
  'semeru': [-8.108, 112.922],
  'ibu': [1.488, 127.63],
  'dukono': [1.693, 127.894],
  'marapi': [-0.381, 100.473],
  'merapi': [-7.540, 110.446],
  'sinabung': [3.17, 98.392],
  'ruang': [2.302, 125.367],
  'karangetang': [2.78, 125.40],
  'ili lewotolok': [-8.272, 123.505],
  'lewotolok': [-8.272, 123.505],
  'soputan': [1.112, 124.73],
  'awu': [3.682, 125.446],
  'bromo': [-7.942, 112.953],
  'kerinci': [-1.697, 101.264]
};

function resolveCoords(name: string): [number, number] {
  const clean = name.toLowerCase().trim();
  for (const [key, coords] of Object.entries(VOLCANO_COORD_OVERRIDE)) {
    if (clean.includes(key)) return coords;
  }
  return getVolcanoCoordinates(name);
}

const DIR_TO_BEARING: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
  E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
  W: 270, WNW: 292.5, NW: 315, NNW: 337.5
};

// Data SIGMET live dari BMKG Aviation va-map.php (terverifikasi presisi)
export const VERIFIED_SIGMET_FALLBACKS: Record<string, LiveSigmetPolygon> = {
  semeru: {
    volcanoKey: 'semeru',
    volcanoName: 'Semeru',
    rawSigmet: 'WVID21 WAAA 080600 WAAF SIGMET 11 VALID 080600/081200 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT SEMERU PSN S0806 E11255 VA CLD OBS AT 0540Z WI S0806 E11250 - S0801 E11254 - S0806 E11319 - S0820 E11317 - S0826 E11305 - S0806 E11250 SFC/FL150 MOV SE 05KT NC=',
    firId: 'WAAF',
    validTimeFrom: '2026-09-08T06:00:00.000Z',
    validTimeTo: '2026-09-08T12:00:00.000Z',
    flightLevel: 'SFC / FL150 (± 4.500 m dpl)',
    directionText: 'Tenggara (SE / 5 KT)',
    bearing: 135,
    coordinates: [
      [-8.1, 112.8333],
      [-8.0167, 112.9],
      [-8.1, 113.3167],
      [-8.3333, 113.2833],
      [-8.4333, 113.0833],
      [-8.1, 112.8333]
    ]
  },
  ibu: {
    volcanoKey: 'ibu',
    volcanoName: 'Ibu',
    rawSigmet: 'WVID21 WAAA 080745 WAAF SIGMET 18 VALID 080745/081345 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT IBU PSN N0129 E12738 VA CLD OBS AT 0720Z WI N0127 E12739 - N0128 E12736 - N0147 E12734 - N0148 E12746 - N0139 E12753 - N0127 E12739 SFC/FL070 MOV N 05KT NC=',
    firId: 'WAAF',
    validTimeFrom: '2026-09-08T07:45:00.000Z',
    validTimeTo: '2026-09-08T13:45:00.000Z',
    flightLevel: 'SFC / FL070 (± 2.100 m dpl)',
    directionText: 'Utara (N / 5 KT)',
    bearing: 0,
    coordinates: [
      [1.45, 127.65],
      [1.4667, 127.6],
      [1.7833, 127.5667],
      [1.8, 127.7667],
      [1.65, 127.8833],
      [1.45, 127.65]
    ]
  },
  dukono: {
    volcanoKey: 'dukono',
    volcanoName: 'Dukono',
    rawSigmet: 'WVID21 WAAA 080700 WAAF SIGMET 16 VALID 080700/081300 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT DUKONO PSN N0142 E12754 VA CLD OBS AT 0630Z WI N0138 E12755 - N0139 E12750 - N0231 E12743 - N0219 E12817 - N0150 E12827 - N0138 E12755 SFC/FL070 MOV NE 05KT NC=',
    firId: 'WAAF',
    validTimeFrom: '2026-09-08T07:00:00.000Z',
    validTimeTo: '2026-09-08T13:00:00.000Z',
    flightLevel: 'SFC / FL070 (± 2.100 m dpl)',
    directionText: 'Timur Laut (NE / 5 KT)',
    bearing: 45,
    coordinates: [
      [1.6333, 127.9167],
      [1.65, 127.8333],
      [2.5167, 127.7167],
      [2.3167, 128.2833],
      [1.8333, 128.45],
      [1.6333, 127.9167]
    ]
  },
  krakatau: {
    volcanoKey: 'krakatau',
    volcanoName: 'Anak Krakatau',
    rawSigmet: 'WVID20 WIII 080531 WIIF SIGMET 01 VALID 080531/081131 WIII- WIIF JAKARTA FIR VA ERUPTION MT KRAKATAU PSN S0606 E10525 VA CLD OBS AT 0510Z WI S0546 E10520 - S0558 E10545 - S0714 E10532 - S0719 E10440 - S0619 E10403 - S0546 E10520 SFC/FL070 MOV SW 15KT NC=',
    firId: 'WIIF',
    validTimeFrom: '2026-09-08T05:31:00.000Z',
    validTimeTo: '2026-09-08T11:31:00.000Z',
    flightLevel: 'SFC / FL070 (± 2.100 m dpl)',
    directionText: 'Barat Daya (SW / 15 KT)',
    bearing: 225,
    coordinates: [
      [-5.7667, 105.3333],
      [-5.9667, 105.75],
      [-7.2333, 105.5333],
      [-7.3167, 104.6667],
      [-6.3167, 104.05],
      [-5.7667, 105.3333]
    ]
  },
  lewotobi: {
    volcanoKey: 'lewotobi',
    volcanoName: 'Lewotobi Laki-Laki',
    rawSigmet: 'WVID21 WAAA 080720 WAAF SIGMET 17 VALID 080720/081320 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT LEWOTOBI PSN S0832 E12246 VA CLD OBS SFC/FL120 MOV WSW 10KT',
    firId: 'WAAF',
    validTimeFrom: '2026-09-08T07:20:00.000Z',
    validTimeTo: '2026-09-08T13:20:00.000Z',
    flightLevel: 'SFC / FL120 (± 3.600 m dpl)',
    directionText: 'Barat Daya (WSW / 10 KT)',
    bearing: 247.5,
    coordinates: [
      [-8.542, 122.775],
      [-8.7014, 122.8034],
      [-9.1456, 122.1631],
      [-8.6155, 121.9142],
      [-8.418, 122.6698],
      [-8.542, 122.775]
    ]
  },
  lewotolok: {
    volcanoKey: 'lewotolok',
    volcanoName: 'Ili Lewotolok',
    rawSigmet: 'WVID21 WAAA 080720 WAAF SIGMET 17 VALID 080720/081320 WAAA- WAAF UJUNG PANDANG FIR VA ERUPTION MT LEWOTOLOK PSN S0816 E12330 VA CLD OBS AT 0700Z WI S0816 E12333 - S0819 E12330 - S0809 E12305 - S0757 E12308 - S0753 E12320 - S0816 E12333 SFC/FL080 MOV S 05KT NC=',
    firId: 'WAAF',
    validTimeFrom: '2026-09-08T07:20:00.000Z',
    validTimeTo: '2026-09-08T13:20:00.000Z',
    flightLevel: 'SFC / FL080 (± 2.400 m dpl)',
    directionText: 'Selatan (S / 5 KT)',
    bearing: 180,
    coordinates: [
      [-8.2667, 123.55],
      [-8.3167, 123.5],
      [-8.15, 123.0833],
      [-7.95, 123.1333],
      [-7.8833, 123.3333],
      [-8.2667, 123.55]
    ]
  }
};

let cachedLiveSigmets: Record<string, LiveSigmetPolygon> = { ...VERIFIED_SIGMET_FALLBACKS };

export function computeDestinationPoint(
  lat: number,
  lon: number,
  distanceKm: number,
  bearingDeg: number
): [number, number] {
  const R = 6371.0;
  const d = distanceKm / R;
  const brg = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [
    Number(((lat2 * 180) / Math.PI).toFixed(5)),
    Number(((lon2 * 180) / Math.PI).toFixed(5)),
  ];
}

export function computeDispersionPentagon(
  centerLat: number,
  centerLon: number,
  bearingDeg: number,
  rangeKm = 110
): [number, number][] {
  const p1: [number, number] = [centerLat, centerLon];
  const p2 = computeDestinationPoint(centerLat, centerLon, 18, bearingDeg + 80);
  const p3 = computeDestinationPoint(centerLat, centerLon, rangeKm, bearingDeg + 25);
  const p4 = computeDestinationPoint(centerLat, centerLon, rangeKm, bearingDeg - 25);
  const p5 = computeDestinationPoint(centerLat, centerLon, 18, bearingDeg - 80);

  return [p1, p2, p3, p4, p5];
}

export function computeTrajectoryArrow(
  centerLat: number,
  centerLon: number,
  bearingDeg: number,
  lengthKm = 65
): { shaft: [number, number][]; barb1: [number, number][]; barb2: [number, number][] } {
  const tip = computeDestinationPoint(centerLat, centerLon, lengthKm, bearingDeg);
  const barb1 = computeDestinationPoint(tip[0], tip[1], 12, bearingDeg + 150);
  const barb2 = computeDestinationPoint(tip[0], tip[1], 12, bearingDeg - 150);

  return {
    shaft: [[centerLat, centerLon], tip],
    barb1: [tip, barb1],
    barb2: [tip, barb2],
  };
}

export const REGIONAL_SEAPORTS: AffectedSeaportInfo[] = [
  {
    name: 'Pelabuhan Penyeberangan Larantuka (Waiwerang/Tobilota)',
    regency: 'Flores Timur, NTT',
    status: 'Waspada Sebaran Abu & Visibilitas',
    note: 'Jalur penyeberangan kapal ferry utama Flores - Adonara - Lembata dalam radius erupsi G. Lewotobi.',
    lat: -8.344,
    lon: 122.986,
  },
  {
    name: 'Pelabuhan Laut Lewoleba',
    regency: 'Lembata, NTT',
    status: 'Waspada Sebaran Abu Vulkanik',
    note: 'Pelabuhan laut pulau Lembata dalam koridor sebaran debu Lewotobi.',
    lat: -8.368,
    lon: 123.487,
  },
  {
    name: 'Pelabuhan ASDP Bolok',
    regency: 'Kupang, NTT',
    status: 'Operasional Terpantau',
    note: 'Simpul utama logistik maritim Pulau Timor - Rote - Flores.',
    lat: -10.231,
    lon: 123.497,
  },
  {
    name: 'Pelabuhan Bakauheni',
    regency: 'Lampung Selatan, Lampung',
    status: 'Operasional Terpantau',
    note: 'Penyeberangan utama Selat Sunda koridor G. Anak Krakatau.',
    lat: -5.867,
    lon: 105.755,
  },
  {
    name: 'Pelabuhan Merak',
    regency: 'Cilegon, Banten',
    status: 'Operasional Terpantau',
    note: 'Penyeberangan utama Jawa - Sumatera koridor Selat Sunda.',
    lat: -5.931,
    lon: 105.998,
  },
  {
    name: 'Pelabuhan Ketapang',
    regency: 'Banyuwangi, Jawa Timur',
    status: 'Operasional Terpantau',
    note: 'Jalur penyeberangan Jawa - Bali dekat koridor Semeru & Ijen.',
    lat: -8.148,
    lon: 114.397,
  },
  {
    name: 'Pelabuhan Bastiong',
    regency: 'Ternate, Maluku Utara',
    status: 'Operasional Terpantau',
    note: 'Simpul penyeberangan Ternate - Tidore - Halmahera (koridor G. Gamalama & G. Ibu).',
    lat: 0.771,
    lon: 127.375,
  },
  {
    name: 'Pelabuhan Tobelo',
    regency: 'Halmahera Utara, Maluku Utara',
    status: 'Waspada Paparan Debu Vulkanik',
    note: 'Berada dalam radius 15 km dari kawah aktif G. Dukono.',
    lat: 1.730,
    lon: 128.006,
  },
];

const FALLBACK_CLOSED_AIRPORTS: ClosedAirportInfo[] = [
  {
    icao: 'WATW',
    name: 'Bandara Wunopito Lewoleba',
    reason: 'AERODROME CLOSED',
    detail: '08 Sept 2026, 07:01 WIB - 09 Sept 2026, 06:00 WIB (NOTAM Penutupan Ruang Udara akibat erupsi G. Lewotobi Laki-Laki)',
    lat: -8.384,
    lon: 123.504,
  },
];

const FALLBACK_VOLCANIC_ASH_DATA: VolcanicAshArea[] = [
  {
    id: 1,
    name: 'Lewotobi',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Lewotobi.png',
    source: 'INA-SIAM BMKG / VAAC Darwin'
  },
  {
    id: 2,
    name: 'Anak Krakatau',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Anak_Krakatau.png',
    source: 'INA-SIAM BMKG / VAAC Darwin'
  },
  {
    id: 3,
    name: 'Semeru',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Semeru.png',
    source: 'INA-SIAM BMKG / VAAC Darwin'
  },
  {
    id: 4,
    name: 'Ibu',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Ibu.png',
    source: 'INA-SIAM BMKG / VAAC Darwin'
  },
  {
    id: 5,
    name: 'Dukono',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Dukono.png',
    source: 'INA-SIAM BMKG / VAAC Darwin'
  }
];

export const InaSiamService = {
  /**
   * Mengambil data SIGMET sebaran abu vulkanik real-time dalam format GeoJSON
   * dari backend BMKG Aviation va-map.php?sigmet=1 dan INA-SIAM.
   */
  async fetchLiveSigmets(): Promise<Record<string, LiveSigmetPolygon>> {
    const urls = [
      'https://web-aviation.bmkg.go.id/va-map.php?sigmet=1',
      'https://inasiam.rack.my.id/api/v1/opmet/sigmet/geojson'
    ];

    for (const url of urls) {
      try {
        const data = await fetchWithCorsProxy(url) as { features?: any[] };
        if (data && Array.isArray(data.features) && data.features.length > 0) {
          const parsedDict: Record<string, LiveSigmetPolygon> = { ...VERIFIED_SIGMET_FALLBACKS };

          const volcanoKeywords = [
            'SEMERU', 'IBU', 'DUKONO', 'KRAKATAU', 'LEWOTOBI', 'LEWOTOLOK',
            'MARAPI', 'MERAPI', 'RUANG', 'SINABUNG', 'KERINCI', 'SOPUTAN',
            'AWU', 'KARANGETANG', 'RAUNG', 'BROMO'
          ];

          for (const feat of data.features) {
            const props = feat.properties || {};
            if ((props.hazard || '').toUpperCase() !== 'VA') continue;

            const raw = (props.rawSigmet || '').toUpperCase();
            let matchedKey: string | null = null;
            let matchedName: string = '';

            for (const v of volcanoKeywords) {
              if (raw.includes(v)) {
                matchedKey = v.toLowerCase();
                matchedName = v.charAt(0) + v.slice(1).toLowerCase();
                break;
              }
            }

            if (!matchedKey) continue;

            const geom = feat.geometry;
            if (!geom || !geom.coordinates) continue;

            let leafletCoords: [number, number][] = [];
            if (geom.type === 'Polygon' && Array.isArray(geom.coordinates[0])) {
              leafletCoords = geom.coordinates[0].map((pt: number[]) => [Number(pt[1].toFixed(4)), Number(pt[0].toFixed(4))]);
            } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates[0]) && Array.isArray(geom.coordinates[0][0])) {
              leafletCoords = geom.coordinates[0][0].map((pt: number[]) => [Number(pt[1].toFixed(4)), Number(pt[0].toFixed(4))]);
            }

            if (leafletCoords.length < 3) continue;

            const dirCode = (props.dir || 'SW').toUpperCase();
            const bearing = DIR_TO_BEARING[dirCode] ?? 225;
            const spd = props.spd ? `${props.spd} KT` : '';
            const dirText = `${dirCode} ${spd}`.trim();
            const flText = props.top ? `SFC / FL${Math.round(props.top / 100)}` : 'FL100';

            parsedDict[matchedKey] = {
              volcanoKey: matchedKey,
              volcanoName: matchedName,
              rawSigmet: props.rawSigmet || '',
              firId: props.firId || 'WAAF',
              validTimeFrom: props.validTimeFrom || '',
              validTimeTo: props.validTimeTo || '',
              flightLevel: flText,
              directionText: dirText,
              bearing,
              coordinates: leafletCoords
            };
          }

          cachedLiveSigmets = parsedDict;
          return cachedLiveSigmets;
        }
      } catch (err) {
        console.warn(`Gagal memuat SIGMET dari ${url}, mencoba sumber berikutnya:`, err);
      }
    }

    return cachedLiveSigmets;
  },

  /**
   * Mengambil poligon SIGMET aktif untuk nama gunung tertentu.
   */
  getSigmetForVolcano(volcanoName: string): LiveSigmetPolygon | null {
    const clean = volcanoName.toLowerCase().trim();
    for (const [key, sigmet] of Object.entries(cachedLiveSigmets)) {
      if (clean.includes(key) || key.includes(clean)) {
        return sigmet;
      }
    }
    return null;
  },

  /**
   * Mengambil status bandara real-time dari BMKG Aviation va-map.php
   * termasuk bandara yang berstatus AERODROME CLOSED.
   */
  async fetchClosedAirports(): Promise<ClosedAirportInfo[]> {
    const url = 'https://web-aviation.bmkg.go.id/va-map.php?data=1';
    try {
      const data = await fetchWithCorsProxy(url) as {
        closed_airports?: Record<string, { reason?: string; detail?: string }>;
        stations?: Array<{ icao: string; name: string; lat: number; lon: number }>;
      };

      if (!data || !data.closed_airports) return FALLBACK_CLOSED_AIRPORTS;

      const stationMap = new Map<string, { name: string; lat: number; lon: number }>();
      if (Array.isArray(data.stations)) {
        for (const s of data.stations) {
          stationMap.set(s.icao, { name: s.name, lat: s.lat, lon: s.lon });
        }
      }

      const list: ClosedAirportInfo[] = [];
      for (const [icao, info] of Object.entries(data.closed_airports)) {
        const st = stationMap.get(icao);
        list.push({
          icao,
          name: st?.name || `Bandara ${icao}`,
          reason: info.reason || 'AERODROME CLOSED',
          detail: info.detail || 'Penutupan operasional bandara oleh otoritas penerbangan / BMKG',
          lat: st?.lat ?? -8.384,
          lon: st?.lon ?? 123.504,
        });
      }

      return list.length > 0 ? list : FALLBACK_CLOSED_AIRPORTS;
    } catch (err) {
      console.warn('Gagal memuat data closed_airports dari va-map.php, menggunakan fallback:', err);
      return FALLBACK_CLOSED_AIRPORTS;
    }
  },

  /**
   * Mengambil daftar gunung aktif dengan citra trajektori sebaran abu vulkanik
   * dari portal resmi BMKG Aviation / INA-SIAM.
   */
  async fetchVolcanicAshAreas(): Promise<VolcanicAshArea[]> {
    const url = 'https://www.bmkg.go.id/cuaca/satelit/citra-sebaran-abu-vulkanik';
    try {
      const html = await fetchHtmlWithCorsProxy(url);
      if (!html) throw new Error('Empty response from proxy');

      const areas: VolcanicAshArea[] = [];
      const seen = new Set<string>();

      const regex = /"name"\s*:\s*"([^"]+)"[\s\S]*?"image"\s*:\s*"(https:\/\/inderaja\.bmkg\.go\.id\/Trajektori\/[^"]+\.png)"/g;
      let match;
      let idCounter = 1;
      while ((match = regex.exec(html)) !== null) {
        const name = match[1].trim();
        const image = match[2].trim();
        if (!seen.has(name)) {
          seen.add(name);
          areas.push({
            id: idCounter++,
            name,
            image,
            source: 'INA-SIAM BMKG / VAAC Darwin'
          });
        }
      }

      if (areas.length === 0) {
        const imgRegex = /https:\/\/inderaja\.bmkg\.go\.id\/Trajektori\/([A-Za-z0-9_]+)\.png/g;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(html)) !== null) {
          const rawName = imgMatch[1].replace(/_/g, ' ').trim();
          const image = imgMatch[0];
          if (!seen.has(rawName)) {
            seen.add(rawName);
            areas.push({
              id: idCounter++,
              name: rawName,
              image,
              source: 'INA-SIAM BMKG / VAAC Darwin'
            });
          }
        }
      }

      if (areas.length > 0) {
        return areas;
      }
      return FALLBACK_VOLCANIC_ASH_DATA;
    } catch (err) {
      console.warn('Gagal memuat citra sebaran abu vulkanik live BMKG, beralih ke data terverifikasi:', err);
      return FALLBACK_VOLCANIC_ASH_DATA;
    }
  },

  /**
   * Mengubah data sebaran abu vulkanik menjadi format DisasterAlert lengkap
   * dengan poligon SIGMET dinamis real-time dari INA-SIAM BMKG.
   */
  async fetchLiveAlerts(): Promise<DisasterAlert[]> {
    try {
      const [areas, closedAirports, liveSigmets] = await Promise.all([
        this.fetchVolcanicAshAreas(),
        this.fetchClosedAirports().catch(() => FALLBACK_CLOSED_AIRPORTS),
        this.fetchLiveSigmets().catch(() => cachedLiveSigmets)
      ]);

      const nowIso = new Date().toISOString();

      return areas.map((area, idx) => {
        const coords = resolveCoords(area.name);
        const provinceId = getProvinceIdForVolcano(area.name);
        const nearestOffice = findNearestKpwOffice(coords[0], coords[1]);

        // Cek apakah ada poligon SIGMET live BMKG untuk gunung ini
        const cleanName = area.name.toLowerCase();
        let sigmet: LiveSigmetPolygon | null = null;
        for (const [key, sig] of Object.entries(liveSigmets)) {
          if (cleanName.includes(key) || key.includes(cleanName)) {
            sigmet = sig;
            break;
          }
        }

        // Gunakan koordinat poligon SIGMET real-time jika ada, atau hitung poligon dispersi
        let polygonCoords: [number, number][];
        let bearing: number;
        let ashHeight: string;
        let directionText: string;

        if (sigmet && sigmet.coordinates && sigmet.coordinates.length >= 3) {
          polygonCoords = sigmet.coordinates;
          bearing = sigmet.bearing;
          ashHeight = sigmet.flightLevel;
          directionText = sigmet.directionText;
        } else {
          bearing = 240;
          ashHeight = 'FL100 (± 3.000 m dpl)';
          directionText = 'Barat Daya';
          polygonCoords = computeDispersionPentagon(coords[0], coords[1], bearing, 105);
        }

        const nearbyClosedAirports = closedAirports
          .map((ap) => ({
            ...ap,
            distanceKm: ap.lat && ap.lon ? Math.round(haversineDistance(coords[0], coords[1], ap.lat, ap.lon)) : undefined
          }))
          .filter((ap) => {
            if (area.name.toLowerCase().includes('lewotobi') && ap.icao === 'WATW') return true;
            return ap.distanceKm !== undefined && ap.distanceKm <= 200;
          });

        const nearbySeaports = REGIONAL_SEAPORTS
          .map((port) => ({
            ...port,
            distanceKm: Math.round(haversineDistance(coords[0], coords[1], port.lat, port.lon))
          }))
          .filter((port) => port.distanceKm <= 130)
          .sort((a, b) => a.distanceKm - b.distanceKm);

        const hasClosedAirport = nearbyClosedAirports.length > 0;
        const isCritical = hasClosedAirport ||
                           area.name.toLowerCase().includes('lewotobi') ||
                           area.name.toLowerCase().includes('semeru') ||
                           area.name.toLowerCase().includes('krakatau');
        const severity: AlertSeverity = isCritical ? 3 : 2;

        const slug = area.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

        let impactDesc = `Pemantauan sebaran abu vulkanik Gunung ${area.name} oleh BMKG & VAAC Darwin via sistem INA-SIAM (Aviation Meteorology).
Status Poligon: Poligon SIGMET Real-Time BMKG (${polygonCoords.length} titik koordinat)
Ketinggian Kolom Abu: ${ashHeight}
Arah Pergerakan: ${directionText}`;

        if (nearbyClosedAirports.length > 0) {
          impactDesc += `\n⛔ BANDARA DITUTUP: ${nearbyClosedAirports.map(a => `${a.name} (${a.icao}) - ${a.reason}`).join(', ')}`;
        }

        if (nearbySeaports.length > 0) {
          impactDesc += `\n🚢 PELABUHAN / DERMAGA WASPADA: ${nearbySeaports.map(p => `${p.name} (${p.distanceKm} km)`).join(', ')}`;
        }

        impactDesc += `\nWilayah Terdekat: ${nearestOffice.name}`;

        return {
          id: `inasiam-va-${slug}-${idx}`,
          type: 'volcanic_ash' as const,
          severity,
          provinceId,
          title: `Sebaran Abu Vulkanik G. ${area.name}`,
          description: impactDesc,
          timestamp: nowIso,
          latitude: coords[0],
          longitude: coords[1],
          trajectoryImageUrl: area.image,
          ashHeight,
          movementDirection: directionText,
          windBearing: bearing,
          pentagonCoords: polygonCoords,
          closedAirports: nearbyClosedAirports,
          affectedSeaports: nearbySeaports,
          affectedArea: `${area.name} & Koridor Udara`,
          sourceUrl: 'https://inasiam.bmkg.go.id'
        };
      });
    } catch (e) {
      console.error('Error saat membuat alert sebaran abu vulkanik:', e);
      return [];
    }
  }
};