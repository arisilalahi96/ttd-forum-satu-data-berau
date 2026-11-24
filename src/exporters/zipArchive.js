'use strict';

const JSZip = require('jszip');
const { generateIndividualPdf } = require('./pdfIndividual');
const { generateIndividualDocx } = require('./docxIndividual');
const { formatWitaDateTime, sanitizeFilename } = require('../utils/formatters');

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
    'Kode Verifikasi',
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
        s.verificationHash || '',
      ]
        .map(csvEscape)
        .join(',')
    );
  }
  return Buffer.from('\uFEFF' + rows.join('\r\n'), 'utf8');
}

async function generateIndividualBundleZip(store, format = 'pdf') {
  const zip = new JSZip();
  const meta = store.getDocumentMeta();
  const signedList = store.getAllSignatories().filter((s) => s.signed);

  zip.file('Rekap_Penandatanganan_FSD_Berau_2026.csv', generateRekapCsv(store));

  const folderName = format === 'docx' ? 'Bukti_TTD_Word' : 'Bukti_TTD_PDF';
  const docFolder = zip.folder(folderName);
  const pngFolder = zip.folder('Gambar_TTD_PNG');

  for (const s of signedList) {
    const pngBuf = store.getSignatureBuffer(s.id);
    const prefix = s.isRepresentative
      ? `00_Unsur${s.repOrder}`
      : String(s.rowNumber).padStart(2, '0');
    const safeName = `${prefix}_${sanitizeFilename(s.name)}`;

    if (pngBuf) pngFolder.file(`${safeName}.png`, pngBuf);

    if (format === 'docx') {
      const docxBuf = await generateIndividualDocx(s, pngBuf, meta);
      docFolder.file(`Bukti_TTD_${safeName}.docx`, docxBuf);
    } else {
      const pdfBuf = await generateIndividualPdf(s, pngBuf, meta);
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
