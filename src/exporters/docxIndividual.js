'use strict';

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
} = require('docx');
const { cloneDefaultDocumentMeta } = require('../seed');
const { formatWitaDateTime } = require('../utils/formatters');
const { getPngDimensions } = require('../utils/pngTools');

function fitPx(w, h, maxW, maxH) {
  const sw = Math.max(1, w || 360);
  const sh = Math.max(1, h || 140);
  const ratio = Math.min(maxW / sw, maxH / sh);
  return {
    width: Math.max(40, Math.round(sw * ratio)),
    height: Math.max(24, Math.round(sh * ratio)),
  };
}

function metaRow(label, value) {
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' };
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 32, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.CLEAR, fill: 'F8FAFC', color: 'auto' },
        borders: { top: border, bottom: border, left: border, right: border },
        margins: { top: 85, bottom: 85, left: 130, right: 130 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, font: 'Calibri', size: 21, bold: true, color: '111827' })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 68, type: WidthType.PERCENTAGE },
        borders: { top: border, bottom: border, left: border, right: border },
        margins: { top: 85, bottom: 85, left: 130, right: 130 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: value || '-', font: 'Calibri', size: 21, color: '111827' })],
          }),
        ],
      }),
    ],
  });
}

async function generateIndividualDocx(signatory, pngBuffer, documentMeta) {
  const meta = documentMeta || cloneDefaultDocumentMeta();
  const dateRow = (meta.eventDetails || []).find((r) => /tanggal/i.test(r.label));
  const placeRow = (meta.eventDetails || []).find((r) => /tempat/i.test(r.label));

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [new TextRun({ text: 'BUKTI PENANDATANGANAN BERITA ACARA', font: 'Calibri', size: 28, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: (meta.titleLines || []).slice(1).join(' ') || 'FORUM SATU DATA KABUPATEN BERAU TAHUN 2026',
          font: 'Calibri',
          size: 22,
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '111827', space: 8 } },
      children: [new TextRun({ text: meta.documentNumber || '', font: 'Calibri', size: 20, color: '4B5563' })],
    }),
    new Paragraph({
      spacing: { before: 100, after: 160 },
      alignment: AlignmentType.JUSTIFIED,
      children: [
        new TextRun({
          text: `Dokumen ini merupakan bukti penandatanganan Berita Acara Hasil Kesepakatan Forum Satu Data Kabupaten Berau Tahun 2026 (${dateRow ? dateRow.value : 'Rabu, 25 November 2026'}${placeRow ? ` — ${placeRow.value}` : ''}).`,
          font: 'Calibri',
          size: 21,
        }),
      ],
    }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        metaRow('Bagian', signatory.isRepresentative ? 'Perwakilan Unsur Peserta' : `Lampiran I — No. ${signatory.rowNumber}`),
        metaRow('Nama', signatory.name),
        metaRow('Lembaga / Instansi / Jabatan', signatory.role),
        metaRow('Waktu Penandatanganan', signatory.signed ? formatWitaDateTime(signatory.signedAt) : '-'),
        metaRow('Kode Verifikasi (SHA-256)', signatory.verificationHash || '-'),
      ],
    }),
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: 'Kesepakatan yang Disetujui:', font: 'Calibri', size: 21, bold: true })],
    }),
  ];

  (meta.agreements || []).forEach((ag) => {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        indent: { left: 260, hanging: 180 },
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({ text: `${ag.label}: `, font: 'Calibri', size: 20, bold: true }),
          new TextRun({ text: ag.value, font: 'Calibri', size: 20 }),
        ],
      })
    );
  });

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: 4600 },
      spacing: { before: 280, after: 80 },
      children: [new TextRun({ text: 'Pihak yang Menyepakati,', font: 'Calibri', size: 21, bold: true })],
    })
  );

  if (signatory.signed && pngBuffer) {
    const dims = getPngDimensions(pngBuffer);
    const { width, height } = fitPx(dims.width, dims.height, 200, 78);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { left: 4600 },
        spacing: { before: 40, after: 40 },
        children: [new ImageRun({ type: 'png', data: pngBuffer, transformation: { width, height } })],
      })
    );
  } else {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { left: 4600 },
        spacing: { before: 300, after: 300 },
        children: [new TextRun({ text: '( Belum ditandatangani )', font: 'Calibri', size: 19, italics: true, color: '6B7280' })],
      })
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: 4600 },
      spacing: { after: 20 },
      children: [new TextRun({ text: signatory.name, font: 'Calibri', size: 21, bold: true, underline: {} })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: 4600 },
      children: [new TextRun({ text: signatory.role, font: 'Calibri', size: 19, color: '4B5563' })],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateIndividualDocx };
