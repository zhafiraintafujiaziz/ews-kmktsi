import type { AssessmentLevel, KpwbiOffice } from '../types';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { getIspuCategory } from '../constants/ispuCategories';
import { getHazardLevel, type InaRiskCategory, type InaRiskHazardType } from '../constants/kerentananCategories';
import { resolveOfficeAssessment, type OfficeHazardAssessment } from './officeHazardAssessment';

export const MISSING_WEATHER_INDEX = 0.1;

interface KerentananSummaryItem {
  score: number | null;
  ispuAssessment: { ispuValue: number } | null;
}

export function getKerentananHighSummary(items: readonly KerentananSummaryItem[], hazard: InaRiskCategory, isLoading = false) {
  let availableCount = 0;
  let highCount = 0;
  for (const item of items) {
    const value = hazard === 'air_quality' ? item.ispuAssessment?.ispuValue : item.score;
    if (value == null || !Number.isFinite(value)) continue;
    availableCount++;
    if (hazard === 'air_quality' ? value >= 300 : getHazardLevel(value) === 'Tinggi') highCount++;
  }
  return {
    highCount,
    availableCount,
    status: availableCount > 0 ? 'available' : isLoading ? 'loading' : 'no_data',
  } as const;
}

function ispuBand(value: number): AssessmentLevel {
  const category = getIspuCategory(value);
  if (category === 'BERBAHAYA' || category === 'SANGAT TIDAK SEHAT') return 'Tinggi';
  if (category === 'TIDAK SEHAT' || category === 'SEDANG') return 'Sedang';
  return 'Rendah';
}

export function getKerentananHeaderBand(items: readonly KerentananSummaryItem[], hazard: InaRiskCategory, isLoading = false) {
  const counts: Record<AssessmentLevel, number> = { Tinggi: 0, Sedang: 0, Rendah: 0 };
  for (const item of items) {
    const value = hazard === 'air_quality' ? item.ispuAssessment?.ispuValue : item.score;
    if (value == null || !Number.isFinite(value)) continue;
    counts[hazard === 'air_quality' ? ispuBand(value) : getHazardLevel(value)]++;
  }
  const availableCount = counts.Tinggi + counts.Sedang + counts.Rendah;
  const level: AssessmentLevel | null = counts.Tinggi > 0 ? 'Tinggi' : counts.Sedang > 0 ? 'Sedang' : availableCount > 0 ? 'Rendah' : null;
  return {
    level,
    count: level ? counts[level] : 0,
    status: availableCount > 0 ? 'available' : isLoading ? 'loading' : 'no_data',
  } as const;
}

export function resolveKerentananOfficeAssessment(office: KpwbiOffice, hazard: InaRiskCategory): OfficeHazardAssessment {
  const assessment = resolveOfficeAssessment(office, hazard);
  if (hazard !== 'extreme_weather' || assessment.index !== null) return assessment;
  return {
    ...assessment,
    source: 'Asumsi',
    sourceUrl: '',
    status: 'assumed',
    index: MISSING_WEATHER_INDEX,
    level: 'Rendah',
    factor: 1,
    explanation: 'Data Cuaca tidak tersedia pada titik kantor ini. Indeks diasumsikan 0.10, kategori Rendah.',
  };
}

export function getKerentananProvinceAssessment(provinceId: string, hazard: InaRiskHazardType) {
  const values = KPWBI_OFFICES.filter(office => office.provinceId === provinceId)
    .map(office => resolveOfficeAssessment(office, hazard).index)
    .filter((value): value is number => value !== null);
  const assumed = hazard === 'extreme_weather' && values.length === 0;
  return {
    index: values.length > 0 ? Math.max(...values) : assumed ? MISSING_WEATHER_INDEX : null,
    assumed,
  };
}
