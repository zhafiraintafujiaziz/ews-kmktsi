import type { KpwbiOffice } from '../types';
import { INARISK_HAZARD_SERVICES, resolveInaRiskSource, type InaRiskHazardType, type InaRiskSourceType } from '../constants/kerentananCategories';
import { fetchWithCorsProxy } from './proxy';
import { haversineDistance } from '../utils/geo';

const BASE = 'https://gis.bnpb.go.id/server/rest/services/inarisk';
const CATEGORY_DEADLINE_MS = 14_000;

export interface InaRiskAssessmentStatus {
  status: 'idle' | 'loading' | 'available' | 'partial' | 'no_data' | 'error';
  checkedAt: string | null;
  error: string | null;
  officeCount: number;
  valueCount: number;
  failedOfficeCount: number;
}

export function parseHazardIndex(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const index = Number(value);
  return Number.isFinite(index) && index >= -0.000001 && index <= 1.000001
    ? Math.min(1, Math.max(0, index)) : null;
}

async function fetchAssessment(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  try {
    const data = await Promise.race([
      fetchWithCorsProxy(url, { signal }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
    signal.throwIfAborted();
    if (!data || typeof data !== 'object') throw new Error('Invalid InaRISK response');
    const response = data as Record<string, unknown>;
    if (response.error) {
      const error = response.error as { message?: string };
      throw new Error(error.message || 'InaRISK service request failed');
    }
    return response;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export class BnpbInariskService {
  private static readonly publishedValues = new Map<InaRiskSourceType, Map<string, number>>();
  private static readonly statuses = new Map<InaRiskSourceType, InaRiskAssessmentStatus>();
  private static readonly failedOffices = new Map<InaRiskSourceType, Set<string>>();
  private static readonly listeners = new Set<() => void>();
  private static revision = 0;

  static subscribe = (listener: () => void): (() => void) => {
    BnpbInariskService.listeners.add(listener);
    return () => { BnpbInariskService.listeners.delete(listener); };
  };

  static getRevision = (): number => BnpbInariskService.revision;

  private static notify() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }

  static async refreshAssessment(offices: KpwbiOffice[], sources?: InaRiskSourceType[]): Promise<void> {
    const results = await Promise.allSettled(Object.entries(INARISK_HAZARD_SERVICES).filter(([source]) => !sources || sources.includes(source as InaRiskSourceType)).map(async ([sourceName, service]) => {
      const source = sourceName as InaRiskSourceType;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error('InaRISK category request timed out')), CATEGORY_DEADLINE_MS);
      const values = new Map<string, number>();
      const failures = new Set<string>();
      const errors: string[] = [];
      this.statuses.set(source, { ...this.getAssessmentStatus(source), status: 'loading', officeCount: offices.length });
      this.notify();
      try {
        if (offices.length && source === 'earthquake') {
          let nextOffice = 0;
          await Promise.all(Array.from({ length: Math.min(4, offices.length) }, async () => {
            while (nextOffice < offices.length && !controller.signal.aborted) {
              const office = offices[nextOffice++];
              try {
                const geometry = { x: office.longitude, y: office.latitude, spatialReference: { wkid: 4326 } };
                const query = new URLSearchParams({
                  geometry: JSON.stringify(geometry), geometryType: 'esriGeometryPoint', sr: '4326',
                  layers: 'all:0', tolerance: '0',
                  mapExtent: [office.longitude - 0.01, office.latitude - 0.01, office.longitude + 0.01, office.latitude + 0.01].join(','),
                  imageDisplay: '256,256,96', returnGeometry: 'false', returnUnformattedValues: 'true', returnFieldName: 'true', f: 'json',
                });
                const data = await fetchAssessment(
                  BASE + '/' + service + '/identify?' + query, controller.signal,
                );
                if (!Array.isArray(data.results)) throw new Error('Missing earthquake identify results');
                const result = data.results.find((item: { layerId?: number }) => item?.layerId === 0) as { attributes?: Record<string, unknown> } | undefined;
                const index = parseHazardIndex(result?.attributes?.['Stretch.Pixel Value']);
                if (index !== null) values.set(office.id, index);
              } catch (error) {
                failures.add(office.id);
                errors.push(error instanceof Error ? error.message : String(error));
              }
            }
          }));
          for (const office of offices.slice(nextOffice)) failures.add(office.id);
        } else if (offices.length) {
          const geometry = { points: offices.map((office) => [office.longitude, office.latitude]), spatialReference: { wkid: 4326 } };
          const query = new URLSearchParams({ geometryType: 'esriGeometryMultipoint', geometry: JSON.stringify(geometry), returnFirstValueOnly: 'true', f: 'json' });
          if (source === 'extreme_weather') {
            query.set('renderingRule', JSON.stringify({ rasterFunction: 'None' }));
            query.set('interpolation', 'RSP_NearestNeighbor');
          }
          const data = await fetchAssessment(BASE + '/' + service + '/getSamples?' + query, controller.signal);
          if (!Array.isArray(data.samples)) throw new Error('Missing samples from ' + service);
          for (const sampleValue of data.samples) {
            if (!sampleValue || typeof sampleValue !== 'object') continue;
            const sample = sampleValue as { value?: unknown; locationId?: number; location?: { x?: number; y?: number }; geometry?: { x?: number; y?: number } };
            const index = parseHazardIndex(sample.value);
            if (index === null) continue;
            let office = Number.isInteger(sample.locationId) && sample.locationId! >= 0 ? offices[sample.locationId!] : undefined;
            if (!office) {
              const point = sample.location || sample.geometry;
              if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.y!) > 90 || Math.abs(point.x!) > 180) continue;
              office = offices.reduce<KpwbiOffice | undefined>((nearest, candidate) => {
                const distance = haversineDistance(point.y!, point.x!, candidate.latitude, candidate.longitude);
                if (distance > 2) return nearest;
                return !nearest || distance < haversineDistance(point.y!, point.x!, nearest.latitude, nearest.longitude) ? candidate : nearest;
              }, undefined);
            }
            if (office) values.set(office.id, index);
          }
        }
      } catch (error) {
        offices.forEach((office) => failures.add(office.id));
        errors.push(error instanceof Error ? error.message : String(error));
      } finally {
        clearTimeout(timeout);
      }
      const status: InaRiskAssessmentStatus['status'] = values.size > 0
        ? values.size === offices.length && failures.size === 0 ? 'available' : 'partial'
        : failures.size > 0 ? 'error' : 'no_data';
      this.publishedValues.set(source, values);
      this.failedOffices.set(source, failures);
      this.statuses.set(source, {
        status, checkedAt: new Date().toISOString(), error: errors[0] ?? null,
        officeCount: offices.length, valueCount: values.size, failedOfficeCount: failures.size,
      });
      this.notify();
      if (status === 'error') throw new Error(errors[0] || 'InaRISK service unavailable');
    }));
    const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    if (errors.length) throw new AggregateError(errors, 'Some InaRISK hazard categories are unavailable');
  }

  static getLocalHazardIndex(officeId: string, hazard: InaRiskHazardType | 'flood'): number | null {
    if (hazard === 'flood') return null;
    return this.publishedValues.get(resolveInaRiskSource(hazard))?.get(officeId) ?? null;
  }

  static getAssessmentStatus(hazard: InaRiskHazardType): InaRiskAssessmentStatus {
    return this.statuses.get(resolveInaRiskSource(hazard)) ?? {
      status: 'idle', checkedAt: null, error: null, officeCount: 0, valueCount: 0, failedOfficeCount: 0,
    };
  }

  static getAssessmentMessage(hazard: InaRiskHazardType, officeId?: string): string {
    const assessment = this.getAssessmentStatus(hazard);
    if (assessment.status === 'idle' || assessment.status === 'loading') return 'Memuat data bahaya InaRISK...';
    if (assessment.status === 'error' || (officeId && this.failedOffices.get(resolveInaRiskSource(hazard))?.has(officeId))) {
      return 'Layanan BNPB gagal merespons. Data bahaya belum tersedia.';
    }
    if (officeId && this.getLocalHazardIndex(officeId, hazard) === null) return 'InaRISK tidak menyediakan nilai pada titik kantor ini.';
    if (assessment.status === 'no_data') return 'InaRISK tidak menyediakan nilai bahaya pada titik kantor yang diperiksa.';
    if (assessment.status === 'partial') {
      return assessment.valueCount + ' dari ' + assessment.officeCount + ' titik memiliki data bahaya. '
        + (assessment.failedOfficeCount > 0 ? 'Sebagian permintaan BNPB gagal merespons.' : 'Titik lainnya tidak memiliki nilai di InaRISK.');
    }
    return 'Data bahaya tersedia untuk ' + assessment.valueCount + ' titik kantor.';
  }
}
