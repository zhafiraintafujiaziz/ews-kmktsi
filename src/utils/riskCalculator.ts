import type { DisasterAlert, DisasterEvent, AssessmentLevel, RiskLevel, MarkedLocation, RiskCalcResult, KpwbiOffice } from '../types';
import { haversineDistance } from './geo';
import { getAlertImpactRadiusKm, isOfficeAffectedByAlert } from './disasterImpact';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { resolveOfficeAssessment, type OfficeHazardAssessment } from './officeHazardAssessment';
import { isInaRiskHazardType, getHazardLevel } from '../constants/kerentananCategories';

/** Assessment availability and scoring support are separate from their source. */
export const isRiskScoredType = isInaRiskHazardType;
export const isInaRiskSupportedType = (type: string) => type === 'earthquake' || type === 'karhutla' || type === 'extreme_weather';

export interface OfficeAlertRisk {
  alert: DisasterAlert;
  assessmentScore: number | null;
  totalScore: number | null;
  isInaRiskSupported: boolean;
  assessment?: OfficeHazardAssessment;
}

export interface OfficeRiskEntry {
  riskLevel: RiskLevel;
  riskScore: number;
  alerts: DisasterAlert[];
}

/** Skor satu alert terhadap satu kantor, sama dengan kartu Tingkat Risiko. */
export function scoreAlertForOffice(officeId: string, alert: DisasterAlert, office = KPWBI_OFFICES.find(o => o.id === officeId)): OfficeAlertRisk {
  if (alert.type === 'air_quality') {
    // Normalize severity 1/2/3 to the shared 1-9 risk scale, without an InaRISK assessment.
    return { alert, assessmentScore: null, totalScore: alert.severity * 3, isInaRiskSupported: false };
  }
  const supported = isRiskScoredType(alert.type);
  const assessment = supported && office ? resolveOfficeAssessment(office, alert.type as import('../constants/kerentananCategories').InaRiskHazardType) : undefined;
  const assessmentScore = assessment?.factor ?? null;
  const totalScore = assessmentScore === null ? null : alert.severity * assessmentScore;
  return { alert, assessmentScore, totalScore, assessment, isInaRiskSupported: assessment?.source === 'InaRISK' };

}

/**
 * Risiko tertinggi tiap kantor dari alert yang memengaruhinya.
 * Kantor tanpa alert, atau dengan skor 0, tidak masuk peta.
 */
export function buildOfficeRiskMap(
  offices: KpwbiOffice[],
  alerts: DisasterAlert[],
): Map<string, OfficeRiskEntry> {
  const map = new Map<string, OfficeRiskEntry>();

  offices.forEach((office) => {
    const officeAlerts = alerts.filter((a) => isOfficeAffectedByAlert(office, a));
    if (officeAlerts.length === 0) return;

    let maxRiskScore = 0;
    officeAlerts.forEach((alert) => {
      const { totalScore } = scoreAlertForOffice(office.id, alert, office);
      if (totalScore !== null && totalScore > maxRiskScore) maxRiskScore = totalScore;
    });

    if (maxRiskScore > 0) {
      map.set(office.id, {
        riskLevel: getRiskLevel(maxRiskScore),
        riskScore: maxRiskScore,
        alerts: officeAlerts,
      });
    }
  });

  return map;
}

/**
 * Mengonversi enum string tingkat bahaya ke skor angka.
 * "Tinggi" = 3
 * "Sedang" = 2
 * "Rendah" = 1
 */
export function assessmentToScore(level: AssessmentLevel): number {
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
 * Menentukan tingkat risiko berdasarkan total skor risiko (disasterScore * assessmentScore).
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
  assessmentLevel: AssessmentLevel,
  locations: MarkedLocation[]
): RiskCalcResult {
  const assessmentScore = assessmentToScore(assessmentLevel);
  const riskScore = event.disasterScore * assessmentScore;
  const level = getRiskLevel(riskScore);
  const affectedLocations = findAffectedLocations(event, locations);

  // Notifikasi hanya boleh di-trigger jika KEDUA syarat terpenuhi:
  // 1. Skor hasil akhir berada di level Tinggi (7-9).
  // 2. Radius dampak bencana mencakup setidaknya satu dari titik lokasi yang sudah ditandai.
  const shouldAlert = level === 'Tinggi' && affectedLocations.length > 0;

  return {
    event,
    assessmentLevel,
    assessmentScore,
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
 * Mengonversi indeks bahaya dari InaRisk (0 - 1) ke enum AssessmentLevel.
 */
export function mapInariskToHazard(score: number): AssessmentLevel {
  return getHazardLevel(score);
}


export function buildAlertRiskResult(alert: DisasterAlert, offices: KpwbiOffice[]): RiskCalcResult | null {
  if (alert.isForecast) return null;
  const affected = offices.filter(office => isOfficeAffectedByAlert(office, alert));
  // Province warnings can have no source centroid. Use an affected office only
  // as the calculator's map anchor, leaving the source alert coordinates intact.
  const anchor = alert.type === 'extreme_weather' ? affected[0] : undefined;
  const event = mapAlertToDisasterEvent(alert) ?? (anchor ? mapAlertToDisasterEvent({ ...alert, latitude: anchor.latitude, longitude: anchor.longitude }) : null);
  if (!event) return null;
  const scored = affected.map(office => ({ office, risk: scoreAlertForOffice(office.id, alert, office) })).filter(item => item.risk.totalScore !== null && item.risk.totalScore > 0);
  if (!scored.length) return null;
  const worst = scored.reduce((a, b) => b.risk.totalScore! > a.risk.totalScore! ? b : a);
  const riskScore = worst.risk.totalScore!, riskLevel = getRiskLevel(riskScore);
  return { event, assessmentLevel: worst.risk.assessment?.level ?? null, assessmentScore: worst.risk.assessmentScore,
    riskScore, riskLevel, affectedLocations: scored.map(({ office }) => ({ id: office.id, name: office.name, latitude: office.latitude, longitude: office.longitude })),
    shouldAlert: riskLevel === 'Tinggi' };
}
