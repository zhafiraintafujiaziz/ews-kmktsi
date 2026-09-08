export type DisasterType = 'earthquake' | 'flood' | 'volcanic' | 'volcanic_ash' | 'tsunami' | 'landslide' | 'extreme_weather' | 'karhutla' | 'kekeringan';

export type AlertSeverity = 3 | 2 | 1;

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
  sourceUrl?: string; // Reference link e.g. inasiam.bmkg.go.id
}

export type VolcanoLevel = 'III' | 'II' | 'I';

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
export type { EnsoPhase, EnsoMonth, EnsoOutlook } from '../constants/ensoData';
export type { ChecklistItemDef, ChecklistStatus } from '../constants/preparednessChecklist';

// === Disaster Risk Calculator Types ===

export type VulnerabilityLevel = 'Tinggi' | 'Sedang' | 'Rendah';

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
  vulnerabilityLevel: VulnerabilityLevel;
  vulnerabilityScore: number; // 1, 2, atau 3
  riskScore: number;          // disasterScore × vulnerabilityScore (1–9)
  riskLevel: RiskLevel;       // mapping dari riskScore
  affectedLocations: MarkedLocation[]; // lokasi terdampak dalam radius
  shouldAlert: boolean;       // true jika riskLevel "Tinggi" DAN ada lokasi terdampak
}


