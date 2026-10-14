export type SourceMethod = 'website' | 'api';
export interface IqairLocation {
  id: string;
  province: string;
  city?: string;
  websiteUrl?: string;
  apiState?: string;
  apiCity?: string;
}
export interface Measurement { value: number; unit: string }
export interface IqairReading {
  location: IqairLocation;
  sourceMethod: SourceMethod;
  sourceUrl: string;
  retrievedAt: string;
  observedAt?: string;
  weatherObservedAt?: string;
  coordinates?: [number, number];
  index: { value: number; scale: string; category?: string; dominantPollutant?: string };
  chinaIndex?: { value: number; dominantPollutant?: string };
  concentrations?: Record<string, Measurement>;
  weather?: Record<string, Measurement | string>;
  forecast?: { at: string; index?: number; scale?: string; weather?: Record<string, Measurement> }[];
  stations?: number;
  contributors?: number;
}
export interface IqairResult {
  reading?: IqairReading;
  delivery: 'live' | 'cache' | 'unavailable';
  freshness: 'current' | 'outdated' | 'unknown';
  message?: string;
}
export interface IqairDirectory {
  locations: IqairLocation[];
  provinces?: IqairLocation[];
  crawl?: { status: 'pending' | 'complete' | 'paused'; completedPages: number; totalPages: number; retryAt?: string };
  message?: string;
}
export const JAKARTA: IqairLocation = {
  id: 'web:jakarta/jakarta', province: 'Jakarta', city: 'Jakarta',
  websiteUrl: 'https://www.iqair.com/id/air-quality/indonesia/jakarta/jakarta',
};
export function observationFreshness(reading: IqairReading, now = Date.now()): IqairResult['freshness'] {
  const time = Date.parse(reading.observedAt || '');
  if (!Number.isFinite(time)) return 'unknown';
  return now - time > 2 * 60 * 60 * 1000 ? 'outdated' : 'current';
}
export function usAqiCategory(value: number): string {
  return value <= 50 ? 'Baik' : value <= 100 ? 'Sedang' : value <= 150 ? 'Tidak sehat bagi kelompok sensitif' : value <= 200 ? 'Tidak sehat' : value <= 300 ? 'Sangat tidak sehat' : 'Berbahaya';
}
export function categoryColor(category?: string): string {
  const colors: Record<string, string> = { baik: '#22c55e', good: '#22c55e', sedang: '#eab308', moderate: '#eab308', 'tidak sehat bagi kelompok sensitif': '#f97316', 'unhealthy for sensitive groups': '#f97316', 'tidak sehat': '#ef4444', unhealthy: '#ef4444', 'sangat tidak sehat': '#a855f7', 'very unhealthy': '#a855f7', berbahaya: '#9f1239', hazardous: '#9f1239' };
  return colors[category?.toLowerCase() || ''] || '#64748b';
}
