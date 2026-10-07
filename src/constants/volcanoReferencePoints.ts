// Public volcano positions from MAGMA Indonesia / PVMBG, https://magma.esdm.go.id/v1.
// Coordinate snapshot retrieved 2026-10-05. Activity levels are deliberately excluded.
export interface VolcanoReferencePoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  province: string;
}

export const VOLCANO_REFERENCE_SOURCE = 'https://magma.esdm.go.id/v1';
export const VOLCANO_REFERENCE_RETRIEVED_AT = '2026-10-05';
export const VOLCANO_REFERENCE_POINTS: VolcanoReferencePoint[] = [
  {
    "id": "AGU",
    "name": "Agung",
    "latitude": -8.342,
    "longitude": 115.508,
    "province": "Bali"
  },
  {
    "id": "AMB",
    "name": "Ambang",
    "latitude": 0.75,
    "longitude": 124.42,
    "province": "Sulawesi Utara"
  },
  {
    "id": "KRA",
    "name": "Anak Krakatau",
    "latitude": -6.102,
    "longitude": 105.423,
    "province": "Lampung"
  },
  {
    "id": "RAN",
    "name": "Anak Ranakah",
    "latitude": -8.62,
    "longitude": 120.52,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "WEL",
    "name": "Arjuno Welirang",
    "latitude": -7.725,
    "longitude": 112.58,
    "province": "Jawa Timur"
  },
  {
    "id": "AWU",
    "name": "Awu",
    "latitude": 3.682846,
    "longitude": 125.45598,
    "province": "Sulawesi Utara"
  },
  {
    "id": "BAN",
    "name": "Banda Api",
    "latitude": -4.523,
    "longitude": 129.881,
    "province": "Maluku"
  },
  {
    "id": "BAT",
    "name": "Batur",
    "latitude": -8.242,
    "longitude": 115.375,
    "province": "Bali"
  },
  {
    "id": "TAR",
    "name": "Batutara",
    "latitude": -7.792,
    "longitude": 123.579,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "BRO",
    "name": "Bromo",
    "latitude": -7.942,
    "longitude": 112.95,
    "province": "Jawa Timur"
  },
  {
    "id": "TEL",
    "name": "Bur Ni Telong",
    "latitude": 4.769,
    "longitude": 96.821,
    "province": "Aceh"
  },
  {
    "id": "CER",
    "name": "Ciremai",
    "latitude": -6.892,
    "longitude": 108.4,
    "province": "Jawa Barat"
  },
  {
    "id": "COL",
    "name": "Colo",
    "latitude": -0.162,
    "longitude": 121.601,
    "province": "Sulawesi Tengah"
  },
  {
    "id": "DEM",
    "name": "Dempo",
    "latitude": -4.03,
    "longitude": 103.13,
    "province": "Sumatera Selatan"
  },
  {
    "id": "DIE",
    "name": "Dieng",
    "latitude": -7.2,
    "longitude": 109.92,
    "province": "Jawa Tengah"
  },
  {
    "id": "DUK",
    "name": "Dukono",
    "latitude": 1.693,
    "longitude": 127.894,
    "province": "Maluku Utara"
  },
  {
    "id": "EBU",
    "name": "Ebulobo",
    "latitude": -8.82,
    "longitude": 121.18,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "EGO",
    "name": "Egon",
    "latitude": -8.676,
    "longitude": 122.455,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "GAL",
    "name": "Galunggung",
    "latitude": -7.25,
    "longitude": 108.058,
    "province": "Jawa Barat"
  },
  {
    "id": "GML",
    "name": "Gamalama",
    "latitude": 0.8,
    "longitude": 127.33,
    "province": "Maluku Utara"
  },
  {
    "id": "GMK",
    "name": "Gamkonora",
    "latitude": 1.38,
    "longitude": 127.53,
    "province": "Maluku Utara"
  },
  {
    "id": "GED",
    "name": "Gede",
    "latitude": -6.77,
    "longitude": 106.965,
    "province": "Jawa Barat"
  },
  {
    "id": "GUN",
    "name": "Guntur",
    "latitude": -7.143,
    "longitude": 107.84,
    "province": "Jawa Barat"
  },
  {
    "id": "HOB",
    "name": "Hobal",
    "latitude": -8.5444,
    "longitude": 123.585,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "IBU",
    "name": "Ibu",
    "latitude": 1.488,
    "longitude": 127.63,
    "province": "Maluku Utara"
  },
  {
    "id": "IJE",
    "name": "Ijen",
    "latitude": -8.058,
    "longitude": 114.242,
    "province": "Jawa Timur"
  },
  {
    "id": "WER",
    "name": "Ile Werung",
    "latitude": -8.53,
    "longitude": 123.57,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "BOL",
    "name": "Ili Boleng",
    "latitude": -8.342,
    "longitude": 123.258,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "LEW",
    "name": "Ili Lewotolok",
    "latitude": -8.272,
    "longitude": 123.505,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "LIK",
    "name": "Inielika",
    "latitude": -8.73,
    "longitude": 120.98,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "RIE",
    "name": "Inierie",
    "latitude": -8.875,
    "longitude": 120.95,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "IYA",
    "name": "Iya",
    "latitude": -8.897,
    "longitude": 121.645,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "KAB",
    "name": "Kaba",
    "latitude": -3.52,
    "longitude": 102.62,
    "province": "Bengkulu"
  },
  {
    "id": "KAR",
    "name": "Karangetang",
    "latitude": 2.78,
    "longitude": 125.406,
    "province": "Sulawesi Utara"
  },
  {
    "id": "KLM",
    "name": "Kelimutu",
    "latitude": -8.77,
    "longitude": 121.82,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "KLD",
    "name": "Kelud",
    "latitude": -7.93,
    "longitude": 112.308,
    "province": "Jawa Timur"
  },
  {
    "id": "KER",
    "name": "Kerinci",
    "latitude": -1.697,
    "longitude": 101.264,
    "province": "Jambi, Sumatera Barat"
  },
  {
    "id": "KIE",
    "name": "Kie Besi",
    "latitude": 0.32,
    "longitude": 127.4,
    "province": "Maluku Utara"
  },
  {
    "id": "LAM",
    "name": "Lamongan",
    "latitude": -7.979,
    "longitude": 113.342,
    "province": "Jawa Timur"
  },
  {
    "id": "LER",
    "name": "Lereboleng",
    "latitude": -8.365,
    "longitude": 122.833,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "LWK",
    "name": "Lewotobi Laki-laki",
    "latitude": -8.5389,
    "longitude": 122.7682,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "LWP",
    "name": "Lewotobi Perempuan",
    "latitude": -8.5539,
    "longitude": 122.7805,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "LOK",
    "name": "Lokon",
    "latitude": 1.358,
    "longitude": 124.792,
    "province": "Sulawesi Utara"
  },
  {
    "id": "MAH",
    "name": "Mahawu",
    "latitude": 1.352,
    "longitude": 124.865,
    "province": "Sulawesi Utara"
  },
  {
    "id": "MAR",
    "name": "Marapi",
    "latitude": -0.381,
    "longitude": 100.473,
    "province": "Sumatera Barat"
  },
  {
    "id": "MER",
    "name": "Merapi",
    "latitude": -7.542,
    "longitude": 110.442,
    "province": "Daerah Istimewa Yogyakarta dan Jawa Tengah"
  },
  {
    "id": "PAP",
    "name": "Papandayan",
    "latitude": -7.32,
    "longitude": 107.73,
    "province": "Jawa Barat"
  },
  {
    "id": "PEU",
    "name": "Peut Sague",
    "latitude": 4.914,
    "longitude": 96.329,
    "province": "Daerah Istimewa Aceh"
  },
  {
    "id": "RAU",
    "name": "Raung",
    "latitude": -8.125,
    "longitude": 114.042,
    "province": "Jawa Timur"
  },
  {
    "id": "RIN",
    "name": "Rinjani",
    "latitude": -8.42,
    "longitude": 116.47,
    "province": "Nusa Tenggara Barat"
  },
  {
    "id": "ROK",
    "name": "Rokatenda",
    "latitude": -8.32,
    "longitude": 121.708,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "RUA",
    "name": "Ruang",
    "latitude": 2.3031,
    "longitude": 125.3667,
    "province": "Sulawesi Utara"
  },
  {
    "id": "SAL",
    "name": "Salak",
    "latitude": -6.72,
    "longitude": 106.73,
    "province": "Jawa Barat"
  },
  {
    "id": "SAN",
    "name": "Sangeangapi",
    "latitude": -8.2,
    "longitude": 119.07,
    "province": "Nusa Tenggara Barat"
  },
  {
    "id": "SMR",
    "name": "Semeru",
    "latitude": -8.108,
    "longitude": 112.92,
    "province": "Jawa Timur"
  },
  {
    "id": "SEU",
    "name": "Seulawah Agam",
    "latitude": 5.448,
    "longitude": 95.658,
    "province": "Daerah Istimewa Aceh"
  },
  {
    "id": "SIN",
    "name": "Sinabung",
    "latitude": 3.17,
    "longitude": 98.392,
    "province": "Sumatera Utara"
  },
  {
    "id": "SIR",
    "name": "Sirung",
    "latitude": -8.508,
    "longitude": 124.13,
    "province": "Nusa Tenggara Timur"
  },
  {
    "id": "SLA",
    "name": "Slamet",
    "latitude": -7.242,
    "longitude": 109.208,
    "province": "Jawa Tengah"
  },
  {
    "id": "SOP",
    "name": "Soputan",
    "latitude": 1.1145,
    "longitude": 124.737,
    "province": "Sulawesi Utara"
  },
  {
    "id": "SOR",
    "name": "Sorikmarapi",
    "latitude": 0.686,
    "longitude": 99.537,
    "province": "Sumatera Utara"
  },
  {
    "id": "SBG",
    "name": "Sumbing",
    "latitude": -7.384,
    "longitude": 110.07,
    "province": "Jawa Tengah"
  },
  {
    "id": "SUN",
    "name": "Sundoro",
    "latitude": -7.3,
    "longitude": 109.992,
    "province": "Jawa Tengah"
  },
  {
    "id": "TAL",
    "name": "Talang",
    "latitude": -0.978,
    "longitude": 100.679,
    "province": "Sumatera Barat"
  },
  {
    "id": "TAM",
    "name": "Tambora",
    "latitude": -8.25,
    "longitude": 118,
    "province": "Nusa Tenggara Barat"
  },
  {
    "id": "TAN",
    "name": "Tandikat",
    "latitude": -0.39,
    "longitude": 100.331,
    "province": "Sumatera Barat"
  },
  {
    "id": "TGK",
    "name": "Tangkoko",
    "latitude": 1.518,
    "longitude": 125.185,
    "province": "Sulawesi Utara"
  },
  {
    "id": "TPR",
    "name": "Tangkuban Parahu",
    "latitude": -6.77,
    "longitude": 107.6,
    "province": "Jawa Barat"
  },
  {
    "id": "WUR",
    "name": "Wurlali",
    "latitude": -7.125,
    "longitude": 128.675,
    "province": "Maluku"
  }
];
