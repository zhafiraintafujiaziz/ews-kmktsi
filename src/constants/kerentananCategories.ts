import type { DisasterType, AssessmentLevel } from '../types';

export const INARISK_HAZARD_SERVICES = {
  earthquake: 'layer_bahaya_gempabumi/MapServer',
  extreme_weather: 'layer_bahaya_banjir/ImageServer',
  karhutla: 'layer_bahaya_kebakaran_hutan_dan_lahan/ImageServer',
  volcanic: 'layer_bahaya_letusan_gunungapi/ImageServer',
} as const;

export type InaRiskSourceType = keyof typeof INARISK_HAZARD_SERVICES;
export type InaRiskHazardType = InaRiskSourceType | 'volcanic_ash';
export type InaRiskCategory = InaRiskHazardType | 'air_quality';

export const INARISK_CATEGORIES: { key: InaRiskCategory; label: string; inariskLabel?: string }[] = [
  { key: 'earthquake', label: 'Gempa', inariskLabel: 'Gempabumi' },
  { key: 'extreme_weather', label: 'Cuaca', inariskLabel: 'Banjir' },
  { key: 'karhutla', label: 'Karhutla', inariskLabel: 'Kebakaran Hutan dan Lahan' },
  { key: 'volcanic', label: 'Gunung Api', inariskLabel: 'Letusan Gunung Api' },
  { key: 'volcanic_ash', label: 'Abu Vulkanik', inariskLabel: 'Letusan Gunung Api' },
  { key: 'air_quality', label: 'Kualitas Udara' },
];

export function isInaRiskHazardType(type: string): type is InaRiskHazardType {
  return type === 'volcanic_ash' || Object.hasOwn(INARISK_HAZARD_SERVICES, type);
}

export function resolveInaRiskSource(type: InaRiskHazardType): InaRiskSourceType {
  return type === 'volcanic_ash' ? 'volcanic' : type;
}

export function getInaRiskCategory(type: DisasterType | 'all') {
  return INARISK_CATEGORIES.find((category) => category.key === type);
}

export function getHazardLevel(index: number): AssessmentLevel {
  return index > 0.6 ? 'Tinggi' : index > 0.3 ? 'Sedang' : 'Rendah';
}

export function getHazardSeverity(index: number): 1 | 2 | 3 {
  const level = getHazardLevel(index);
  return level === 'Tinggi' ? 3 : level === 'Sedang' ? 2 : 1;
}
