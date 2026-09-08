export interface ChecklistItemDef {
  id: string;
  label: string;
  description: string;
  category: 'umum' | 'gempa' | 'banjir';
  floodOnly?: boolean;
  gempaOnly?: boolean;
}

export const CHECKLIST_ITEMS: ChecklistItemDef[] = [
  {
    id: 'fasilitas-umum',
    label: 'Kelengkapan Fasilitas Kpw',
    description:
      'Kotak P3K, senter/lampu darurat, radio komunikasi cadangan, dan prosedur evakuasi tersedia di gedung.',
    category: 'umum',
  },
  {
    id: 'asesmen-gedung',
    label: 'Asesmen Gedung oleh Satker Dpan',
    description:
      'Gedung KPw telah dilakukan asesmen struktural dan keandalan bangunan oleh Satker Departemen Pengembangan dan Pengawasan (Dpan) atau konsultan terakreditasi.',
    category: 'gempa',
    gempaOnly: true,
  },
  {
    id: 'simulasi-gempa',
    label: 'Simulasi Gempa Rutin',
    description:
      'KPw telah melakukan simulasi evakuasi gempa bumi minimal sekali dalam setahun bersama seluruh pegawai.',
    category: 'gempa',
    gempaOnly: true,
  },
  {
    id: 'jalur-evakuasi',
    label: 'Jalur Evakuasi & Titik Kumpul',
    description:
      'Jalur evakuasi darurat dan titik kumpul (meeting point) sudah ditandai, dikomunikasikan, dan diketahui seluruh pegawai.',
    category: 'gempa',
  },
  {
    id: 'perahu-karet',
    label: 'Ketersediaan Perahu Karet',
    description:
      'Perahu karet/inflatable rescue boat tersedia atau ada kesepakatan peminjaman dari instansi terkait untuk wilayah dengan risiko banjir tinggi.',
    category: 'banjir',
    floodOnly: true,
  },
  {
    id: 'filter-hvac-drc',
    label: 'Proteksi Filter AC / Data Center dari Abu Vulkanik',
    description:
      'Damper intake udara luar AC presisi server/DRC dapat ditutup rapat dan filter silika/HEPA cadangan siap dipasang guna mencegah kerusakan sirkuit elektronik akibat abu silika korosif.',
    category: 'umum',
  },
  {
    id: 'kontinjensi-kas-bandara',
    label: 'Kontinjensi Distribusi Kas (Jalur Alternatif Laut/Darat)',
    description:
      'SOP pengalihan pengiriman uang kas rupiah melalui dermaga kapal/jalur darat jika bandara regional terdekat ditutup akibat sebaran abu vulkanik (NOTAM closure).',
    category: 'umum',
  },
  {
    id: 'apd-masker-vulkanik',
    label: 'Stok Masker N95 & Pelindung Debu Pegawai',
    description:
      'Tersedia persediaan masker partikulat N95/FFP2 dan pelindung mata dalam jumlah memadai untuk seluruh pegawai jika terjadi paparan sebaran abu vulkanik.',
    category: 'umum',
  },
];

export type ChecklistStatus = Record<string, boolean>; // itemId → checked
