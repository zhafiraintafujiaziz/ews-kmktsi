export type DisasterType = 'earthquake' | 'flood' | 'volcanic' | 'volcanic_ash' | 'tsunami' | 'landslide' | 'extreme_weather' | 'karhutla' | 'kekeringan' | 'air_quality';

export type IspuCategory = 'BAIK' | 'SEDANG' | 'TIDAK SEHAT' | 'SANGAT TIDAK SEHAT' | 'BERBAHAYA';

export interface IspuStationInfo {
  idStasiun: string;
  nama: string;
  kota: string;
  provinsi: string;
  latitude: number;
  longitude: number;
  ispuValue: number;
  category: IspuCategory;
  dominantParam: string;
  waktuText: string;
  observedAt?: string;
  keterangan?: string;
  color?: string;
  distanceKm?: number;
}

export type AlertSeverity = 3 | 2 | 1;

export const VOLCANO_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  1: 'Waspada',
  2: 'Siaga',
  3: 'Awas',
};

export function severityToCssClass(s: AlertSeverity): 'critical' | 'warning' | 'watch' {
  return s === 3 ? 'critical' : s === 2 ? 'warning' : 'watch';
}

export const SEV_BOX_COUNT: Record<AlertSeverity, number> = { 3: 3, 2: 2, 1: 1 };

export interface Province {
  id: string;
  name: string;
  capital: string;
  latitude: number;
  longitude: number;
  island: string;
}

export interface KpwbiOffice {
  id: string;
  name: string;
  city: string;
  provinceId: string;
  latitude: number;
  longitude: number;
  region: string;
  isKorwil: boolean;
  isKantorPusat?: boolean;
  category: 'kpw' | 'korwil' | 'kantor_pusat' | 'dc' | 'drc';
}

export interface ClosedAirportInfo {
  icao: string;
  name: string;
  reason: string;
  detail: string;
  lat?: number;
  lon?: number;
  distanceKm?: number;
}

export interface AffectedSeaportInfo {
  name: string;
  regency: string;
  status: string;
  note: string;
  lat: number;
  lon: number;
  distanceKm?: number;
}

export interface DisasterAlert {
  id: string;
  type: DisasterType;
  severity: AlertSeverity;
  provinceId: string; // Links to Province.id
  title: string;
  description: string;
  timestamp: string; // ISO string or format
  validFrom?: string;
  validUntil?: string;
  sourceGeometry?: unknown;
  latitude?: number; // Epi-center or event latitude
  longitude?: number; // Epi-center or event longitude
  magnitude?: number; // Optional magnitude for earthquakes
  depth?: number; // Optional depth in km for earthquakes
  waterLevel?: number; // Optional water level in meters for floods
  affectedArea?: string; // Optional text describing local areas
  isForecast?: boolean;
  forecastDay?: number; // 1, 2, or 3
  forecastDateStr?: string; // e.g. "25 Jun 2026"
  trajectoryImageUrl?: string; // Volcanic ash trajectory satellite image URL
  ashHeight?: string; // Height of volcanic ash cloud
  movementDirection?: string; // Direction of volcanic ash movement
  windBearing?: number; // Degree bearing of ash dispersion
  pentagonCoords?: [number, number][]; // 5 vertices of INA-SIAM dispersion pentagon
  closedAirports?: ClosedAirportInfo[]; // Closed airports from web-aviation.bmkg.go.id
  affectedSeaports?: AffectedSeaportInfo[]; // Impacted regional seaports / docks
  hotspotCount?: number; // Hotspot count for karhutla
  satellites?: string[]; // Detecting satellites for karhutla
  sourceUrl?: string; // Reference link e.g. inasiam.bmkg.go.id
  ispuValue?: number; // ISPU score (KemenLH)
  ispuCategory?: IspuCategory; // Kategori resmi ISPU
  ispuParam?: string; // Polutan kritis e.g. PM2.5, PM10
  stationName?: string; // Nama stasiun pemantau SPKU
}

export type VolcanoLevel = 'IV' | 'III' | 'II' | 'I';

export interface VolcanoSeismicity {
  count: number;
  type: string;  // e.g. "gempa Letusan/Erupsi"
}

export interface VolcanoReport {
  no: number;
  name: string;
  visual: string;
  seismicity: VolcanoSeismicity[];
  recommendation: string;
  level: VolcanoLevel;
}

// === Perkiraan / Preparedness Types ===

export type { MegathrustZone } from '../constants/megathrustZones';
export type { RingOfFireArc, VolcanoPoint } from '../constants/ringOfFire';
export type { ChecklistItemDef, ChecklistStatus } from '../constants/preparednessChecklist';

// === Disaster Risk Calculator Types ===

export type AssessmentLevel = 'Tinggi' | 'Sedang' | 'Rendah';

export type RiskLevel = 'Tinggi' | 'Sedang' | 'Rendah';

export interface DisasterEvent {
  id: string;
  latitude: number;
  longitude: number;
  radiusKm: number;          // radius dampak bencana
  disasterScore: 1 | 2 | 3;  // skor bencana real-time
  type: DisasterType;
  title: string;
}

export interface MarkedLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface RiskCalcResult {
  event: DisasterEvent;
  assessmentLevel: AssessmentLevel | null; // null untuk ISPU atau penilaian yang belum tersedia
  assessmentScore: number | null; // 1, 2, atau 3; null jika penilaian tidak digunakan atau belum tersedia
  riskScore: number;          // 9 jika keparahan 3; selain itu keparahan × kerentanan (1–9)
  riskLevel: RiskLevel;       // skor 1–2 Rendah, 3–5 Sedang, 6–9 Tinggi
  affectedLocations: MarkedLocation[]; // lokasi terdampak dalam radius
  shouldAlert: boolean;       // true jika riskLevel "Tinggi" DAN ada lokasi terdampak
}


