import type { DisasterAlert, DisasterEvent, AssessmentLevel, RiskLevel, MarkedLocation, RiskCalcResult, KpwbiOffice } from '../types';
import { haversineDistance } from './geo';
import { getAlertImpactRadiusKm, isOfficeAffectedByAlert } from './disasterImpact';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import type { OfficeHazardAssessment } from './officeHazardAssessment';
import { resolveKerentananOfficeAssessment } from './kerentananAssessment';
import { isInaRiskHazardType, getHazardLevel } from '../constants/kerentananCategories';

/** Assessment availability and scoring support are separate from their source. */
export const isRiskScoredType = isInaRiskHazardType;
export const isInaRiskSupportedType = (type: string) => type === 'earthquake' || type === 'karhutla' || type === 'extreme_weather';

export interface OfficeAlertRisk {
  alert: DisasterAlert;
  assessmentScore: number | null;
  totalScore: number | null;
  riskLevel: RiskLevel | null;
  isInaRiskSupported: boolean;
  assessment?: OfficeHazardAssessment;
}

export interface OfficeRiskEntry {
  riskLevel: RiskLevel;
  riskScore: number;
  alerts: DisasterAlert[];
}

/** Severity 3 overrides multiplication, including a missing assessment. */
export function calculateRiskScore(severity: number, assessmentScore: number): number;
export function calculateRiskScore(severity: number, assessmentScore: number | null): number | null;
export function calculateRiskScore(severity: number, assessmentScore: number | null): number | null {
  if (severity === 3) return 9;
  return assessmentScore === null ? null : severity * assessmentScore;
}

/** Skor satu alert terhadap satu kantor, sama dengan kartu Tingkat Risiko. */
export function scoreAlertForOffice(officeId: string, alert: DisasterAlert, office = KPWBI_OFFICES.find(o => o.id === officeId)): OfficeAlertRisk {
  if (alert.type === 'air_quality') {
    // ISPU uses severity for both inputs; there is no separate vulnerability assessment.
    const totalScore = calculateRiskScore(alert.severity, alert.severity);
    return { alert, assessmentScore: null, totalScore, riskLevel: getRiskLevel(totalScore), isInaRiskSupported: false };
  }
  const supported = isRiskScoredType(alert.type);
  const assessment = supported && office ? resolveKerentananOfficeAssessment(office, alert.type as import('../constants/kerentananCategories').InaRiskHazardType) : undefined;
  const assessmentScore = assessment?.factor ?? null;
  const totalScore = supported ? calculateRiskScore(alert.severity, assessmentScore) : null;
  const riskLevel = getRiskLevel(totalScore);
  return { alert, assessmentScore, totalScore, riskLevel, assessment, isInaRiskSupported: assessment?.source === 'InaRISK' };

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

    let highestRisk: OfficeAlertRisk | null = null;
    for (const alert of officeAlerts) {
      const risk = scoreAlertForOffice(office.id, alert, office);
      if (risk.totalScore !== null && risk.totalScore > 0 && risk.riskLevel !== null
        && (highestRisk === null || compareOfficeAlertRisk(risk, highestRisk) > 0)) highestRisk = risk;
    }

    if (highestRisk !== null && highestRisk.totalScore !== null && highestRisk.riskLevel !== null) {
      map.set(office.id, {
        riskLevel: highestRisk.riskLevel,
        riskScore: highestRisk.totalScore,
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

/** Final score bands: 1–2 Rendah, 3–5 Sedang, 6–9 Tinggi; missing scores stay unavailable. */
export function getRiskLevel(score: number): RiskLevel;
export function getRiskLevel(score: number | null): RiskLevel | null;
export function getRiskLevel(score: number | null): RiskLevel | null {
  if (score === null) return null;
  if (score >= 6) return 'Tinggi';
  if (score >= 3) return 'Sedang';
  return 'Rendah';
}

/** Highest final score wins; equal scores have the same category. */
export function compareOfficeAlertRisk(a: OfficeAlertRisk, b: OfficeAlertRisk): number {
  return (a.totalScore ?? -1) - (b.totalScore ?? -1);
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
  const assessmentScore = event.type === 'air_quality' ? null : assessmentToScore(assessmentLevel);
  const riskScore = calculateRiskScore(event.disasterScore, assessmentScore ?? event.disasterScore);
  const level = getRiskLevel(riskScore);
  const affectedLocations = findAffectedLocations(event, locations);

  // Notifikasi hanya boleh di-trigger jika KEDUA syarat terpenuhi:
  // 1. Skor akhir berada di level Tinggi (6–9).
  // 2. Radius dampak bencana mencakup setidaknya satu dari titik lokasi yang sudah ditandai.
  const shouldAlert = level === 'Tinggi' && affectedLocations.length > 0;

  return {
    event,
    assessmentLevel: event.type === 'air_quality' ? null : assessmentLevel,
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
  const scored = affected.map(office => ({ office, risk: scoreAlertForOffice(office.id, alert, office) })).filter(item => item.risk.totalScore !== null && item.risk.totalScore > 0 && item.risk.riskLevel !== null);
  if (!scored.length) return null;
  const worst = scored.reduce((a, b) => compareOfficeAlertRisk(b.risk, a.risk) > 0 ? b : a);
  const { totalScore: riskScore, riskLevel } = worst.risk;
  if (riskScore === null || riskLevel === null) return null;
  return { event, assessmentLevel: worst.risk.assessment?.level ?? null, assessmentScore: worst.risk.assessmentScore,
    riskScore, riskLevel, affectedLocations: scored.map(({ office }) => ({ id: office.id, name: office.name, latitude: office.latitude, longitude: office.longitude })),
    shouldAlert: riskLevel === 'Tinggi' };
}
