import type { Province } from '../types/index.ts';

export const PROVINCES: Province[] = [
  // Sumatera Island Group
  { id: 'ID-AC', name: 'Aceh', capital: 'Banda Aceh', latitude: 5.5483, longitude: 95.3238, island: 'Sumatera' },
  { id: 'ID-SU', name: 'Sumatera Utara', capital: 'Medan', latitude: 3.5952, longitude: 98.6722, island: 'Sumatera' },
  { id: 'ID-SB', name: 'Sumatera Barat', capital: 'Padang', latitude: -0.9471, longitude: 100.4172, island: 'Sumatera' },
  { id: 'ID-RI', name: 'Riau', capital: 'Pekanbaru', latitude: 0.5071, longitude: 101.4478, island: 'Sumatera' },
  { id: 'ID-JA', name: 'Jambi', capital: 'Jambi', latitude: -1.6101, longitude: 103.6131, island: 'Sumatera' },
  { id: 'ID-SS', name: 'Sumatera Selatan', capital: 'Palembang', latitude: -2.9909, longitude: 104.7566, island: 'Sumatera' },
  { id: 'ID-BE', name: 'Bengkulu', capital: 'Bengkulu', latitude: -3.7928, longitude: 102.2608, island: 'Sumatera' },
  { id: 'ID-LA', name: 'Lampung', capital: 'Bandar Lampung', latitude: -5.3971, longitude: 105.2668, island: 'Sumatera' },
  { id: 'ID-BB', name: 'Kepulauan Bangka Belitung', capital: 'Pangkal Pinang', latitude: -2.1319, longitude: 106.1161, island: 'Sumatera' },
  { id: 'ID-KR', name: 'Kepulauan Riau', capital: 'Tanjung Pinang', latitude: 0.9169, longitude: 104.4585, island: 'Sumatera' },

  // Jawa Island Group
  { id: 'ID-JK', name: 'DKI Jakarta', capital: 'Jakarta', latitude: -6.2088, longitude: 106.8456, island: 'Jawa' },
  { id: 'ID-JB', name: 'Jawa Barat', capital: 'Bandung', latitude: -6.9175, longitude: 107.6191, island: 'Jawa' },
  { id: 'ID-JT', name: 'Jawa Tengah', capital: 'Semarang', latitude: -6.9667, longitude: 110.4167, island: 'Jawa' },
  { id: 'ID-YO', name: 'DI Yogyakarta', capital: 'Yogyakarta', latitude: -7.7956, longitude: 110.3695, island: 'Jawa' },
  { id: 'ID-JI', name: 'Jawa Timur', capital: 'Surabaya', latitude: -7.2575, longitude: 112.7521, island: 'Jawa' },
  { id: 'ID-BT', name: 'Banten', capital: 'Serang', latitude: -6.1104, longitude: 106.1622, island: 'Jawa' },

  // Bali & Nusa Tenggara
  { id: 'ID-BA', name: 'Bali', capital: 'Denpasar', latitude: -8.6705, longitude: 115.2126, island: 'Bali & Nusa Tenggara' },
  { id: 'ID-NB', name: 'Nusa Tenggara Barat', capital: 'Mataram', latitude: -8.5833, longitude: 116.1167, island: 'Bali & Nusa Tenggara' },
  { id: 'ID-NT', name: 'Nusa Tenggara Timur', capital: 'Kupang', latitude: -10.1772, longitude: 123.6078, island: 'Bali & Nusa Tenggara' },

  // Kalimantan Island Group
  { id: 'ID-KB', name: 'Kalimantan Barat', capital: 'Pontianak', latitude: -0.0263, longitude: 109.3425, island: 'Kalimantan' },
  { id: 'ID-KT', name: 'Kalimantan Tengah', capital: 'Palangka Raya', latitude: -2.2161, longitude: 113.9145, island: 'Kalimantan' },
  { id: 'ID-KS', name: 'Kalimantan Selatan', capital: 'Banjarmasin', latitude: -3.3186, longitude: 114.5944, island: 'Kalimantan' },
  { id: 'ID-KI', name: 'Kalimantan Timur', capital: 'Samarinda', latitude: -0.5022, longitude: 117.1536, island: 'Kalimantan' },
  { id: 'ID-KU', name: 'Kalimantan Utara', capital: 'Tanjung Selor', latitude: 2.8375, longitude: 117.3653, island: 'Kalimantan' },

  // Sulawesi Island Group
  { id: 'ID-SA', name: 'Sulawesi Utara', capital: 'Manado', latitude: 1.4748, longitude: 124.8428, island: 'Sulawesi' },
  { id: 'ID-ST', name: 'Sulawesi Tengah', capital: 'Palu', latitude: -0.8917, longitude: 119.8708, island: 'Sulawesi' },
  { id: 'ID-SN', name: 'Sulawesi Selatan', capital: 'Makassar', latitude: -5.1477, longitude: 119.4327, island: 'Sulawesi' },
  { id: 'ID-SG', name: 'Sulawesi Tenggara', capital: 'Kendari', latitude: -3.9722, longitude: 122.5144, island: 'Sulawesi' },
  { id: 'ID-GO', name: 'Gorontalo', capital: 'Gorontalo', latitude: 0.5435, longitude: 123.0568, island: 'Sulawesi' },
  { id: 'ID-SR', name: 'Sulawesi Barat', capital: 'Mamuju', latitude: -2.6736, longitude: 118.8914, island: 'Sulawesi' },

  // Maluku & Papua
  { id: 'ID-MA', name: 'Maluku', capital: 'Ambon', latitude: -3.6954, longitude: 128.1814, island: 'Maluku & Papua' },
  { id: 'ID-MU', name: 'Maluku Utara', capital: 'Sofifi', latitude: 0.7414, longitude: 127.6163, island: 'Maluku & Papua' },
  { id: 'ID-PB', name: 'Papua Barat', capital: 'Manokwari', latitude: -0.8614, longitude: 134.0620, island: 'Maluku & Papua' },
  { id: 'ID-PA', name: 'Papua', capital: 'Jayapura', latitude: -2.5413, longitude: 140.7121, island: 'Maluku & Papua' },
  { id: 'ID-PS', name: 'Papua Selatan', capital: 'Merauke', latitude: -8.4991, longitude: 140.4022, island: 'Maluku & Papua' },
  { id: 'ID-PT', name: 'Papua Tengah', capital: 'Nabire', latitude: -3.3667, longitude: 135.4833, island: 'Maluku & Papua' },
  { id: 'ID-PE', name: 'Papua Pegunungan', capital: 'Wamena', latitude: -4.0950, longitude: 138.9482, island: 'Maluku & Papua' },
  { id: 'ID-PD', name: 'Papua Barat Daya', capital: 'Sorong', latitude: -0.8765, longitude: 131.2514, island: 'Maluku & Papua' }
];

export const ISLAND_GROUPS = [
  'Sumatera',
  'Jawa',
  'Bali & Nusa Tenggara',
  'Kalimantan',
  'Sulawesi',
  'Maluku & Papua'
];
