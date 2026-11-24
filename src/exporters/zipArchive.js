'use strict';

const JSZip = require('jszip');
const { generateIndividualPdf } = require('./pdfIndividual');
const { generateIndividualDocx } = require('./docxIndividual');
const { formatWitaDateTime, sanitizeFilename } = require('../utils/formatters');

function csvEscape(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function generateRekapCsv(store) {
  const headers = [
    'No',
    'Kategori',
    'Nama Pejabat',
    'Jabatan / Instansi',
    'Status TTD',
    'Metode TTD',
    'Mewakili (a.n.)',
    'Jabatan Perwakilan',
    'Waktu TTD (WITA)',
    'Kode Verifikasi',
  ];

  const rows = [headers.map(csvEscape).join(',')];
  for (const s of store.getAllSignatories()) {
    rows.push(
      [
        s.isLeader ? 'Pimpinan' : s.rowNumber,
        s.category,
        s.name,
        s.role,
        s.signed ? 'Sudah TTD' : 'Belum TTD',
        s.signed ? (s.signatureMethod === 'upload' ? 'Unggah Gambar' : 'TTD Langsung') : '-',
        s.representedBy ? s.representedBy.name : '',
        s.representedBy ? s.representedBy.role : '',
        s.signed ? formatWitaDateTime(s.signedAt) : '',
        s.verificationHash || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  // UTF-8 BOM for clean Excel opening in Indonesia
  return Buffer.from('\uFEFF' + rows.join('\r\n'), 'utf8');
}

/**
 * Packages individual signed documents (PDF or DOCX) + PNGs + CSV summary into a single ZIP.
 */
async function generateIndividualBundleZip(store, format = 'pdf') {
  const zip = new JSZip();
  const signedList = store.getAllSignatories().filter((s) => s.signed);

  zip.file('Rekap_Penandatanganan_FSD_Berau_2026.csv', generateRekapCsv(store));

  const folderName = format === 'docx' ? 'Bukti_TTD_Word' : 'Bukti_TTD_PDF';
  const docFolder = zip.folder(folderName);
  const pngFolder = zip.folder('Gambar_TTD_PNG');

  for (const s of signedList) {
    const pngBuf = store.getSignatureBuffer(s.id);
    const prefix = s.isLeader ? '00_Pimpinan' : String(s.rowNumber).padStart(2, '0');
    const safeName = `${prefix}_${sanitizeFilename(s.name)}`;

    if (pngBuf) {
      pngFolder.file(`${safeName}.png`, pngBuf);
    }

    if (format === 'docx') {
      const docxBuf = await generateIndividualDocx(s, pngBuf);
      docFolder.file(`Bukti_TTD_${safeName}.docx`, docxBuf);
    } else {
      const pdfBuf = await generateIndividualPdf(s, pngBuf);
      docFolder.file(`Bukti_TTD_${safeName}.pdf`, pdfBuf);
    }
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

module.exports = {
  generateRekapCsv,
  generateIndividualBundleZip,
};
