import type { IspuCategory } from '../types';

export const ISPU_CATEGORIES = [
  { category: 'BAIK', label: 'Baik', range: '0-50', color: '#00cc00', textColor: '#000000' },
  { category: 'SEDANG', label: 'Sedang', range: '51-100', color: '#0000cc', textColor: '#ffffff' },
  { category: 'TIDAK SEHAT', label: 'Tidak Sehat', range: '101-200', color: '#cccc00', textColor: '#000000' },
  { category: 'SANGAT TIDAK SEHAT', label: 'Sangat Tidak Sehat', range: '201-300', color: '#cc0000', textColor: '#ffffff' },
  { category: 'BERBAHAYA', label: 'Berbahaya', range: '≥300', color: '#000000', textColor: '#ffffff' },
] as const;

export function getIspuCategory(value: number): IspuCategory {
  if (value >= 300) return 'BERBAHAYA';
  if (value > 200) return 'SANGAT TIDAK SEHAT';
  if (value > 100) return 'TIDAK SEHAT';
  if (value > 50) return 'SEDANG';
  return 'BAIK';
}

export function getIspuStyle(category: IspuCategory | string, value?: number) {
  const resolved = value !== undefined && Number.isFinite(value) && value >= 0
    ? getIspuCategory(value)
    : category.toUpperCase();
  return ISPU_CATEGORIES.find((entry) => entry.category === resolved) ?? ISPU_CATEGORIES[0];
}
