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
const { DOCUMENT_META } = require('../seed');
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
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, font: 'Arial', size: 20, bold: true, color: '1E293B' })],
          }),
        ],
      }),
      new TableCell({
        width: { size: 68, type: WidthType.PERCENTAGE },
        borders: { top: border, bottom: border, left: border, right: border },
        margins: { top: 90, bottom: 90, left: 140, right: 140 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: value || '-', font: 'Arial', size: 20, color: '0F172A' })],
          }),
        ],
      }),
    ],
  });
}

/**
 * Generates an official 1-page individual signature confirmation .docx for a specific participant.
 */
async function generateIndividualDocx(signatory, pngBuffer) {
  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: 'PEMERINTAH KABUPATEN BERAU',
          font: 'Arial',
          size: 24,
          bold: true,
          color: '0F2342',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'BUKTI PENANDATANGANAN BERITA ACARA',
          font: 'Arial',
          size: 28,
          bold: true,
          color: '0F2342',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 220 },
      border: {
        bottom: { style: BorderStyle.DOUBLE, size: 12, color: '0F2342', space: 8 },
      },
      children: [
        new TextRun({
          text: 'FORUM SATU DATA KABUPATEN BERAU TAHUN 2026',
          font: 'Arial',
          size: 22,
          bold: true,
          color: '9E7628',
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 120, after: 180 },
      alignment: AlignmentType.JUSTIFIED,
      children: [
        new TextRun({
          text:
            `Dokumen ini merupakan bukti sah persetujuan dan penandatanganan Berita Acara Kesepakatan Forum Satu Data ` +
            `Kabupaten Berau Tahun 2026 yang dilaksanakan pada ${DOCUMENT_META.eventDateLabel} di ${DOCUMENT_META.venue}.`,
          font: 'Arial',
          size: 20,
          color: '1E293B',
        }),
      ],
    }),
  ];

  const attendanceStatus = signatory.representedBy && signatory.representedBy.name
    ? `Diwakili (a.n. ${signatory.representedBy.name}${signatory.representedBy.role ? ` — ${signatory.representedBy.role}` : ''})`
    : 'Hadir Langsung';

  const methodLabel = signatory.signed
    ? signatory.signatureMethod === 'upload'
      ? 'Unggah Gambar Tanda Tangan'
      : 'Tanda Tangan Langsung (Digital Pad)'
    : 'Belum Ditandatangani';

  const tableRows = [
    metaRow('Nomor Urut', signatory.isLeader ? 'Pimpinan Rapat (Bupati)' : `No. ${signatory.rowNumber}`),
    metaRow('Nama Pejabat / Pihak', signatory.name),
    metaRow('Jabatan / Instansi', signatory.role),
    metaRow('Status Kehadiran', signatory.signed ? attendanceStatus : 'Belum Tercatat'),
    metaRow('Waktu Penandatanganan', signatory.signed ? formatWitaDateTime(signatory.signedAt) : '-'),
    metaRow('Metode Penandatanganan', methodLabel),
    metaRow('Kode Verifikasi (SHA-256)', signatory.verificationHash || '-'),
  ];

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: tableRows,
    })
  );

  children.push(
    new Paragraph({
      spacing: { before: 220, after: 80 },
      children: [
        new TextRun({
          text: 'Ringkasan Kesepakatan yang Disetujui:',
          font: 'Arial',
          size: 20,
          bold: true,
          color: '0F2342',
        }),
      ],
    })
  );

  DOCUMENT_META.agreementPoints.forEach((pt, idx) => {
    children.push(
      new Paragraph({
        spacing: { after: 60 },
        indent: { left: 320, hanging: 220 },
        alignment: AlignmentType.JUSTIFIED,
        children: [
          new TextRun({ text: `${idx + 1}. `, font: 'Arial', size: 19, bold: true, color: '0F2342' }),
          new TextRun({ text: pt, font: 'Arial', size: 19, color: '334155' }),
        ],
      })
    );
  });

  // Signature block on right side
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: 4600 },
      spacing: { before: 260, after: 40 },
      children: [
        new TextRun({
          text: 'Tanjung Redeb, 25 November 2026',
          font: 'Arial',
          size: 20,
          color: '1E293B',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: 4600 },
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: signatory.isLeader ? 'Pimpinan Rapat Forum Data,' : 'Pihak yang Menyepakati,',
          font: 'Arial',
          size: 20,
          bold: true,
          color: '0F2342',
        }),
      ],
    })
  );

  if (signatory.signed && pngBuffer) {
    const dims = getPngDimensions(pngBuffer);
    const { width, height } = fitPx(dims.width, dims.height, 210, 82);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { left: 4600 },
        spacing: { before: 40, after: 40 },
        children: [
          new ImageRun({
            type: 'png',
            data: pngBuffer,
            transformation: { width, height },
          }),
        ],
      })
    );
  } else {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { left: 4600 },
        spacing: { before: 320, after: 320 },
        children: [
          new TextRun({
            text: '( Belum ditandatangani )',
            font: 'Arial',
            size: 18,
            italics: true,
            color: '94A3B8',
          }),
        ],
      })
    );
  }

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: 4600 },
      spacing: { after: 20 },
      children: [
        new TextRun({
          text: signatory.name,
          font: 'Arial',
          size: 20,
          bold: true,
          underline: {},
          color: '0F172A',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      indent: { left: 4600 },
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: signatory.role,
          font: 'Arial',
          size: 18,
          color: '475569',
        }),
      ],
    })
  );

  if (signatory.representedBy && signatory.representedBy.name) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { left: 4600 },
        children: [
          new TextRun({
            text: `Ditandatangani a.n. ${signatory.representedBy.name}${signatory.representedBy.role ? ` (${signatory.representedBy.role})` : ''}`,
            font: 'Arial',
            size: 17,
            italics: true,
            color: '475569',
          }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 width in twips (210mm)
              height: 16838, // A4 height in twips (297mm)
            },
            margin: {
              top: 1134,
              right: 1134,
              bottom: 1134,
              left: 1134,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateIndividualDocx };
