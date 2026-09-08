import type { DisasterAlert, DisasterEvent, VulnerabilityLevel, RiskLevel, MarkedLocation, RiskCalcResult } from '../types';
import { haversineDistance } from './geo';
import { getAlertImpactRadiusKm } from './disasterImpact';

/**
 * Mengonversi enum string tingkat kerentanan ke skor angka.
 * "Tinggi" = 3
 * "Sedang" = 2
 * "Rendah" = 1
 */
export function vulnerabilityToScore(level: VulnerabilityLevel): number {
  switch (level) {
    case 'Tinggi':
      return 3;
    case 'Sedang':
      return 2;
    case 'Rendah':
      return 1;
    default:
      return 1;
  }
}

/**
 * Menentukan tingkat risiko berdasarkan total skor risiko (disasterScore * vulnerabilityScore).
 * 1 - 3: Rendah
 * 4 - 6: Sedang
 * 7 - 9: Tinggi
 */
export function getRiskLevel(score: number): RiskLevel {
  if (score >= 7) return 'Tinggi';
  if (score >= 4) return 'Sedang';
  return 'Rendah';
}

/**
 * Mengecek apakah lokasi target berada di dalam radius dampak bencana (menggunakan rumus Haversine).
 */
export function isLocationInRadius(
  centerLat: number,
  centerLon: number,
  targetLat: number,
  targetLon: number,
  radiusKm: number
): boolean {
  if (isNaN(centerLat) || isNaN(centerLon) || isNaN(targetLat) || isNaN(targetLon)) {
    return false;
  }
  const distance = haversineDistance(centerLat, centerLon, targetLat, targetLon);
  return distance <= radiusKm;
}

/**
 * Mencari semua lokasi terdaftar yang terdampak oleh bencana.
 */
export function findAffectedLocations(
  event: DisasterEvent,
  locations: MarkedLocation[]
): MarkedLocation[] {
  return locations.filter((loc) =>
    isLocationInRadius(event.latitude, event.longitude, loc.latitude, loc.longitude, event.radiusKm)
  );
}

/**
 * Melakukan kalkulasi risiko bencana secara keseluruhan.
 */
export function calculateRisk(
  event: DisasterEvent,
  vulnerabilityLevel: VulnerabilityLevel,
  locations: MarkedLocation[]
): RiskCalcResult {
  const vulnerabilityScore = vulnerabilityToScore(vulnerabilityLevel);
  const riskScore = event.disasterScore * vulnerabilityScore;
  const level = getRiskLevel(riskScore);
  const affectedLocations = findAffectedLocations(event, locations);

  // Notifikasi hanya boleh di-trigger jika KEDUA syarat terpenuhi:
  // 1. Skor hasil akhir berada di level Tinggi (7-9).
  // 2. Radius dampak bencana mencakup setidaknya satu dari titik lokasi yang sudah ditandai.
  const shouldAlert = level === 'Tinggi' && affectedLocations.length > 0;

  return {
    event,
    vulnerabilityLevel,
    vulnerabilityScore,
    riskScore,
    riskLevel: level,
    affectedLocations,
    shouldAlert,
  };
}

/**
 * Mengonversi objek DisasterAlert ke DisasterEvent untuk kalkulator risiko.
 */
export function mapAlertToDisasterEvent(alert: DisasterAlert): DisasterEvent | null {
  if (alert.latitude === undefined || alert.longitude === undefined || isNaN(alert.latitude) || isNaN(alert.longitude)) {
    return null;
  }

  let disasterScore: 1 | 2 | 3 = 1;
  if (alert.severity === 3) {
    disasterScore = 3;
  } else if (alert.severity === 2) {
    disasterScore = 2;
  }

  const radiusKm = getAlertImpactRadiusKm(alert);

  return {
    id: alert.id,
    latitude: alert.latitude,
    longitude: alert.longitude,
    radiusKm,
    disasterScore,
    type: alert.type,
    title: alert.title,
  };
}

/**
 * Mengonversi indeks kerentanan dari InaRisk (0 - 1) ke enum VulnerabilityLevel.
 */
export function mapInariskToVulnerability(score: number): VulnerabilityLevel {
  const val = Math.round(score * 100);
  if (val >= 61) return 'Tinggi';
  if (val >= 31) return 'Sedang';
  return 'Rendah';
}

/**
 * Memetakan tipe bencana umum ke salah satu dari 4 parameter bahaya InaRisk.
 */
export function mapDisasterTypeToInariskHazard(
  type: string
): 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' {
  switch (type) {
    case 'flood':
    case 'landslide':
    case 'extreme_weather':
      return 'flood';
    case 'tsunami':
    case 'earthquake':
      return 'tsunami';
    case 'volcanic':
    case 'volcanic_ash':
      return 'volcanic';
    case 'kekeringan':
    case 'karhutla':
      return 'kekeringan';
    default:
      return 'flood';
  }
}

