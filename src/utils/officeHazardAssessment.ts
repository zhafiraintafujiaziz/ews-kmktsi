import type { AssessmentLevel, KpwbiOffice } from '../types';
import { getHazardLevel, type InaRiskCategory } from '../constants/kerentananCategories';
import { BnpbInariskService } from '../services/bnpbInariskService';
import { IspuService } from '../services/ispuService';
import { getNearestReferenceVolcano } from './volcanoReference';
import { KarhutlaRegionalService, type KarhutlaRegionalAssessment } from '../services/karhutlaRegionalService';
import { VOLCANO_REFERENCE_SOURCE } from '../constants/volcanoReferencePoints';

export interface OfficeHazardAssessment {
  source: 'InaRISK' | 'BMKG' | 'MAGMA / PVMBG' | 'ISPU' | 'Asumsi';
  sourceUrl: string;
  status: string;
  index: number | null;
  level: AssessmentLevel | null;
  factor: 0 | 1 | 2 | 3 | null;
  explanation: string;
  regional?: KarhutlaRegionalAssessment;
}
export function distanceFactor(distanceKm: number): 1 | 2 | 3 {
  return distanceKm <= 30 ? 3 : distanceKm <= 100 ? 2 : 1;
}
const indexForFactor = (factor: number) => factor === 3 ? 0.8 : factor === 2 ? 0.5 : factor === 1 ? 0.2 : 0;
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
  if (hazard === 'karhutla') {
    const regional = KarhutlaRegionalService.getOfficeAssessment(office.id);
    const statistics = regional?.statistics;
    const index = statistics?.mean ?? null, level = index === null ? null : getHazardLevel(index);
    return { source: 'InaRISK', sourceUrl: 'https://inarisk.bnpb.go.id/', status: regional?.status ?? 'loading', index, level,
      factor: level === null ? null : level === 'Tinggi' ? 3 : level === 'Sedang' ? 2 : 1, regional: regional ?? undefined,
      explanation: statistics ? 'Rata-rata raster InaRISK dalam radius 25 km: ' + statistics.mean.toFixed(2) + '. ' + statistics.validCellCount.toLocaleString('id-ID') + ' sel valid; cakupan ≈' + statistics.coveragePercent.toFixed(1) + '% wilayah. Rentang ' + statistics.min.toFixed(2) + '–' + statistics.max.toFixed(2) + '. NoData dikecualikan.'
        : regional?.status === 'error' ? 'Statistik raster InaRISK gagal dimuat. Coba hitung ulang.' : regional?.status === 'no_data' ? 'InaRISK tidak menyediakan sel raster valid dalam radius 25 km kantor ini.' : 'Menghitung rata-rata raster InaRISK dalam radius 25 km...' };
  }
  const index = BnpbInariskService.getLocalHazardIndex(office.id, hazard), level = index === null ? null : getHazardLevel(index);
  const status = BnpbInariskService.getAssessmentStatus(hazard).status;
  return { source: 'InaRISK', sourceUrl: 'https://inarisk.bnpb.go.id/', status: index === null ? status : 'available', index, level,
    factor: level === null ? null : level === 'Tinggi' ? 3 : level === 'Sedang' ? 2 : 1,
    explanation: index === null ? BnpbInariskService.getAssessmentMessage(hazard, office.id) : 'Indeks bahaya ' + (hazard === 'extreme_weather' ? 'Banjir ' : '') + 'InaRISK pada titik kantor: ' + index.toFixed(2) + '.' };
}
