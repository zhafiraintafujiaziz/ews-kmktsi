import type { DisasterAlert, AlertSeverity, ClosedAirportInfo } from '../types';
import { fetchWithCorsProxy } from './proxy';
import { findNearestKpwOffice } from '../utils/geo';
import { getProvinceIdForVolcano } from './magmaService';

export interface LiveSigmetPolygon {
  volcanoKey: string;
  volcanoName: string;
  rawSigmet: string;
  firId: string;
  validTimeFrom: string;
  validTimeTo: string;
  flightLevel?: string;
  directionText?: string;
  bearing?: number;
  coordinates: [number, number][];
  sourceGeometry: unknown;
}

const DIR_TO_BEARING: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};
const VOLCANO_KEYWORDS = [
  'SEMERU', 'IBU', 'DUKONO', 'KRAKATAU', 'LEWOTOBI', 'LEWOTOLOK', 'MARAPI', 'MERAPI',
  'RUANG', 'SINABUNG', 'KERINCI', 'SOPUTAN', 'AWU', 'KARANGETANG', 'RAUNG', 'BROMO',
];

let currentSigmets: Record<string, LiveSigmetPolygon> = {};

function isActivePeriod(from: unknown, to: unknown, now = Date.now()): from is string {
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  const startsAt = Date.parse(from);
  const endsAt = Date.parse(to);
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && endsAt >= now;
}

function extractPolygon(geometry: unknown): [number, number][] {
  if (!geometry || typeof geometry !== 'object' || !('coordinates' in geometry) || !Array.isArray(geometry.coordinates)) return [];
  const geo = geometry as { type?: unknown; coordinates: unknown[] };
  const ring = geo.type === 'Polygon' ? geo.coordinates[0]
    : geo.type === 'MultiPolygon' ? (geo.coordinates[0] as unknown[] | undefined)?.[0]
      : null;
  if (!Array.isArray(ring)) return [];
  return ring
    .filter((point: unknown): point is number[] => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [point[1], point[0]] as [number, number]);
}

function centroid(points: [number, number][]): [number, number] | null {
  if (points.length < 3) return null;
  const count = points.length;
  return [points.reduce((sum, point) => sum + point[0], 0) / count, points.reduce((sum, point) => sum + point[1], 0) / count];
}

export function computeTrajectoryArrow(
  centerLat: number,
  centerLon: number,
  bearingDeg: number,
  lengthKm = 65,
): { shaft: [number, number][]; barb1: [number, number][]; barb2: [number, number][] } {
  const destination = (lat: number, lon: number, distanceKm: number, bearing: number): [number, number] => {
    const radius = 6371;
    const angular = distanceKm / radius;
    const direction = bearing * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(direction));
    const lon2 = lon1 + Math.atan2(Math.sin(direction) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
  };
  const tip = destination(centerLat, centerLon, lengthKm, bearingDeg);
  return {
    shaft: [[centerLat, centerLon], tip],
    barb1: [tip, destination(tip[0], tip[1], 12, bearingDeg + 150)],
    barb2: [tip, destination(tip[0], tip[1], 12, bearingDeg - 150)],
  };
}

export const InaSiamService = {
  async fetchLiveSigmets(): Promise<Record<string, LiveSigmetPolygon>> {
    const urls = [
      'https://web-aviation.bmkg.go.id/va-map.php?sigmet=1',
      'https://inasiam.rack.my.id/api/v1/opmet/sigmet/geojson',
    ];
    let lastError: unknown;
    for (const url of urls) {
      try {
        const data = await fetchWithCorsProxy(url) as { features?: unknown[] };
        if (!Array.isArray(data.features)) throw new Error('SIGMET response has no features array');
        const current: Record<string, LiveSigmetPolygon> = {};
        for (const featureValue of data.features) {
          if (!featureValue || typeof featureValue !== 'object') continue;
          const feature = featureValue as { properties?: Record<string, unknown>; geometry?: unknown };
          const properties = feature.properties || {};
          if (typeof properties.hazard !== 'string' || properties.hazard.toUpperCase() !== 'VA') continue;
          const rawSigmet = String(properties.rawSigmet || '');
          const keyword = VOLCANO_KEYWORDS.find((name) => rawSigmet.toUpperCase().includes(name));
          const validTimeFrom = properties.validTimeFrom;
          const validTimeTo = properties.validTimeTo;
          if (typeof validTimeFrom !== 'string' || typeof validTimeTo !== 'string' || !keyword || !isActivePeriod(validTimeFrom, validTimeTo)) continue;
          const coordinates = extractPolygon(feature.geometry);
          if (coordinates.length < 4) continue;
          const direction = String(properties.dir || '').toUpperCase();
          const bearing = DIR_TO_BEARING[direction];
          current[keyword.toLowerCase()] = {
            volcanoKey: keyword.toLowerCase(),
            volcanoName: keyword.split(' ').map((part) => `${part[0]}${part.slice(1).toLowerCase()}`).join(' '),
            rawSigmet,
            firId: String(properties.firId || ''),
            validTimeFrom,
            validTimeTo,
            ...(Number.isFinite(Number(properties.top)) ? { flightLevel: `FL${Math.round(Number(properties.top) / 100)}` } : {}),
            ...(bearing !== undefined ? { bearing, directionText: `${direction}${properties.spd ? ` ${properties.spd} KT` : ''}` } : {}),
            coordinates,
            sourceGeometry: feature.geometry,
          };
        }
        currentSigmets = current;
        return current;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Unable to load current SIGMET data');
  },

  getSigmetForVolcano(volcanoName: string): LiveSigmetPolygon | null {
    const name = volcanoName.toLowerCase();
    return Object.values(currentSigmets).find((sigmet) =>
      name.includes(sigmet.volcanoKey) || sigmet.volcanoKey.includes(name)
    ) || null;
  },

  async fetchClosedAirports(): Promise<ClosedAirportInfo[]> {
    const data = await fetchWithCorsProxy('https://web-aviation.bmkg.go.id/va-map.php?data=1') as {
      closed_airports?: Record<string, { reason?: string; detail?: string; valid_from?: string; valid_to?: string }>;
      stations?: Array<{ icao: string; name: string; lat?: number; lon?: number }>;
    };
    const stations = new Map((data.stations || []).map((station) => [station.icao, station]));
    return Object.entries(data.closed_airports || {}).flatMap(([icao, info]) => {
      if (!isActivePeriod(info.valid_from, info.valid_to)) return [];
      const station = stations.get(icao);
      return [{
        icao,
        name: station?.name || `Bandara ${icao}`,
        reason: info.reason || 'AERODROME CLOSED',
        detail: info.detail || '',
        ...(Number.isFinite(station?.lat) && Number.isFinite(station?.lon) ? { lat: station!.lat, lon: station!.lon } : {}),
      }];
    });
  },

  async fetchLiveAlerts(): Promise<DisasterAlert[]> {
    const sigmets = await this.fetchLiveSigmets();
    return Object.values(sigmets).flatMap((sigmet) => {
      const center = centroid(sigmet.coordinates);
      if (!center) return [];
      const nearestOffice = findNearestKpwOffice(center[0], center[1]);
      const alert: DisasterAlert = {
        id: `inasiam-va-${sigmet.volcanoKey}-${sigmet.validTimeFrom}`,
        type: 'volcanic_ash',
        severity: 2 as AlertSeverity,
        provinceId: nearestOffice.provinceId || getProvinceIdForVolcano(sigmet.volcanoName),
        title: `Volcanic ash SIGMET: ${sigmet.volcanoName}`,
        description: sigmet.rawSigmet,
        timestamp: sigmet.validTimeFrom,
        validFrom: sigmet.validTimeFrom,
        validUntil: sigmet.validTimeTo,
        latitude: center[0],
        longitude: center[1],
        sourceGeometry: sigmet.sourceGeometry,
        pentagonCoords: sigmet.coordinates,
        ...(sigmet.flightLevel ? { ashHeight: sigmet.flightLevel } : {}),
        ...(sigmet.directionText ? { movementDirection: sigmet.directionText } : {}),
        ...(sigmet.bearing !== undefined ? { windBearing: sigmet.bearing } : {}),
        sourceUrl: 'https://web-aviation.bmkg.go.id/va-map.php?sigmet=1',
      };
      return [alert];
    });
  },

};
