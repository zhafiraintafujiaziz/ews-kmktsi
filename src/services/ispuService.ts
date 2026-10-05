import type { DisasterAlert, AlertSeverity, IspuStationInfo, IspuCategory } from '../types';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { haversineDistance } from '../utils/geo';
import { mapTextToProvinceId } from '../utils/provinceMap';
import { fetchWithCorsProxy } from './proxy';
import { getIspuCategory, getIspuStyle } from '../constants/ispuCategories';

const ISPU_API_URL = 'https://ispu.kemenlh.go.id/apimobile/v1/getStations';

function parseObservationTime(value: string): Date | null {
  const months: Record<string, string> = {
    januari: 'January', februari: 'February', maret: 'March', april: 'April', mei: 'May',
    juni: 'June', juli: 'July', agustus: 'August', september: 'September', oktober: 'October',
    november: 'November', desember: 'December',
  };
  const normalized = value.replace(/\b([A-Za-z]+)\b/g, (part) => months[part.toLowerCase()] ?? part);
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

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
  private static cachedStations: IspuStationInfo[] = [];
  private static lastFetchTime: number = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

  /**
   * Fetch current stations from KemenLH. Stale or undated readings are ignored.
   */
  static async fetchIspuStations(): Promise<IspuStationInfo[]> {
    const now = Date.now();
    if (this.cachedStations.length > 0 && now - this.lastFetchTime < this.CACHE_TTL_MS) {
      return this.cachedStations;
    }

    try {
      const data = await fetchWithCorsProxy(ISPU_API_URL) as { rows?: Record<string, unknown>[] };
      const rows = data?.rows;
      if (!Array.isArray(rows)) throw new Error('ISPU response does not contain station rows');

      {
        const parsed: IspuStationInfo[] = rows.map((r) => {
          const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
          const categoryInfo = r.kategori && typeof r.kategori === 'object' ? r.kategori as Record<string, unknown> : {};
          const val = Number(r.val);
          const waktuText = text(r.waktu_text || r.waktu) || 'Terkini';
          const observedAt = parseObservationTime(waktuText);

          const rawParam = text(r.param);
          const cleanParam = rawParam.replace(/<sub>|<\/sub>/gi, '');

          const cat = getIspuCategory(val);

          return {
            idStasiun: text(r.id_stasiun),
            nama: text(r.nama),
            kota: text(r.kota),
            provinsi: text(r.provinsi),
            latitude: parseFloat(text(r.lat) || '0'),
            longitude: parseFloat(text(r.lon) || '0'),
            ispuValue: val,
            category: cat,
            dominantParam: cleanParam,
            waktuText,
            observedAt: observedAt?.toISOString(),
            keterangan: text(categoryInfo.keterangan),
            color: this.getCategoryColor(cat),
          };
        }).filter((s) => Number.isFinite(s.ispuValue) && s.ispuValue >= 0
          && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)
          && s.latitude !== 0 && s.longitude !== 0
          && Boolean(s.observedAt) && now - Date.parse(s.observedAt!) <= 24 * 60 * 60 * 1000
          && Date.parse(s.observedAt!) <= now);
        this.cachedStations = parsed;
        this.lastFetchTime = now;
        return parsed;
      }
    } catch (err) {
      console.warn('IspuService: Live fetch failed.', err);
      this.cachedStations = this.cachedStations.filter((station) => station.observedAt
        && now - Date.parse(station.observedAt) <= 24 * 60 * 60 * 1000);
      throw err;
    }
  }

  /**
   * Return cached stations immediately (sync).
   */
  static getStations(): IspuStationInfo[] {
    this.cachedStations = this.cachedStations.filter((station) => station.observedAt
      && Date.now() - Date.parse(station.observedAt) <= 24 * 60 * 60 * 1000);
    return this.cachedStations;
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
  ): OfficeIspuAssessment | null {
    const office = KPWBI_OFFICES.find((o) => o.id === officeId);
    if (!office) {
      return null;
    }

    const nearestResult = this.getNearestStation(office.latitude, office.longitude, stations);
    if (!nearestResult) {
      return null;
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
   * Return category styling and badge details from the source legend.
   */
  static getCategoryBadge(category: IspuCategory, ispuVal?: number): {
    label: string;
    cls: 'risk-critical' | 'risk-high' | 'risk-medium' | 'risk-low';
    color: string;
    bg: string;
  } {
    const style = getIspuStyle(category, ispuVal);
    const cls = style.category === 'BERBAHAYA' ? 'risk-critical'
      : style.category === 'SANGAT TIDAK SEHAT' || style.category === 'TIDAK SEHAT' ? 'risk-high'
      : style.category === 'SEDANG' ? 'risk-medium' : 'risk-low';
    return { label: style.category, cls, color: style.textColor, bg: style.color };
  }

  /**
   * Return the ISPU category color from the source legend.
   */
  static getCategoryColor(category: IspuCategory | string, ispuVal?: number): string {
    return getIspuStyle(category, ispuVal).color;
  }

  /**
   * Generate DisasterAlert[] from SPKU stations for Dashboard Utama.
   * Includes stations with elevated/unhealthy air quality (ISPU > 100),
   * and stations near KPw BI offices (<= 35 km) with notable pollution.
   */
  static async fetchAirQualityAlerts(): Promise<DisasterAlert[]> {
    const stations = await this.fetchIspuStations();
    const alerts: DisasterAlert[] = [];

    stations.forEach((station) => {
      // Cari kantor KPw BI terdekat
      let nearestOffice: typeof KPWBI_OFFICES[0] | null = null;
      let nearestOfficeDist = Infinity;
      for (const office of KPWBI_OFFICES) {
        const d = haversineDistance(station.latitude, station.longitude, office.latitude, office.longitude);
        if (d < nearestOfficeDist) {
          nearestOfficeDist = d;
          nearestOffice = office;
        }
      }

      const cat = (station.category || '').toUpperCase();
      // Filter ketat: HANYA tampilkan level Tidak Sehat, Sangat Tidak Sehat, dan Berbahaya (ISPU > 100)
      const isCriticalLevel =
        station.ispuValue > 100 ||
        cat.includes('TIDAK SEHAT') ||
        cat.includes('BERBAHAYA');

      if (!isCriticalLevel || cat === 'SEDANG' || cat === 'BAIK') return;

      let severity: AlertSeverity = 2;
      if (station.ispuValue > 200 || cat.includes('BERBAHAYA') || cat.includes('SANGAT TIDAK SEHAT')) {
        severity = 3;
      } else {
        severity = 2;
      }

      const distText = nearestOffice ? ` (±${Math.round(nearestOfficeDist)} km dari ${nearestOffice.name})` : '';

      const description = `Indeks Standar Pencemar Udara (ISPU) resmi KemenLH di wilayah berikut:
• Stasiun SPKU: ${station.nama} (${station.kota}, ${station.provinsi})
• Nilai ISPU: ${station.ispuValue}
• Kategori: ${station.category}
• Parameter Kritis: ${station.dominantParam}
• Waktu Observasi: ${station.waktuText}
• Kantor KPw BI Terdekat: ${nearestOffice?.name || '-'}${distText}

Keterangan: ${station.keterangan || 'Kualitas udara dapat merugikan kesehatan. Disarankan menggunakan masker N95 dan membatasi aktivitas fisik di luar gedung.'}

Rekomendasi Operasional KPw BI Terdekat:
• Batasi aktivitas fisik personel operasional di luar gedung kantor.
• Gunakan masker respirator partikulat N95 saat berada di area terbuka.
• Pastikan sistem sirkulasi udara dan filter presisi HVAC Data Center beroperasi optimal.

Sumber Data: Stasiun Pemantau Kualitas Udara (SPKU) KemenLH / KLHK (Permen LHK No. 14/2020)`.trim();

      alerts.push({
        id: `ispu-alert-${station.idStasiun.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        type: 'air_quality',
        severity,
        provinceId: mapTextToProvinceId(station.provinsi),
        title: `Kualitas Udara ${station.category} (ISPU ${station.ispuValue}) - ${station.kota}`,
        description,
        timestamp: station.observedAt!,
        latitude: station.latitude,
        longitude: station.longitude,
        affectedArea: `${station.kota} (${station.nama})`,
        ispuValue: station.ispuValue,
        ispuCategory: station.category,
        ispuParam: station.dominantParam,
        stationName: station.nama,
        sourceUrl: 'https://ispu.kemenlh.go.id/webv5/#/'
      });
    });

    return alerts.sort((a, b) => (b.ispuValue || 0) - (a.ispuValue || 0));
  }
}
