'use strict';

const { formatWitaDateTime } = require('../utils/formatters');

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function generateRekapCsv(store) {
  const headers = [
    'Bagian',
    'No',
    'Nama',
    'Lembaga / Instansi / Jabatan',
    'Status TTD',
    'Metode TTD',
    'Waktu TTD (WITA)',
  ];

  const rows = [headers.map(csvEscape).join(',')];
  for (const s of store.getAllSignatories()) {
    rows.push(
      [
        s.isRepresentative ? 'Perwakilan Unsur' : 'Lampiran I',
        s.isRepresentative ? `U${s.repOrder}` : s.rowNumber,
        s.name,
        s.role,
        s.signed ? 'Sudah TTD' : 'Belum TTD',
        s.signed ? (s.signatureMethod === 'upload' ? 'Unggah Gambar' : 'TTD Langsung') : '-',
        s.signed ? formatWitaDateTime(s.signedAt) : '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return Buffer.from('\uFEFF' + rows.join('\r\n'), 'utf8');
}

module.exports = { generateRekapCsv };
