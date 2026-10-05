export interface RingOfFireArc {
  id: string;
  name: string;
  path: [number, number][]; // [lat, lng]
  color: string;
  impactRadiusKm: number;
}

export interface VolcanoPoint {
  name: string;
  lat: number;
  lng: number;
  provinceId: string;
}

// Major volcanic arc segments in Indonesia
export const RING_OF_FIRE_ARCS: RingOfFireArc[] = [
  {
    id: 'arc-sunda',
    name: 'Busur Sunda',
    path: [
      [5.5, 95.3],   // Aceh
      [3.6, 98.7],   // Medan
      [2.9, 99.1],
      [1.7, 98.8],
      [-0.4, 100.5], // Padang / Marapi
      [-1.7, 101.3], // Kerinci
      [-3.8, 102.3], // Bengkulu
      [-5.4, 104.5], // Lampung / Krakatau
      [-6.1, 105.4], // Anak Krakatau
      [-6.9, 107.6], // Bandung / Tangkuban
      [-7.4, 109.2], // Purwokerto
      [-7.8, 110.4], // Merapi / Yogyakarta
      [-8.1, 112.9], // Semeru
      [-8.5, 115.2], // Bali / Agung
      [-8.6, 116.1], // Lombok / Rinjani
      [-8.7, 118.0], // Sumbawa
      [-9.0, 119.5],
      [-10.2, 120.5], // Flores
      [-8.5, 122.5],  // Lewotobi
      [-8.3, 123.5],  // Ili Lewotolok
    ],
    color: '#ef4444',
    impactRadiusKm: 200,
  },
  {
    id: 'arc-banda',
    name: 'Busur Banda',
    path: [
      [-8.8, 124.5],
      [-9.0, 126.0],
      [-7.5, 128.0],
      [-5.5, 130.0],
      [-4.0, 130.5],
      [-3.7, 128.2], // Maluku
    ],
    color: '#f97316',
    impactRadiusKm: 180,
  },
  {
    id: 'arc-sulawesi-halmahera',
    name: 'Busur Sulawesi-Halmahera',
    path: [
      [-3.7, 128.2], // Ambon area
      [-0.9, 127.4], // Ternate
      [0.8, 127.3],  // Gamalama (Ternate)
      [1.7, 127.9],  // Dukono (Halmahera)
      [3.7, 125.4],  // Awu (Sangihe)
      [1.5, 124.8],  // Manado
      [0.5, 123.1],  // Gorontalo
    ],
    color: '#a855f7',
    impactRadiusKm: 180,
  },
];

// Reference volcano identities and coordinates.
export const VOLCANO_POINTS: VolcanoPoint[] = [
  { name: 'Awu', lat: 3.682, lng: 125.446, provinceId: 'ID-SA' },
  { name: 'Lewotobi Laki-laki', lat: -8.542, lng: 122.775, provinceId: 'ID-NT' },
  { name: 'Merapi', lat: -7.540, lng: 110.446, provinceId: 'ID-YO' },
  { name: 'Semeru', lat: -8.108, lng: 112.922, provinceId: 'ID-JI' },
  { name: 'Anak Krakatau', lat: -6.102, lng: 105.423, provinceId: 'ID-LA' },
  { name: 'Bromo', lat: -7.942, lng: 112.953, provinceId: 'ID-JI' },
  { name: 'Dukono', lat: 1.693, lng: 127.894, provinceId: 'ID-MU' },
  { name: 'Gamalama', lat: 0.80, lng: 127.325, provinceId: 'ID-MU' },
  { name: 'Ili Lewotolok', lat: -8.272, lng: 123.505, provinceId: 'ID-NT' },
  { name: 'Kerinci', lat: -1.697, lng: 101.264, provinceId: 'ID-JA' },
  { name: 'Marapi', lat: -0.381, lng: 100.473, provinceId: 'ID-SB' },
  { name: 'Sinabung', lat: 3.170, lng: 98.392, provinceId: 'ID-SU' },
  { name: 'Agung', lat: -8.343, lng: 115.508, provinceId: 'ID-BA' },
  { name: 'Rinjani', lat: -8.412, lng: 116.467, provinceId: 'ID-NB' },
];
