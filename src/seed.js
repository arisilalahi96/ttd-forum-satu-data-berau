'use strict';

const DOCUMENT_META = {
  id: 'ba-fsd-berau-2026-v2',
  titleLines: [
    'BERITA ACARA HASIL KESEPAKATAN',
    'FORUM SATU DATA KABUPATEN BERAU',
    'TAHUN 2026',
  ],
  documentNumber: 'Nomor :             /       /Bapp-II/2026',
  openingParagraph:
    'Pada hari ini Rabu, tanggal Dua Puluh Lima, bulan November, Tahun Dua Ribu Dua Puluh Enam, di Ruang Rapat RKPD Badan Perencanaan Pembangunan, Riset dan Inovasi Daerah Kabupaten Berau dan secara online melalui Zoom Meeting, telah dilaksanakan Forum Satu Data Kabupaten Berau yang dihadiri oleh para pemangku kepentingan, sebagaimana tercantum pada daftar peserta pada Lampiran I Berita Acara ini:',
  considerationsHeading: 'Setelah mendengar, memperhatikan, dan mempertimbangkan:',
  considerations: [
    'Arahan Bupati Berau yang diwakili oleh Kepala Badan Perencanaan Pembangunan, Riset dan Inovasi Daerah Kabupaten Berau, Ibu Ir. Endah Ernany Triariani, M.Si.;',
    'Penyampaian materi Koordinator Satu Data Kabupaten Berau oleh Kepala Badan Perencanaan Pembangunan, Riset dan Inovasi Daerah Kabupaten Berau, Ibu Ir. Endah Ernany Triariani, M.Si. dengan tema “…………………”;',
    'Penyampaian materi Kepala Badan Pusat Statistik Kabupaten Berau oleh Bapak Yudi Wahyudin, S.ST., M.Si. dengan tema “Sigap Berau”;',
    'Penyampaian materi Kepala Dinas Komunikasi dan Informatika Kabupaten Berau oleh Bapak Saleh, SE dengan tema “……………….”;',
    'Penyampaian materi Pembina Statistik Sektoral oleh Ibu Lita Januarti Hakim, S.ST., M.Si. dengan tema “Penguatan Aliran Data Statistik Sektoral dari Produsen Data hingga Pemanfaatannya”;',
    'Hasil pemilahan, verifikasi dan persetujuan data daerah tahun 2026 oleh perangkat daerah:',
  ],
  eventLead: 'Maka pada:',
  eventDetails: [
    { label: 'Hari dan tanggal', value: 'Rabu, 25 November 2026' },
    { label: 'Waktu', value: 'Pukul 08.00 – 12.00 WITA' },
    {
      label: 'Tempat',
      value:
        'Ruang Rapat RKPD Badan Perencanaan Pembangunan, Riset dan Inovasi Daerah Kabupaten Berau dan melalui Zoom Meeting',
    },
  ],
  agreementLead: 'Seluruh peserta Forum Satu Data Tahun 2026',
  agreementHeading: 'MENYEPAKATI',
  agreements: [
    {
      label: 'Kesatu',
      value: 'Penyepakatan daftar data tahun 2026 sebagaimana tercantum pada Lampiran II berita acara ini;',
    },
    {
      label: 'Kedua',
      value:
        'Rencana Aksi Satu Data Kabupaten Berau Tahun 2027-2029 sebagaimana tercantum dalam Lampiran III berita acara ini;',
    },
  ],
  closingParagraph:
    'Demikian berita acara kesepakatan ini dibuat dan disahkan untuk digunakan sebagaimana mestinya.',
  representativesHeading: 'Mewakili unsur peserta Forum Satu Data Tahun 2026',
  lampiranHeading: 'LAMPIRAN I',
  lampiranSubheading:
    'Pihak di bawah ini telah hadir dan menyepakati Hasil Forum Satu Data Tahun 2026',
};

const RAW_REPRESENTATIVES = [
  {
    id: 'rep-1',
    slotOrder: 1,
    name: 'Muhammad Said, SH., MH',
    role: 'Sekretaris Daerah',
    roleLines: ['Sekretaris Daerah'],
  },
  {
    id: 'rep-2',
    slotOrder: 2,
    name: 'Ir. Endah Ernany Triariani, M.Si',
    role: 'Kepala BAPPERIDA Kabupaten Berau — Selaku Koordinator Forum Satu Data',
    roleLines: ['Kepala BAPPERIDA Kabupaten Berau', 'Selaku', 'Koordinator Forum Satu Data'],
  },
  {
    id: 'rep-3',
    slotOrder: 3,
    name: 'Yudi Wahyudin, S.ST., M.Si',
    role: 'Kepala BPS Kabupaten Berau — Selaku Pembina Data Statistik',
    roleLines: ['Kepala BPS Kabupaten Berau', 'Selaku', 'Pembina Data Statistik'],
  },
  {
    id: 'rep-4',
    slotOrder: 4,
    name: 'H. Didi Rahmadi, S.Sos., MM',
    role: 'Kepala DISKOMINFO Kabupaten Berau — Selaku Walidata',
    roleLines: ['Kepala DISKOMINFO Kabupaten Berau', 'Selaku', 'Walidata'],
  },
];

const RAW_LAMPIRAN_SIGNATORIES = [
  [1, 'Ir. Endah Ernany Triariani, M.Si', 'Kepala Badan Perencanaan Pembangunan, Riset dan Inovasi Daerah'],
  [2, 'Yudi Wahyudin, S.ST., M.Si', 'Kepala BPS Kabupaten Berau'],
  [3, 'H. Didi Rahmadi, S.Sos., MM', 'Kepala Dinas Komunikasi dan Informatika'],
  [4, 'H. Jaka Siswanta, SH., M.Si', 'Kepala Badan Kepegawaian dan Pengembangan Sumber Daya Manusia'],
  [5, 'Drs. Salim', 'Kepala Badan Kesatuan Bangsa dan Politik'],
  [6, 'Dr. H. Djupiansyah Ganie, SE., M.Si', 'Kepala Badan Pendapatan Daerah'],
  [7, 'H. Masyadi Muhdi, S.Hut., M.Si', 'Kepala Badan Penanggulangan Bencana Daerah'],
  [8, 'Sapransyah, S.STP', 'Kepala Badan Pengelolaan Keuangan dan Aset Daerah'],
  [9, 'Ir. H. Riza Fakhmi', 'Inspektur Inspektorat'],
  [10, 'Risma Rosehan, SE', 'Kepala Satuan Polisi Pamong Praja'],
  [11, 'H. Zulkifli Azhari, SH., M.A.P', 'Kepala Dinas Lingkungan Hidup dan Kebersihan'],
  [12, 'Ir. Hj. Tenteram Rahayu', 'Kepala Dinas Pemberdayaan Masyarakat dan Kampung'],
  [13, 'Arif Rudi Hermawan, S.Si., M.Si., Apt', 'Kepala Dinas Pangan'],
  [14, 'H. Nanang Bakran, ST., MT', 'Kepala Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu'],
  [15, 'Aidil Fitri, S.ST., M.P', 'Kepala Dinas Pengendalian Penduduk dan KB, Pemberdayaan Perempuan dan Perlindungan Anak'],
  [16, 'Lamlay Sarie, S.Si., Apt., M.Sc.', 'Kepala Dinas Kesehatan'],
  [17, 'Drs. Yudha Budisantosa, M.Si', 'Kepala Dinas Kebudayaan dan Pariwisata'],
  [18, 'Fendra Firnawan, ST., M.Si', 'Kepala Dinas Pekerjaan Umum dan Penataan Ruang'],
  [19, 'Hj. Mardiatul Idalisah, S.Pd., M.M', 'Kepala Dinas Pendidikan'],
  [20, 'Rusnan Hefni, M.T', 'Kepala Dinas Perhubungan'],
  [21, 'Abdul Madjid, S.Pi., M.Si', 'Kepala Dinas Perikanan'],
  [22, 'Hj. Eva Yunita, SE., MM', 'Kepala Dinas Koperasi, Perindustrian dan Perdagangan'],
  [23, 'Ir. Lita Handini', 'Kepala Dinas Tanaman Pangan, Hortikultura dan Peternakan'],
  [24, 'H. Zulkifli Azhari, SH., M.A.P', 'Kepala Dinas Sosial'],
  [25, 'H. Anang Saprani, SH., M.Si', 'Kepala Dinas Tenaga Kerja dan Transmigrasi'],
  [26, 'David Pamuji, S.STP., M.Si', 'Kepala Dinas Kependudukan dan Pencatatan Sipil'],
  [27, 'Dr. Ir. H. Andi Marewangeng, S.T., M.T', 'Kepala Dinas Kepemudaan dan Olahraga'],
  [28, 'Tri Anggoro Raharjo, S.Si., M.Si', 'Kepala Dinas Perkebunan'],
  [29, 'H. Mulyadi, SE., M.Si', 'Kepala Dinas Perumahan dan Kawasan Permukiman'],
  [30, 'Drs. Yudha Budisantosa, M.Si', 'Kepala Dinas Perpustakaan dan Kearsipan'],
  [31, 'Sulaiman, SH', 'Kepala Dinas Pertanahan'],
  [32, 'H. Rakhmadi Pasarakan, S.Hut., M.Sc', 'Kepala Dinas Pemadam Kebakaran dan Penyelamatan'],
  [33, 'dr. Jusram, Sp.PD., FINASIM', 'Direktur RSUD dr. Abdul Rivai'],
  [34, 'Ahmad Juhri, S.ST., MP.SSp', 'Camat Tanjung Redeb'],
  [35, 'Lutfi Hidayat, SE', 'Camat Gunung Tabur'],
  [36, 'Nur Alam, S.STP', 'Camat Sambaliung'],
  [37, 'Edi Baskoro, S.STP', 'Camat Teluk Bayur'],
  [38, 'Toris, SH', 'Camat Segah'],
  [39, 'H. Muh. Saleh, S.P., M.A.P.', 'Camat Kelay'],
  [40, 'Ashari, SE', 'Camat Maratua'],
  [41, 'Ariyanto, SE', 'Camat Pulau Derawan'],
  [42, 'Wahyudi, S.STP., M.E', 'Camat Tabalar'],
  [43, 'Rusdiansyah, SE', 'Camat Biatan'],
  [44, 'Mutmainnah, SE', 'Camat Talisayan'],
  [45, 'Firmansyah, SE', 'Camat Batu Putih'],
  [46, 'Cipto Supratmono, SE', 'Camat Biduk-Biduk'],
];

function classifyInstansiGroup(role, isRepresentative = false, isCustom = false) {
  if (isRepresentative) return 'Perwakilan Unsur';
  if (isCustom) return 'Peserta Tambahan';
  const r = String(role || '').toLowerCase();
  if (r.includes('camat')) return 'Kecamatan (Camat)';
  if (r.includes('dinas') || r.includes('rsud') || r.includes('direktur')) return 'Dinas & RSUD';
  if (
    r.includes('badan') ||
    r.includes('bps') ||
    r.includes('inspektorat') ||
    r.includes('satuan polisi') ||
    r.includes('satpol')
  ) {
    return 'Badan, Inspektorat & Satpol PP';
  }
  return 'Lainnya';
}

function createInitialSignatories() {
  const list = [];

  // 4 Unsur Perwakilan Forum (Page 1/2 2x2 Signature Grid)
  for (const rep of RAW_REPRESENTATIVES) {
    list.push({
      id: rep.id,
      rowNumber: rep.slotOrder - 10, // negative so reps sort cleanly above Lampiran I 1..46
      repOrder: rep.slotOrder,
      isRepresentative: true,
      isCustom: false,
      instansiGroup: 'Perwakilan Unsur',
      name: rep.name,
      role: rep.role,
      roleLines: [...rep.roleLines],
      signed: false,
      signatureMethod: null,
      signedAt: null,
      signatureWidth: null,
      signatureHeight: null,
      signatureVersion: 0,
    });
  }

  // 46 Pihak Lampiran I
  for (const [no, name, role] of RAW_LAMPIRAN_SIGNATORIES) {
    list.push({
      id: `row-${no}`,
      rowNumber: no,
      repOrder: null,
      isRepresentative: false,
      isCustom: false,
      instansiGroup: classifyInstansiGroup(role, false, false),
      name,
      role,
      roleLines: null,
      signed: false,
      signatureMethod: null,
      signedAt: null,
      signatureWidth: null,
      signatureHeight: null,
      signatureVersion: 0,
    });
  }

  return list;
}

function cloneDefaultDocumentMeta() {
  return JSON.parse(JSON.stringify(DOCUMENT_META));
}

module.exports = {
  DOCUMENT_META,
  RAW_REPRESENTATIVES,
  RAW_LAMPIRAN_SIGNATORIES,
  classifyInstansiGroup,
  createInitialSignatories,
  cloneDefaultDocumentMeta,
};
