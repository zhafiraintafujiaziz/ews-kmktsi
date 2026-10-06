import type { KpwbiOffice } from '../types';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import type { InaRiskCategory, InaRiskHazardType } from '../constants/kerentananCategories';
import { resolveOfficeAssessment, type OfficeHazardAssessment } from './officeHazardAssessment';

export const MISSING_WEATHER_INDEX = 0.1;

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
