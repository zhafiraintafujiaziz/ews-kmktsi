import { VOLCANO_REFERENCE_POINTS } from '../constants/volcanoReferencePoints';
import type { InaRiskAssessmentStatus } from '../services/bnpbInariskService';
import { haversineDistance } from './geo';

export function shouldShowVolcanoReference(hazard: string, status: InaRiskAssessmentStatus | null): boolean {
  return (hazard === 'volcanic' || hazard === 'volcanic_ash') && status !== null && status.valueCount === 0;
}

export function getNearestReferenceVolcano(latitude: number, longitude: number) {
  return VOLCANO_REFERENCE_POINTS.map(volcano => ({
    volcano,
    distanceKm: haversineDistance(latitude, longitude, volcano.latitude, volcano.longitude),
  })).reduce((nearest, candidate) => candidate.distanceKm < nearest.distanceKm ? candidate : nearest);
}
