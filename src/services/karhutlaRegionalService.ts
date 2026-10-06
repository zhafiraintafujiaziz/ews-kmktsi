import type { KpwbiOffice } from '../types';
import { fetchWithCorsProxy } from './proxy';
import { parseHazardIndex, type InaRiskAssessmentStatus } from './bnpbInariskService';

export const KARHUTLA_IMAGE_SERVICE = 'https://gis.bnpb.go.id/server/rest/services/inarisk/layer_bahaya_kebakaran_hutan_dan_lahan/ImageServer';
export const KARHUTLA_RADIUS_KM = 25;
export const KARHUTLA_PIXEL_SIZE = 100;
const CACHE_MS = 6 * 60 * 60 * 1000;
const REQUEST_MS = 12_000;
const BATCH_MS = 60_000;
type Point = [number, number];
export interface KarhutlaStatistics {
  mean: number; min: number; max: number; validCellCount: number;
  coveragePercent: number; skipX: number; skipY: number;
}
export interface KarhutlaRegionalAssessment {
  status: 'loading' | 'available' | 'no_data' | 'error';
  statistics: KarhutlaStatistics | null;
  radiusKm: number; checkedAt: string | null; error: string | null;
}

// EPSG:3395 is the service's native 100 m raster grid (ellipsoidal Mercator).
export function project3395(longitude: number, latitude: number): Point {
  const radius = 6378137, eccentricity = 0.08181919084262149;
  const lat = latitude * Math.PI / 180;
  return [radius * longitude * Math.PI / 180, radius * Math.log(Math.tan(Math.PI / 4 + lat / 2) * Math.pow((1 - eccentricity * Math.sin(lat)) / (1 + eccentricity * Math.sin(lat)), eccentricity / 2))];
}
export function karhutlaRegion(latitude: number, longitude: number) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 80 || Math.abs(longitude) > 180) throw new Error('Koordinat wilayah Karhutla tidak valid.');
  const lat = latitude * Math.PI / 180, lon = longitude * Math.PI / 180;
  const angle = KARHUTLA_RADIUS_KM / 6371;
  const ring: Point[] = Array.from({ length: 72 }, (_, i) => {
    const bearing = i * 2 * Math.PI / 72;
    const targetLat = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(bearing));
    const targetLon = lon + Math.atan2(Math.sin(bearing) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(targetLat));
    return project3395(targetLon * 180 / Math.PI, targetLat * 180 / Math.PI);
  });
  ring.push([...ring[0]]);
  // Translate before shoelace summation to avoid cancellation with large eastings.
  const [originX, originY] = ring[0];
  let twiceArea = 0;
  for (let i = 1; i < ring.length; i++) twiceArea += (ring[i - 1][0] - originX) * (ring[i][1] - originY) - (ring[i][0] - originX) * (ring[i - 1][1] - originY);
  return { geometry: { rings: [ring], spatialReference: { wkid: 3395 } }, projectedArea: Math.abs(twiceArea) / 2 };
}
export function karhutlaStatisticsUrl(latitude: number, longitude: number) {
  const region = karhutlaRegion(latitude, longitude);
  const query = new URLSearchParams({ f: 'json', geometryType: 'esriGeometryPolygon', geometry: JSON.stringify(region.geometry), pixelSize: KARHUTLA_PIXEL_SIZE + ',' + KARHUTLA_PIXEL_SIZE, renderingRule: JSON.stringify({ rasterFunction: 'None' }) });
  return { url: KARHUTLA_IMAGE_SERVICE + '/computeStatisticsHistograms?' + query, projectedArea: region.projectedArea };
}
export function parseKarhutlaStatistics(data: unknown, projectedArea: number): KarhutlaStatistics | null {
  if (!data || typeof data !== 'object') throw new Error('Respons statistik InaRISK tidak valid.');
  const response = data as { error?: { message?: string }; statistics?: unknown[] };
  if (response.error) throw new Error(response.error.message || 'Statistik InaRISK gagal dimuat.');
  if (!Array.isArray(response.statistics) || response.statistics.length > 1) throw new Error('Respons InaRISK bukan raster indeks satu band.');
  if (!response.statistics.length) return null;
  const stats = response.statistics[0] as Record<string, unknown> | null;
  if (!stats || !Number.isSafeInteger(stats.count) || Number(stats.count) < 0) throw new Error('Jumlah sel raster tidak valid.');
  const count = Number(stats.count);
  if (count === 0) return null;
  const mean = parseHazardIndex(stats.mean), min = parseHazardIndex(stats.min), max = parseHazardIndex(stats.max);
  const skipX = stats.skipX === undefined ? 1 : Number(stats.skipX), skipY = stats.skipY === undefined ? 1 : Number(stats.skipY);
  if (mean === null || min === null || max === null || min > mean || mean > max || !Number.isInteger(skipX) || skipX < 1 || !Number.isInteger(skipY) || skipY < 1 || !Number.isFinite(projectedArea) || projectedArea <= 0) throw new Error('Nilai raster Karhutla tidak valid.');
  return { mean, min, max, validCellCount: count, skipX, skipY, coveragePercent: Math.min(100, count * skipX * skipY * KARHUTLA_PIXEL_SIZE ** 2 / projectedArea * 100) };
}

export class KarhutlaRegionalService {
  private static readonly assessments = new Map<string, KarhutlaRegionalAssessment>();
  private static readonly locations = new Map<string, string>();
  private static readonly listeners = new Set<() => void>();
  private static revision = 0;
  private static running: Promise<void> | null = null;
  private static officeIds: string[] = [];
  static subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  static getRevision = () => this.revision;
  private static notify() { this.revision++; this.listeners.forEach(listener => listener()); }
  static getOfficeAssessment(officeId: string) { return this.assessments.get(officeId) ?? null; }
  static getAssessmentStatus(): InaRiskAssessmentStatus {
    const records = this.officeIds.map(id => this.assessments.get(id));
    const valueCount = records.filter(record => record?.statistics !== null && record?.statistics !== undefined).length;
    const failedOfficeCount = records.filter(record => record?.status === 'error').length;
    const status = !records.length ? 'idle' : records.some(record => record?.status === 'loading') ? 'loading' : valueCount === records.length ? 'available' : valueCount > 0 ? 'partial' : failedOfficeCount > 0 ? 'error' : 'no_data';
    const checked = records.flatMap(record => record?.checkedAt ? [record.checkedAt] : []).sort();
    return { status, officeCount: records.length, valueCount, failedOfficeCount, checkedAt: checked.at(-1) ?? null, error: records.find(record => record?.error)?.error ?? null };
  }
  static refresh(offices: KpwbiOffice[], force = false): Promise<void> {
    if (this.running) return this.running;
    this.running = this.load(offices, force).finally(() => { this.running = null; });
    return this.running;
  }
  private static async load(offices: KpwbiOffice[], force: boolean) {
    this.officeIds = offices.map(office => office.id);
    const now = Date.now();
    const pending = offices.filter(office => {
      const previous = this.assessments.get(office.id);
      const location = office.latitude + ',' + office.longitude;
      return force || this.locations.get(office.id) !== location || !previous || !['available', 'no_data'].includes(previous.status) || !previous.checkedAt || now - Date.parse(previous.checkedAt) >= CACHE_MS;
    });
    if (!pending.length) return;
    pending.forEach(office => {
      this.locations.set(office.id, office.latitude + ',' + office.longitude);
      this.assessments.set(office.id, { status: 'loading', statistics: null, radiusKm: KARHUTLA_RADIUS_KM, checkedAt: null, error: null });
    });
    this.notify();
    const batch = new AbortController();
    const deadline = setTimeout(() => batch.abort(new Error('Batas waktu statistik Karhutla tercapai.')), BATCH_MS);
    let nextOffice = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
        while (nextOffice < pending.length && !batch.signal.aborted) {
          const office = pending[nextOffice++];
          const request = new AbortController();
          const timeout = setTimeout(() => request.abort(new Error('Statistik InaRISK tidak merespons.')), REQUEST_MS);
          const signal = AbortSignal.any([batch.signal, request.signal]);
          let onAbort: () => void = () => {};
          try {
            const region = karhutlaStatisticsUrl(office.latitude, office.longitude);
            signal.throwIfAborted();
            const data = await Promise.race([fetchWithCorsProxy(region.url, { signal }), new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true }); })]);
            signal.throwIfAborted();
            const statistics = parseKarhutlaStatistics(data, region.projectedArea);
            this.assessments.set(office.id, { status: statistics ? 'available' : 'no_data', statistics, radiusKm: KARHUTLA_RADIUS_KM, checkedAt: new Date(Date.now()).toISOString(), error: null });
          } catch (error) {
            this.assessments.set(office.id, { status: 'error', statistics: null, radiusKm: KARHUTLA_RADIUS_KM, checkedAt: new Date(Date.now()).toISOString(), error: error instanceof Error ? error.message : String(error) });
          } finally { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); this.notify(); }
        }
      }));
      for (const office of pending.slice(nextOffice)) this.assessments.set(office.id, { status: 'error', statistics: null, radiusKm: KARHUTLA_RADIUS_KM, checkedAt: new Date(Date.now()).toISOString(), error: 'Batas waktu statistik Karhutla tercapai.' });
    } finally { clearTimeout(deadline); this.notify(); }
  }
}
