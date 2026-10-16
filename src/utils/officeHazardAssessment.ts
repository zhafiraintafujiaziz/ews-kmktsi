import type { AssessmentLevel, KpwbiOffice } from '../types';
import { getHazardLevel, type InaRiskCategory } from '../constants/kerentananCategories';
import { IspuService } from '../services/ispuService';
import { getNearestReferenceVolcano } from './volcanoReference';
import { VOLCANO_REFERENCE_SOURCE } from '../constants/volcanoReferencePoints';
import { BnpbIrbiService, type IrbiCategory } from '../services/bnpbIrbiService';
import { OFFICE_IRBI_REGION } from '../constants/officeIrbiRegion';
import { getIrbiLevel } from '../constants/irbiRiskClass';

export interface OfficeHazardAssessment {
  source: 'InaRISK' | 'BMKG' | 'MAGMA / PVMBG' | 'ISPU' | 'Asumsi';
  sourceUrl: string;
  status: string;
  index: number | null;
  level: AssessmentLevel | null;
  factor: 0 | 1 | 2 | 3 | null;
  explanation: string;
}
export function distanceFactor(distanceKm: number): 1 | 2 | 3 {
  return distanceKm <= 30 ? 3 : distanceKm <= 100 ? 2 : 1;
}
const indexForFactor = (factor: number) => factor === 3 ? 0.8 : factor === 2 ? 0.5 : factor === 1 ? 0.2 : 0;
const factorForLevel = (level: AssessmentLevel | null): 0 | 1 | 2 | 3 | null =>
  level === null ? null : level === 'Tinggi' ? 3 : level === 'Sedang' ? 2 : 1;

/** Gempa, Cuaca, and Karhutla use the BNPB IRBI kelas risiko per kabupaten/kota. */
const IRBI_CATEGORIES: Record<'earthquake' | 'extreme_weather' | 'karhutla', string> = {
  earthquake: 'Gempa',
  extreme_weather: 'Cuaca',
  karhutla: 'Karhutla',
};

function resolveIrbiAssessment(office: KpwbiOffice, category: IrbiCategory) {
  const index = BnpbIrbiService.getIndex(office.id, category);
  const level = index === null ? null : getIrbiLevel(index);
  const region = OFFICE_IRBI_REGION[office.id];
  const status = BnpbIrbiService.getAssessmentStatus(category).status;
  return { source: 'InaRISK' as const, sourceUrl: 'https://inarisk.bnpb.go.id/irbi', status: index === null ? status : 'available', index, level,
    factor: factorForLevel(level),
    explanation: index === null ? BnpbIrbiService.getAssessmentMessage(category, office.id)
      : 'Kelas risiko IRBI ' + IRBI_CATEGORIES[category] + (region ? ' ' + region.kabupaten : '') + ': indeks ternormalisasi ' + index.toFixed(2) + ', kategori ' + level + '. Sumber: BNPB IRBI.' };
}

export function resolveOfficeAssessment(office: KpwbiOffice, hazard: InaRiskCategory): OfficeHazardAssessment {
  if (hazard === 'volcanic' || hazard === 'volcanic_ash') {
    const nearest = getNearestReferenceVolcano(office.latitude, office.longitude);
    const factor = distanceFactor(nearest.distanceKm), index = indexForFactor(factor);
    const bands = 'Tinggi ≤30 km; Sedang >30–100 km; Rendah >100 km.';
    return { source: 'MAGMA / PVMBG', sourceUrl: VOLCANO_REFERENCE_SOURCE, status: 'available', index, factor, level: getHazardLevel(index),
      explanation: 'Estimasi kerentanan geografis. Gunung api terdekat: G. ' + nearest.volcano.name + ', ' + nearest.distanceKm.toFixed(2) + ' km. ' + bands + ' Bukan zona bahaya resmi atau prakiraan sebaran abu.' };
  }
  if (hazard === 'air_quality') {
    const assessment = IspuService.getOfficeIspuAssessment(office.id), index = assessment?.score ?? null;
    return { source: 'ISPU', sourceUrl: 'https://ispu.kemenlh.go.id/webv5/#/', status: assessment ? 'available' : 'no_data', index,
      factor: null, level: null, explanation: assessment ? 'SPKU: ' + assessment.stationName + ', ' + assessment.distanceKm + ' km. ISPU ' + assessment.ispuValue + ', ' + assessment.category : 'Data ISPU tidak tersedia.' };
  }
  return resolveIrbiAssessment(office, hazard);
}
