import type { KpwbiOffice } from '../types';
import { fetchWithCorsProxy } from './proxy';
import { IspuService } from './ispuService';
import { haversineDistance } from '../utils/geo';

const BASE = 'https://gis.bnpb.go.id/server/rest/services/inarisk';
const SERVICES = {
  flood: 'INDEKS_BAHAYA_BANJIR',
  tsunami: 'INDEKS_BAHAYA_TSUNAMI',
  kekeringan: 'INDEKS_BAHAYA_KEKERINGAN',
  volcanic: 'INDEKS_BAHAYA_GUNUNGAPI',
} as const;
type InaRiskHazard = keyof typeof SERVICES;

export class BnpbInariskService {
  private static readonly publishedValues = new Map<string, Map<string, number>>();

  static async refreshAssessment(offices: KpwbiOffice[]): Promise<void> {
    await Promise.all(Object.entries(SERVICES).map(async ([hazardName, serviceName]) => {
      const hazard = hazardName as InaRiskHazard;
      const points = offices.map((office) => [office.longitude, office.latitude]);
      const geometry = { points, spatialReference: { wkid: 4326 } };
      const url = `${BASE}/${serviceName}/ImageServer/getSamples?geometryType=esriGeometryMultipoint&geometry=${encodeURIComponent(JSON.stringify(geometry))}&returnFirstValueOnly=true&f=json`;
      const data = await fetchWithCorsProxy(url) as { error?: { message?: string }; samples?: unknown[] };
      if (data.error) throw new Error(data.error.message || `Error calling ${serviceName}`);

      const values = new Map<string, number>();
      for (const sampleValue of data.samples || []) {
        if (!sampleValue || typeof sampleValue !== 'object') continue;
        const sample = sampleValue as { value?: unknown; location?: { x?: number; y?: number }; geometry?: { x?: number; y?: number } };
        const value = Number(sample.value);
        const point = sample.location || sample.geometry;
        if (!Number.isFinite(value) || value < 0 || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
        const office = offices.reduce<KpwbiOffice | null>((nearest, candidate) => {
          const distance = haversineDistance(point.y!, point.x!, candidate.latitude, candidate.longitude);
          if (distance > 2) return nearest;
          if (!nearest) return candidate;
          return distance < haversineDistance(point.y!, point.x!, nearest.latitude, nearest.longitude) ? candidate : nearest;
        }, null);
        if (office) values.set(office.id, value > 1 && value <= 3 ? value / 3 : value);
      }
      this.publishedValues.set(hazard, values);
    }));
  }

  static getLocalHazardIndex(
    officeId: string,
    hazard: InaRiskHazard | 'volcanic_ash' | 'air_quality',
  ): number | null {
    if (hazard === 'air_quality') return IspuService.getOfficeIspuAssessment(officeId)?.score ?? null;
    if (hazard === 'volcanic_ash') return null;
    return this.publishedValues.get(hazard)?.get(officeId) ?? null;
  }

  static getLocalPotensiIndex(_officeId: string, _hazard: 'gempa' | 'karhutla' | 'cuaca' | 'pasang'): null {
    void _officeId;
    void _hazard;
    return null;
  }

  static getHazardTitle(hazard: InaRiskHazard): string {
    switch (hazard) {
      case 'flood': return 'Banjir';
      case 'tsunami': return 'Tsunami';
      case 'kekeringan': return 'Kekeringan';
      case 'volcanic': return 'Gunung Api';
    }
  }
}
