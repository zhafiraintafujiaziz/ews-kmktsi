import type { IspuStationInfo, IspuCategory } from '../types';
import { ISPU_STATIONS_SNAPSHOT } from '../constants/ispuData';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { haversineDistance } from '../utils/geo';
import { fetchWithCorsProxy } from './proxy';

const ISPU_API_URL = 'https://ispu.kemenlh.go.id/apimobile/v1/getStations';

export interface OfficeIspuAssessment {
  officeId: string;
  ispuValue: number;
  category: IspuCategory;
  dominantParam: string;
  stationName: string;
  stationCity: string;
  stationProvince: string;
  distanceKm: number;
  score: number; // 0.0 to 1.0 (vulnerability index)
  waktuText: string;
}

export class IspuService {
  private static cachedStations: IspuStationInfo[] = ISPU_STATIONS_SNAPSHOT;
  private static lastFetchTime: number = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  /**
   * Fetch live stations from KemenLH ISPU API, falling back to cached snapshot.
   */
  static async fetchIspuStations(): Promise<IspuStationInfo[]> {
    const now = Date.now();
    if (this.cachedStations.length > 0 && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedStations;
    }

    try {
      const data = await fetchWithCorsProxy(ISPU_API_URL) as { rows?: any[] };
      const rows = data?.rows;

      if (Array.isArray(rows) && rows.length > 0) {
        const parsed: IspuStationInfo[] = rows.map((r) => {
          let val = 0;
          try {
            val = Math.round(parseFloat(r.val || '0'));
          } catch {
            val = 0;
          }

          const rawParam = r.param || '';
          const cleanParam = rawParam.replace(/<sub>|<\/sub>/gi, '');

          let cat: IspuCategory = 'BAIK';
          const rawCat = (r.cat || '').toUpperCase();
          if (rawCat.includes('BERBAHAYA') || val > 300) cat = 'BERBAHAYA';
          else if (rawCat.includes('SANGAT TIDAK SEHAT') || val > 200) cat = 'SANGAT TIDAK SEHAT';
          else if (rawCat.includes('TIDAK SEHAT') || val > 100) cat = 'TIDAK SEHAT';
          else if (rawCat.includes('SEDANG') || val > 50) cat = 'SEDANG';
          else cat = 'BAIK';

          return {
            idStasiun: r.id_stasiun || '',
            nama: r.nama || '',
            kota: r.kota || '',
            provinsi: r.provinsi || '',
            latitude: parseFloat(r.lat || '0'),
            longitude: parseFloat(r.lon || '0'),
            ispuValue: val,
            category: cat,
            dominantParam: cleanParam || 'PM2.5',
            waktuText: r.waktu_text || r.waktu || 'Terkini',
            keterangan: r.kategori?.keterangan || '',
            color: r.kategori?.color || '#0ea5e9',
          };
        }).filter((s) => !isNaN(s.latitude) && !isNaN(s.longitude) && s.latitude !== 0 && s.longitude !== 0);

        if (parsed.length > 0) {
          this.cachedStations = parsed;
          this.lastFetchTime = now;
          return this.cachedStations;
        }
      }
    } catch (err) {
      console.warn('IspuService: Live fetch failed, using official snapshot.', err);
    }

    return this.cachedStations;
  }

  /**
   * Return cached stations immediately (sync).
   */
  static getStations(): IspuStationInfo[] {
    return this.cachedStations && this.cachedStations.length > 0
      ? this.cachedStations
      : ISPU_STATIONS_SNAPSHOT;
  }

  /**
   * Find nearest SPKU station to a geographic coordinate.
   */
  static getNearestStation(
    lat: number,
    lon: number,
    stations?: IspuStationInfo[]
  ): { station: IspuStationInfo; distanceKm: number } | null {
    const pool = stations && stations.length > 0 ? stations : this.getStations();
    if (pool.length === 0) return null;

    let nearest: IspuStationInfo | null = null;
    let minDistance = Infinity;

    for (const s of pool) {
      const dist = haversineDistance(lat, lon, s.latitude, s.longitude);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = s;
      }
    }

    if (!nearest) return null;
    return { station: nearest, distanceKm: minDistance };
  }

  /**
   * Convert ISPU value to normalized vulnerability score (0.0 to 1.0)
   * Permen LHK No. 14 Tahun 2020:
   * 0 - 50: Baik -> 0.10 - 0.28
   * 51 - 100: Sedang -> 0.32 - 0.58
   * 101 - 200: Tidak Sehat -> 0.62 - 0.79
   * 201 - 300: Sangat Tidak Sehat -> 0.81 - 0.89
   * > 300: Berbahaya -> 0.90 - 1.00
   */
  static ispuToScore(ispuVal: number): number {
    if (ispuVal <= 0) return 0.15;
    if (ispuVal <= 50) {
      return 0.10 + (ispuVal / 50) * 0.18; // 0.10 - 0.28 (Rendah)
    }
    if (ispuVal <= 100) {
      return 0.32 + ((ispuVal - 50) / 50) * 0.26; // 0.32 - 0.58 (Sedang)
    }
    if (ispuVal <= 200) {
      return 0.62 + ((ispuVal - 100) / 100) * 0.17; // 0.62 - 0.79 (Tinggi)
    }
    if (ispuVal <= 300) {
      return 0.81 + ((ispuVal - 200) / 100) * 0.08; // 0.81 - 0.89 (Sangat Tinggi)
    }
    // > 300 (Berbahaya)
    const extra = Math.min((ispuVal - 300) / 700, 1.0);
    return 0.90 + extra * 0.10; // 0.90 - 1.00 (Ekstrem)
  }

  /**
   * Calculate ISPU vulnerability assessment for a given KPw BI office.
   */
  static getOfficeIspuAssessment(
    officeId: string,
    stations?: IspuStationInfo[]
  ): OfficeIspuAssessment {
    const office = KPWBI_OFFICES.find((o) => o.id === officeId);
    if (!office) {
      return {
        officeId,
        ispuValue: 50,
        category: 'SEDANG',
        dominantParam: 'PM2.5',
        stationName: 'Stasiun Regional',
        stationCity: 'Indonesia',
        stationProvince: '',
        distanceKm: 0,
        score: 0.35,
        waktuText: 'Hari ini',
      };
    }

    const nearestResult = this.getNearestStation(office.latitude, office.longitude, stations);
    if (!nearestResult) {
      return {
        officeId,
        ispuValue: 50,
        category: 'SEDANG',
        dominantParam: 'PM2.5',
        stationName: 'SPKU Estimasi',
        stationCity: office.city,
        stationProvince: office.region,
        distanceKm: 0,
        score: 0.35,
        waktuText: 'Estimasi Regional',
      };
    }

    const { station, distanceKm } = nearestResult;
    const baseScore = this.ispuToScore(station.ispuValue);

    // If nearest station is far (> 150 km), blend slightly towards moderate
    let finalScore = baseScore;
    if (distanceKm > 150) {
      const weight = Math.max(0.4, 1.0 - (distanceKm - 150) / 300);
      finalScore = baseScore * weight + 0.30 * (1 - weight);
    }

    return {
      officeId,
      ispuValue: station.ispuValue,
      category: station.category,
      dominantParam: station.dominantParam,
      stationName: station.nama,
      stationCity: station.kota,
      stationProvince: station.provinsi,
      distanceKm: Math.round(distanceKm * 10) / 10,
      score: Math.min(1.0, Math.max(0.05, finalScore)),
      waktuText: station.waktuText,
    };
  }

  /**
   * Return category styling & badge details based on Permen LHK No. 14/2020.
   */
  static getCategoryBadge(category: IspuCategory, _ispuVal?: number): {
    label: string;
    cls: 'risk-critical' | 'risk-high' | 'risk-medium' | 'risk-low';
    color: string;
    bg: string;
  } {
    switch (category) {
      case 'BERBAHAYA':
        return {
          label: 'BERBAHAYA',
          cls: 'risk-critical',
          color: '#ffffff',
          bg: '#18181b', // Pure dark / black
        };
      case 'SANGAT TIDAK SEHAT':
        return {
          label: 'SANGAT TIDAK SEHAT',
          cls: 'risk-high',
          color: '#ef4444',
          bg: 'rgba(239, 68, 68, 0.15)',
        };
      case 'TIDAK SEHAT':
        return {
          label: 'TIDAK SEHAT',
          cls: 'risk-high',
          color: '#f59e0b',
          bg: 'rgba(245, 158, 11, 0.15)',
        };
      case 'SEDANG':
        return {
          label: 'SEDANG',
          cls: 'risk-medium',
          color: '#0284c7',
          bg: 'rgba(2, 132, 199, 0.15)',
        };
      case 'BAIK':
      default:
        return {
          label: 'BAIK',
          cls: 'risk-low',
          color: '#10b981',
          bg: 'rgba(16, 185, 129, 0.15)',
        };
    }
  }
}
