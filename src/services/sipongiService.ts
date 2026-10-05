import type { DisasterAlert, AlertSeverity } from '../types';
import { fetchWithCorsProxy } from './proxy';
import { mapTextToProvinceId } from '../utils/provinceMap';
import { haversineDistance } from '../utils/geo';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';

export interface SipongiRow {
  provinsi: string;
  kabupaten: string;
  sumber: string;
  confidence: string; // e.g. "High", "Medium", "Low"
  counter: number; // number of hotspots
}

export interface ConsolidatedHotspotCluster {
  provinsi: string;
  kabupaten: string;
  sumberList: string[];
  confidence: string;
  counter: number;
}

// Pusat koordinat geografis riil tiap Kabupaten/Kota di Indonesia untuk mencegah false-alarm pada kantor KPw
export const KABUPATEN_COORDINATES: Record<string, [number, number]> = {
  // Banten
  'PANDEGLANG': [-6.6111, 105.7892],
  'LEBAK': [-6.6500, 106.2500],
  'SERANG': [-6.1200, 106.1500],
  // Jambi
  'TEBO': [-1.4500, 102.3833],
  'SAROLANGUN': [-2.3000, 102.6500],
  'MUARO JAMBI': [-1.5833, 103.8167],
  'TANJUNG JABUNG BARAT': [-1.1500, 103.2500],
  'TANJUNG JABUNG TIMUR': [-1.1833, 103.8167],
  'BATANG HARI': [-1.7500, 103.1167],
  // Jawa Barat
  'INDRAMAYU': [-6.3264, 108.3200],
  'KARAWANG': [-6.3000, 107.3000],
  'SUBANG': [-6.5667, 107.7667],
  'BOGOR': [-6.5944, 106.7892],
  'SUKABUMI': [-6.9167, 106.9167],
  // Jawa Timur
  'BLITAR': [-8.0983, 112.1681],
  'LUMAJANG': [-8.1333, 113.2167],
  'MALANG': [-8.1667, 112.6667],
  'BANYUWANGI': [-8.2167, 114.3667],
  'JEMBER': [-8.1724, 113.7007],
  'BOJONEGORO': [-7.1500, 111.8833],
  'TUBAN': [-6.9000, 112.0500],
  // Kalimantan Barat
  'KAYONG UTARA': [-1.1500, 109.9500],
  'KETAPANG': [-1.8333, 110.0000],
  'KUBU RAYA': [-0.3833, 109.5500],
  'SAMBAS': [1.3833, 109.3000],
  'BENGKAYANG': [0.8167, 109.6500],
  'LANDAK': [0.4167, 109.7500],
  'SANGGAU': [0.1167, 110.5833],
  'SINTANG': [0.0667, 111.5000],
  'KAPUAS HULU': [0.8167, 112.9333],
  // Kalimantan Selatan
  'BANJAR': [-3.3167, 114.9833],
  'KOTABARU': [-3.0000, 116.0000],
  'TANAH BUMBU': [-3.4500, 115.7000],
  'TANAH LAUT': [-3.8833, 114.8667],
  'BARITO KUALA': [-3.0833, 114.6167],
  'TAPIN': [-2.9167, 115.1667],
  'TABALONG': [-1.8833, 115.5000],
  // Kalimantan Tengah
  'KAPUAS': [-2.0167, 114.3833],
  'KATINGAN': [-1.9833, 113.4167],
  'KOTAWARINGIN BARAT': [-2.4167, 111.7333],
  'KOTAWARINGIN TIMUR': [-2.0833, 112.7500],
  'PULANG PISAU': [-2.7483, 114.2570],
  'SERUYAN': [-2.3333, 112.2500],
  'SUKAMARA': [-2.6333, 111.2333],
  'BARITO SELATAN': [-1.7500, 114.8333],
  'BARITO UTARA': [-0.9833, 115.1167],
  'MURUNG RAYA': [-0.0167, 114.3333],
  'GUNUNG MAS': [-1.1500, 113.8667],
  'LAMANDAU': [-2.0000, 111.2833],
  // Kalimantan Timur
  'BERAU': [2.1500, 117.4833],
  'KOTA SAMARINDA': [-0.5021, 117.1537],
  'KOTA BALIKPAPAN': [-1.2654, 116.8312],
  'BONTANG': [0.1333, 117.5000],
  'KUTAI BARAT': [-0.6000, 115.5000],
  'KUTAI KARTANEGARA': [-0.4333, 116.9833],
  'KUTAI TIMUR': [0.9167, 117.5833],
  'PASER': [-1.8667, 116.1000],
  'PENAJAM PASER UTARA': [-1.2833, 116.6833],
  'MAHAKAM ULU': [0.5500, 114.8667],
  // Kalimantan Utara
  'BULUNGAN': [2.9000, 117.1333],
  'MALINAU': [3.5833, 116.6333],
  'NUNUKAN': [4.1333, 117.1667],
  'TANA TIDUNG': [3.5500, 117.2500],
  'KOTA TARAKAN': [3.3000, 117.6333],
  // Bangka Belitung
  'BANGKA': [-1.9000, 105.9333],
  'BANGKA TENGAH': [-2.4667, 106.1833],
  'BANGKA BARAT': [-1.8500, 105.4167],
  'BANGKA SELATAN': [-2.9167, 106.4000],
  'BELITUNG': [-2.7500, 107.8000],
  'BELITUNG TIMUR': [-2.9833, 108.1500],
  // Kepulauan Riau
  'KARIMUN': [0.9833, 103.4333],
  'KOTA TANJUNG PINANG': [0.9167, 104.4500],
  'KOTA BATAM': [1.1300, 104.0500],
  'LINGGA': [-0.2000, 104.6167],
  'NATUNA': [3.9500, 108.1500],
  'KEPULAUAN ANAMBAS': [3.1000, 106.1500],
  // Lampung
  'LAMPUNG SELATAN': [-5.5833, 105.5833],
  'TULANG BAWANG BARAT': [-4.4500, 105.0500],
  'TULANG BAWANG': [-4.4000, 105.7000],
  'WAY KANAN': [-4.6000, 104.5333],
  'LAMPUNG TENGAH': [-4.8667, 105.2167],
  'LAMPUNG TIMUR': [-5.1000, 105.6833],
  'MESUJI': [-4.0500, 105.4000],
  // Maluku
  'BURU': [-3.3000, 126.7000],
  'BURU SELATAN': [-3.7500, 126.6500],
  'KEPULAUAN TANIMBAR': [-7.8667, 131.3000],
  'MALUKU TENGAH': [-3.2833, 128.9667],
  'SERAM BAGIAN BARAT': [-3.1167, 128.2500],
  'SERAM BAGIAN TIMUR': [-3.1833, 130.4000],
  // Maluku Utara
  'HALMAHERA UTARA': [1.7333, 128.0000],
  'HALMAHERA BARAT': [1.3833, 127.4833],
  'HALMAHERA SELATAN': [-0.6500, 127.8000],
  'HALMAHERA TIMUR': [1.0833, 128.4000],
  'PULAU TALIABU': [-1.8833, 124.8333],
  'TALIABU': [-1.8833, 124.8333],
  // NTB
  'BIMA': [-8.5833, 118.7167],
  'DOMPU': [-8.5333, 118.4500],
  'SUMBAWA': [-8.7500, 117.5500],
  'SUMBAWA BARAT': [-8.8167, 116.8500],
  // NTT
  'LEMBATA': [-8.3833, 123.5500],
  'FLORES TIMUR': [-8.3333, 122.9833],
  'ALOR': [-8.3167, 124.7167],
  'SIKKA': [-8.6667, 122.3500],
  'ENDE': [-8.7500, 121.6500],
  'SUMBA TIMUR': [-9.8500, 120.2500],
  // Papua Barat
  'FAK FAK': [-2.9167, 132.3000],
  'KAIMANA': [-3.6667, 133.7500],
  'TELUK BINTUNI': [-2.1167, 133.5167],
  // Papua Pegunungan
  'JAYAWIJAYA': [-4.0833, 138.9500],
  'LANNY JAYA': [-3.9167, 138.3500],
  'YAHUKIMO': [-4.5667, 139.5833],
  // Papua Selatan
  'ASMAT': [-5.4167, 138.3333],
  'MAPPI': [-6.5000, 139.3333],
  'MERAUKE': [-8.4991, 140.4014],
  'BOVEN DIGOEL': [-5.7500, 140.3500],
  // Papua Tengah
  'PANIAI': [-3.9000, 136.3500],
  'PUNCAK': [-3.7500, 137.1667],
  'NABIRE': [-3.3667, 135.5000],
  'MIMIKA': [-4.5500, 136.9000],
  // Riau
  'INDRAGIRI HULU': [-0.5500, 102.3167],
  'INDRAGIRI HILIR': [-0.3333, 103.1667],
  'PELALAWAN': [0.1500, 102.1667],
  'SIAK': [0.9500, 101.9833],
  'BENGKALIS': [1.4667, 102.1333],
  'ROKAN HILIR': [2.1667, 100.8333],
  'ROKAN HULU': [0.8833, 100.5167],
  'KAMPAR': [0.3333, 101.2167],
  'KOTA DUMAI': [1.6833, 101.4500],
  // Sulawesi Barat
  'MAMUJU': [-2.6833, 118.8833],
  'MAMUJU TENGAH': [-2.1500, 119.3000],
  'PASANGKAYU': [-1.4167, 119.4167],
  // Sulawesi Selatan
  'ENREKANG': [-3.5667, 119.7833],
  'LUWU TIMUR': [-2.5667, 121.1500],
  'LUWU UTARA': [-2.6000, 120.3000],
  'PINRANG': [-3.7833, 119.6500],
  'SIDENRENG RAPPANG': [-3.9167, 119.9833],
  'BONE': [-4.6000, 120.2500],
  // Sulawesi Tengah
  'BANGGAI': [-1.5500, 122.8000],
  'MOROWALI UTARA': [-1.9833, 121.3333],
  'MOROWALI': [-2.5500, 121.9000],
  'POSO': [-1.4000, 120.7500],
  'TOJO UNA UNA': [-1.1500, 121.6167],
  'PARIGI MOUTONG': [-0.7500, 120.2000],
  'TOLITOLI': [1.0500, 120.8000],
  'BUOL': [1.1667, 121.4333],
  // Sulawesi Tenggara
  'KONAWE': [-3.8667, 122.0500],
  'KONAWE SELATAN': [-4.2500, 122.4000],
  'KOLAKA': [-4.0500, 121.6000],
  'BOMBANA': [-4.7500, 121.8500],
  // Sulawesi Utara
  'KEPULAUAN SANGIHE': [3.6167, 125.5000],
  'KEPULAUAN TALAUD': [4.3333, 126.7500],
  'BOLAANG MONGONDOW': [0.7500, 124.1000],
  // Sumatera Barat
  'DHARMASRAYA': [-1.0500, 101.6167],
  'PASAMAN BARAT': [0.1833, 99.8167],
  'PESISIR SELATAN': [-1.5833, 100.8667],
  'SIJUNJUNG': [-0.7000, 101.3500],
  // Sumatera Selatan
  'BANYUASIN': [-2.8833, 104.3833],
  'EMPAT LAWANG': [-3.7500, 103.0833],
  'MUARA ENIM': [-3.6500, 103.7833],
  'MUSI BANYUASIN': [-2.8833, 103.8167],
  'MUSI RAWAS': [-3.1833, 103.0167],
  'MUSI RAWAS UTARA': [-2.6000, 102.8333],
  'OGAN ILIR': [-3.4333, 104.6500],
  'OGAN KOMERING ILIR': [-3.3769, 105.1764],
  'OGAN KOMERING ULU': [-4.1333, 104.1667],
  'OGAN KOMERING ULU TIMUR': [-3.8500, 104.7500],
  'OGAN KOMERING ULU SELATAN': [-4.6500, 104.0000],
  'LAHAT': [-3.7833, 103.5333],
  'KOTA PALEMBANG': [-2.9888, 104.7565],
};

export function getSipongiCoordinates(regency: string): [number, number] | null {
  const rClean = (regency || '').toUpperCase().trim();

  // 1. Cek pencocokan persis atau parsial di tabel koordinat riil Kabupaten/Kota
  for (const [kabName, coords] of Object.entries(KABUPATEN_COORDINATES)) {
    if (rClean === kabName || rClean.includes(kabName) || kabName.includes(rClean)) {
      return coords;
    }
  }

  return null;
}

export function clusterToAlert(cluster: ConsolidatedHotspotCluster, index: number, periodStart: string, periodEnd: string): DisasterAlert {
  const coords = getSipongiCoordinates(cluster.kabupaten);
  const satText = cluster.sumberList.join(', ');

  // Hitung jarak ke kantor KPw BI terdekat
  let nearestOfficeName = '';
  let nearestDistKm = 9999;
  for (const office of KPWBI_OFFICES) {
    if (!coords) break;
    const dist = haversineDistance(coords[0], coords[1], office.latitude, office.longitude);
    if (dist < nearestDistKm) {
      nearestDistKm = Math.round(dist * 10) / 10;
      nearestOfficeName = office.name;
    }
  }

  const proximityNotice = nearestDistKm <= 50
    ? `⚠️ Sangat Dekat KPw BI (${nearestDistKm} km dari ${nearestOfficeName})`
    : `Radius Nasional (${cluster.counter} Titik Panas Masif)`;

  const description = `Sebaran titik panas (hotspot) terdeteksi di wilayah berikut:
• Provinsi: ${cluster.provinsi}
• Kabupaten/Kota: ${cluster.kabupaten}
• Status: Tingkat Bahaya Sangat Tinggi (${proximityNotice})
• Jumlah Titik Panas: ${cluster.counter} titik aktif
• Satelit Pengamat: ${satText}
• Tingkat Kepercayaan: Sangat Tinggi (High Confidence)

Keterangan: Hotspot terkonfirmasi satelit pengamat bumi menunjukkan konsentrasi suhu permukaan termal sangat tinggi aktif yang berpotensi kebakaran hutan dan lahan (Karhutla).

Rekomendasi Operasional KPw BI Terdekat (${nearestOfficeName} • ${nearestDistKm} km):
• Pantau Indeks Kualitas Udara (ISPU / PM2.5) di sekitar gedung kantor.
• Siapkan masker respirator partikulat N95 bagi personel operasional.
• Tutup damper intake udara luar HVAC presisi Data Center jika tercium bau asap pekat.

Sumber Data: SIPONGI KEMENHUT / KLHK`.trim();

  return {
    id: `sipongi-karhutla-${cluster.provinsi.toLowerCase().replace(/\s+/g, '-')}-${cluster.kabupaten.toLowerCase().replace(/\s+/g, '-')}-${index}`,
    type: 'karhutla',
    severity: 3 as AlertSeverity,
    provinceId: mapTextToProvinceId(cluster.provinsi),
    title: `Karhutla - Hotspot Sipongi (${cluster.kabupaten})`,
    description,
    timestamp: periodStart,
    validFrom: periodStart,
    validUntil: periodEnd,
    ...(coords ? { latitude: coords[0], longitude: coords[1] } : {}),
    affectedArea: cluster.kabupaten,
    hotspotCount: cluster.counter,
    satellites: cluster.sumberList
  };
}

export const SipongiService = {
  /**
   * Mengambil data titik panas (hotspot) Karhutla dari SIPONGI KLHK.
   * Hanya menampilkan klaster titik panas tingkat SANGAT TINGGI (counter >= 5)
   * dengan konsolidasi multi-satelit (NASA + LAPAN) per kabupaten untuk mencegah spam.
   */
  async fetchKarhutlaAlerts(): Promise<DisasterAlert[]> {
    const apiBase = "https://opsroom.sipongidata.my.id";
    try {
      const periodEnd = new Date();
      const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
      // Query hotspot data from the last 24 hours for both satellites
      const satellites = ["all-lapan", "all-nasa"];
      
      const results = await Promise.all(
        satellites.map(sat => 
          fetchWithCorsProxy(`${apiBase}/api/sebaran?late=24&satelit=${sat}&confidence=high&provinsi=all&length=100`)
        )
      );

      let rawRows: SipongiRow[] = [];
      for (const res of results) {
        if (res && typeof res === 'object' && 'data' in res && Array.isArray(res.data)) {
          rawRows = rawRows.concat(res.data as SipongiRow[]);
        }
      }

      if (rawRows.length === 0) return [];

      // Konsolidasi data multi-satelit per Kabupaten & Provinsi
      const clusterMap = new Map<string, ConsolidatedHotspotCluster>();

      for (const row of rawRows) {
        const provClean = (row.provinsi || '').trim();
        const kabClean = (row.kabupaten || '').trim().toUpperCase();
        if (!kabClean) continue;

        const key = `${provClean}::${kabClean}`;
        const existing = clusterMap.get(key);

        if (existing) {
          existing.counter += (row.counter || 1);
          if (row.sumber && !existing.sumberList.includes(row.sumber)) {
            existing.sumberList.push(row.sumber);
          }
        } else {
          clusterMap.set(key, {
            provinsi: provClean,
            kabupaten: kabClean,
            sumberList: row.sumber ? [row.sumber] : ['Satelit Pengamat'],
            confidence: row.confidence || 'High',
            counter: row.counter || 1
          });
        }
      }

      // Filter sesuai instruksi operasional:
      // 1. Klaster masif nasional: minimal 100 titik panas (counter >= 100)
      // ATAU
      // 2. Sangat dekat dengan kantor KPw BI (radius <= 50 km) dan berindikator sangat tinggi (counter >= 5)
      const qualifiedClusters = Array.from(clusterMap.values())
        .filter((cluster) => {
          if (cluster.counter >= 100) return true;
          if (cluster.counter >= 5) {
            const coords = getSipongiCoordinates(cluster.kabupaten);
            if (!coords) return false;
            const isNearKpw = KPWBI_OFFICES.some((office) => {
              const dist = haversineDistance(coords[0], coords[1], office.latitude, office.longitude);
              return dist <= 50;
            });
            return isNearKpw;
          }
          return false;
        })
        .sort((a, b) => b.counter - a.counter);

      return qualifiedClusters.map((cluster, idx) => clusterToAlert(cluster, idx, periodStart.toISOString(), periodEnd.toISOString()));
    } catch (e) {
      console.warn("Failed to fetch from Sipongi:", e);
      throw e;
    }
  }
};

