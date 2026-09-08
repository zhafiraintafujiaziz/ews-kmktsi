import type { DisasterAlert, AlertSeverity, KpwbiOffice } from '../types';
import { fetchWithCorsProxy } from './proxy';

const BASE = 'https://gis.bnpb.go.id/server/rest/services/inarisk';

const SERVICES = {
  flood: 'INDEKS_BAHAYA_BANJIR',
  tsunami: 'INDEKS_BAHAYA_TSUNAMI',
  kekeringan: 'INDEKS_BAHAYA_KEKERINGAN',
  volcanic: 'INDEKS_BAHAYA_GUNUNGAPI',
} as const;

type InariskHazard = keyof typeof SERVICES;

export class BnpbInariskService {
  static async fetchInaRiskAlerts(offices: KpwbiOffice[]): Promise<DisasterAlert[]> {
    if (offices.length === 0) return [];

    try {
      const hazards: InariskHazard[] = ['flood', 'tsunami', 'kekeringan', 'volcanic'];

      const hazardPromises = hazards.map(async (hazard) => {
        try {
          const serviceName = SERVICES[hazard];
          const points = offices.map((o) => [o.longitude, o.latitude]);
          const geometryJson = { points, spatialReference: { wkid: 4326 } };
          const url = `${BASE}/${serviceName}/ImageServer/getSamples?geometryType=esriGeometryMultipoint&geometry=${encodeURIComponent(JSON.stringify(geometryJson))}&returnFirstValueOnly=true&f=json`;

          const data = await fetchWithCorsProxy(url) as { error?: { message: string }; samples?: any[] };
          if (data.error) throw new Error(data.error.message || `Error calling ${serviceName}`);

          const samples = data.samples || [];
          const alerts: DisasterAlert[] = [];

          samples.forEach((sample: any, index: number) => {
            const office = offices[index];
            if (!office) return;

            const rawVal = sample.value;
            if (rawVal === null || rawVal === undefined || rawVal === '') return;
            const val = parseFloat(rawVal);
            if (isNaN(val) || val <= 0 || val < -999) return;

            let severity: AlertSeverity | null = null;
            if (val > 0.6 || val === 3) severity = 3;
            else if (val > 0.3 || val === 2) severity = 2;
            else if (val > 0 || val === 1) severity = 1;

            if (severity) {
              const hazardTitle = BnpbInariskService.getHazardTitle(hazard);
              alerts.push({
                id: `inarisk-${hazard}-${office.id}`,
                type: hazard,
                severity,
                provinceId: office.provinceId,
                title: `Indeks Bahaya ${hazardTitle} (InaRisk) - ${office.city}`,
                description: `Berdasarkan data InaRisk BNPB, lokasi sekitar ${office.name} memiliki tingkat bahaya ${hazardTitle} dengan indeks ${val.toFixed(2)} (Level ${severity}).`,
                timestamp: new Date().toISOString(),
                latitude: office.latitude,
                longitude: office.longitude,
              });
            }
          });

          return alerts;
        } catch (err) {
          console.error(`Failed to fetch InaRisk alerts for hazard: ${hazard}`, err);
          return [];
        }
      });

      const results = await Promise.all(hazardPromises);
      const combined = results.flat();
      return combined;
    } catch (error) {
      console.error('Critical failure fetching InaRisk data:', error);
      return [];
    }
  }

  static getLocalHazardIndex(officeId: string, hazard: 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' | 'volcanic_ash'): number {
    let hash = 0;
    const str = officeId + hazard;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const val = Math.abs(hash % 100) / 100;

    if (hazard === 'volcanic_ash') {
      const ashHotspots: Record<string, number> = {
        'kupang': 0.88, // Terdampak Erupsi G. Lewotobi & Penutupan Bandara WATW
        'ternate': 0.84, // G. Ibu & G. Dukono (Halmahera)
        'lampung': 0.78, // G. Anak Krakatau & Koridor Selat Sunda
        'banten': 0.74, // G. Anak Krakatau
        'malang': 0.76, // G. Semeru & G. Bromo
        'kediri': 0.68, // G. Kelud & Semeru
        'surabaya': 0.62, // Koridor Jawa Timur
        'yogyakarta': 0.75, // G. Merapi
        'solo': 0.65, // G. Merapi
        'padang': 0.73, // G. Marapi
        'manado': 0.71, // G. Ruang & G. Karangetang
        'bandung': 0.58, // G. Tangkuban Parahu
        'medan': 0.55, // G. Sinabung
      };
      for (const [k, score] of Object.entries(ashHotspots)) {
        if (officeId.toLowerCase().includes(k)) return score;
      }
      return val > 0.6 ? 0.2 + val * 0.35 : 0;
    }

    if (hazard === 'tsunami') {
      const inlandOffices = ['yogyakarta', 'solo', 'malang', 'bandung', 'purwokerto', 'tasikmalaya', 'kediri', 'bogor'];
      if (inlandOffices.some((r) => officeId.toLowerCase().includes(r))) return 0;
      return val > 0.7 ? 0.3 + val * 0.45 : 0;
    }

    if (hazard === 'volcanic') {
      const volcanicRegions = ['yogyakarta', 'bandung', 'semarang', 'malang', 'kediri', 'denpasar', 'manado', 'ternate', 'medan', 'padang'];
      return volcanicRegions.some((r) => officeId.toLowerCase().includes(r)) ? 0.2 + val * 0.65 : 0;
    }

    if (hazard === 'kekeringan') {
      if (['kupang', 'mataram', 'denpasar'].some((r) => officeId.toLowerCase().includes(r))) {
        return 0.5 + val * 0.45;
      }
      return val * 0.55;
    }

    if (hazard === 'flood') {
      if (['jakarta', 'semarang', 'banjarmasin', 'palembang', 'surabaya'].some((r) => officeId.toLowerCase().includes(r))) {
        return 0.4 + val * 0.5;
      }
      return val * 0.65;
    }

    return val;
  }

  static getLocalPotensiIndex(officeId: string, hazard: 'gempa' | 'karhutla' | 'cuaca' | 'pasang'): number {
    let hash = 0;
    const str = officeId + hazard + "potensi";
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const val = Math.abs(hash % 100) / 100;

    if (hazard === 'gempa') {
      const activeFaultRegions = ['padang', 'medan', 'bandung', 'palu', 'gorontalo', 'ambon', 'jayapura', 'kupang'];
      if (activeFaultRegions.some((r) => officeId.toLowerCase().includes(r))) return 0.4 + val * 0.55;
      return val * 0.4;
    }
    if (hazard === 'karhutla') {
      const peatRegions = ['pekanbaru', 'jambi', 'palembang', 'pontianak', 'palangkaraya', 'banjarmasin', 'samarinda'];
      if (peatRegions.some((r) => officeId.toLowerCase().includes(r))) return 0.5 + val * 0.45;
      return val * 0.25;
    }
    if (hazard === 'cuaca') {
      const floodIndex = BnpbInariskService.getLocalHazardIndex(officeId, 'flood');
      const tsunamiIndex = BnpbInariskService.getLocalHazardIndex(officeId, 'tsunami');
      return Math.max(floodIndex, tsunamiIndex);
    }
    if (hazard === 'pasang') {
      const inlandOffices = ['yogyakarta', 'solo', 'malang', 'bandung', 'purwokerto', 'tasikmalaya', 'kediri', 'bogor'];
      if (inlandOffices.some((r) => officeId.toLowerCase().includes(r))) return 0;
      return 0.1 + val * 0.65;
    }
    return val;
  }

  private static getHazardTitle(hazard: InariskHazard): string {
    switch (hazard) {
      case 'flood': return 'Banjir';
      case 'tsunami': return 'Tsunami';
      case 'kekeringan': return 'Kekeringan';
      case 'volcanic': return 'Gunung Api';
    }
  }
}
