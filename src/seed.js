'use strict';

const DOCUMENT_META = {
  id: 'ba-fsd-berau-2026',
  titleLines: [
    'BERITA ACARA',
    'KESEPAKATAN FORUM SATU DATA',
    'KABUPATEN BERAU',
    'TAHUN 2026',
  ],
  shortTitle: 'Forum Satu Data Kabupaten Berau 2026',
  eventDateLabel: 'Rabu, 25 November 2026',
  venue: 'Ruang Rapat RKPD Badan Perencanaan Pembangunan, Riset dan Inovasi Daerah Kabupaten Berau',
  paragraphsBeforePoints: [
    'Pada hari, Rabu tanggal Dua Puluh Lima bulan November tahun Dua Ribu Dua Puluh Enam, bertempat di Ruang Rapat RKPD Badan Perencanaan Pembangunan, Riset dan Inovasi Daerah Kabupaten Berau telah dilaksanakan Forum Satu Data Kabupaten Berau Tahun 2026.',
    'Forum ini diselenggarakan dalam rangka pelaksanaan kebijakan Satu Data Indonesia sebagaimana diatur dalam Peraturan Presiden Nomor 39 Tahun 2019 tentang Satu Data Indonesia, serta untuk meningkatkan keterpaduan perencanaan, pengelolaan, dan pemanfaatan data pembangunan di Kabupaten Berau.',
    'Berdasarkan hasil pembahasan dan kesepakatan bersama seluruh peserta forum yang terdiri dari unsur Pembina Data, Walidata, serta Organisasi Perangkat Daerah (OPD) selaku Produsen Data, maka disepakati hal-hal sebagai berikut:',
  ],
  agreementPoints: [
    'Menyepakati Daftar Data Kabupaten Berau Tahun 2027, berdasarkan Hasil Pra-Forum dan Verifikasi Data.',
    'Menyepakati Rencana Aksi Satu Data Kabupaten Berau Tahun 2027-2029 yang memuat kegiatan pengelolaan data per OPD, termasuk pemenuhan standar data, metadata, interoperabilitas data, dan pemanfaatan data.',
    'Setiap OPD sebagai produsen data bertanggung jawab untuk memastikan ketersediaan dan keterisian dari daftar data yang telah disepakati sesuai dengan jadwal dan target yang ditetapkan.',
    'Rencana Aksi Satu Data Kabupaten Berau Tahun 2027-2029 menjadi dasar dalam pelaksanaan pengelolaan data daerah serta bahan penetapan kebijakan lebih lanjut oleh Pemerintah Kabupaten Berau.',
  ],
  closingParagraph:
    'Demikian Berita Acara Kesepakatan Forum Satu Data Kabupaten Berau Tahun 2026 ini dibuat dan disepakati untuk dipergunakan sebagaimana mestinya.',
  leaderBlock: {
    lines: ['Mengetahui', 'Pimpinan Rapat Forum Data', 'Kabupaten Berau,', 'Bupati'],
    name: 'HJ. SRI JUNIARSIH MAS, M.PD.',
    role: 'Bupati Berau — Pimpinan Rapat Forum Data Kabupaten Berau',
  },
};

function classifyCategory(role, isLeader = false, isCustom = false) {
  if (isLeader) return 'Pimpinan Rapat';
  if (isCustom) return 'Peserta Tambahan';
  const r = (role || '').toLowerCase();
  if (r.startsWith('sekretaris daerah') || r.startsWith('asisten ')) return 'Sekda & Asisten';
  if (r.startsWith('staf ahli')) return 'Staf Ahli';
  if (r.startsWith('kepala bagian')) return 'Kepala Bagian';
  if (r.startsWith('kepala badan')) return 'Kepala Badan';
  if (r.startsWith('kepala dinas')) return 'Kepala Dinas';
  if (r.startsWith('sekretaris ')) return 'Sekretaris';
  if (r.startsWith('camat ')) return 'Camat';
  return 'Lainnya';
}

const RAW_TABLE_SIGNATORIES = [
  [1, 'Muhammad Said', 'Sekretaris Daerah'],
  [2, 'Hendratno', 'Asisten Pemerintahan dan Kesra'],
  [3, 'Mustakimsuharjana', 'Asisten Pembangunan dan Perekonomian'],
  [4, 'Maulidiyah', 'Asisten Administrasi Umum'],
  [5, 'Junaidi', 'Staf Ahli Bidang Keuangan dan Sumber Daya Manusia'],
  [6, 'Andi Marewangeng', 'Staf Ahli Bidang Pembangunan dan Ekonomi'],
  [7, 'Warji', 'Staf Ahli Bidang Pemerintahan, Politik Hukum dan Kesejahteraan Rakyat'],
  [8, 'Sofyan Widodo', 'Kepala Bagian Hukum dan Kerjasama Daerah'],
  [9, 'Endang Iriani', 'Kepala Bagian Perencanaan dan Keuangan'],
  [10, 'Ismiyanto', 'Kepala Bagian Admnistrasi dan Pembangunan'],
  [11, 'Kesuma Sirajuddin', 'Kepala Bagian Umum'],
  [12, 'Slamet Riyadi', 'Kepala Bagian Ekonomi'],
  [13, 'Toto Marjito', 'Kepala Bagian Kesejahteraan Rakyat'],
  [14, 'Agus Sutanto', 'Kepala Bagian Protokol dan Komunikasi Pimpinan'],
  [15, 'Jimmy Arwi SIregar', 'Kepala Bagian Layanan Pengadaan Barang dan Jasa'],
  [16, 'M Ali Hanapiah', 'Kepala Bagian Organisasi'],
  [17, 'Jaka Siswanta', 'Kepala Badan Kepegawaian Pendidikan dan SDM'],
  [18, 'Masyhadi Muhdi', 'Kepala Badan Penanggulangan Bencana Daerah'],
  [19, 'Endah Ernany Triariani', 'Kepala Badan Penelitian dan Pengembangan'],
  [20, 'Sapransyah', 'Kepala Badan Pengelolaan Keuangan dan Aset Daerah'],
  [21, 'Salim', 'Kepala Badan Kesatuan Bangsa dan Politik'],
  [22, 'Djupiansyah Ganie', 'Kepala Badan Pendapatan Daerah'],
  [23, 'Lita Handini', 'Kepala Dinas Tanaman Pangan, Hortikultura dan Peternakan'],
  [24, 'Mulyadi', 'Kepala Dinas Perumahan dan Kawasan Permukiman'],
  [25, 'Rabiatul Islamiah', 'Kepala Dinas Perpustakaan dan Kearsipan'],
  [26, 'Nanang Bakran', 'Kepala Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu'],
  [27, 'Zulkifli Ashari', 'Kepala Dinas Lingkungan Hidup dan Kebersihan'],
  [28, 'Anang Saprani', 'Kepala Dinas Tenaga Kerja dan Transmigrasi'],
  [29, 'Rusnan Hefni', 'Kepala Dinas Perhubungan'],
  [30, 'Didi Rahmadi', 'Kepala Dinas Komunikasi dan Informatika'],
  [31, 'Lamlay Sarie', 'Kepala Dinas Kesehatan'],
  [32, 'David Pamuji', 'Kepala Dinas Kependudukan dan Pencatatan Sipil'],
  [33, 'Eva Yunita', 'Kepala Dinas Koperasi Perindustrian dan Perdagangan'],
  [34, 'Abdul Majid', 'Kepala Dinas Perikanan'],
  [35, 'Tenteram Rahayu', 'Kepala Dinas Pemberdayaan Masyarakat dan Kampung'],
  [36, 'Fendra Firnawan', 'Kepala Dinas Pekerjaan Umum dan Tata Ruang'],
  [37, 'Yudha Budi Santosa', 'Kepala Dinas Kebudayaan dan Pariwisata'],
  [38, 'Mardiatul Idalisah', 'Kepala Dinas Pendidikan'],
  [39, 'Rakhmadi Pasarakan', 'Kepala Dinas Pemadam Kebakaran dan Penyelamatan (Damkar)'],
  [40, 'Yusup Gunawan', 'Sekretaris Inspektorat'],
  [41, 'Purwo Sutopo', 'Sekretaris BKPSDM'],
  [42, 'Samsuddin Amba Kadang', 'Sekretaris Badan Pendapatan Daerah'],
  [43, 'Aidil Fitri', 'Sekretaris Badan Kesatuan Bangsa Dan Politik'],
  [44, 'Renny Irawati Sanwani', 'Sekretaris Dinas Pendidikan'],
  [45, 'Hery Irwan', 'Sekretaris Dinas Pemadam Kebakaran Dan Penyelamatan'],
  [46, 'Dewi Rosita', 'Sekretaris Dinas Pangan'],
  [47, 'Hesbend Nafsiah Nuransyah', 'Sekretaris Dinas Kepemudaan Dan Olahraga'],
  [48, 'Tri Anggoro Rahardjo', 'Sekretaris Dinas Pertanahan'],
  [49, 'Hendra Syaifuddin', 'Sekretaris Dinas Perhubungan'],
  [50, 'Samsiah', 'Sekretaris Dinas Pariwisata'],
  [51, 'Wahyudi', 'Camat Tabalar'],
  [52, 'Ahmad Juhri', 'Camat Tanjung Redeb'],
  [53, 'Noor Alam', 'Camat Sambaliung'],
  [54, 'Toris', 'Camat Segah'],
];

function createInitialSignatories() {
  const list = [
    {
      id: 'bupati',
      rowNumber: 0,
      isLeader: true,
      isCustom: false,
      templateRowIndex: null,
      name: DOCUMENT_META.leaderBlock.name,
      role: DOCUMENT_META.leaderBlock.role,
      category: 'Pimpinan Rapat',
      signed: false,
      signatureMethod: null, // 'draw' | 'upload'
      signedAt: null,
      representedBy: null, // { name, role } | null
      verificationHash: null,
      signatureWidth: null,
      signatureHeight: null,
      signatureVersion: 0,
    },
  ];

  for (const [no, name, role] of RAW_TABLE_SIGNATORIES) {
    list.push({
      id: `row-${no}`,
      rowNumber: no,
      isLeader: false,
      isCustom: false,
      templateRowIndex: no, // 1-based row index inside Word table (row 0 is header)
      name,
      role,
      category: classifyCategory(role, false, false),
      signed: false,
      signatureMethod: null,
      signedAt: null,
      representedBy: null,
      verificationHash: null,
      signatureWidth: null,
      signatureHeight: null,
      signatureVersion: 0,
    });
  }

  return list;
}

module.exports = {
  DOCUMENT_META,
  RAW_TABLE_SIGNATORIES,
  classifyCategory,
  createInitialSignatories,
};
