'use strict';

const PDFDocument = require('pdfkit');
const { cloneDefaultDocumentMeta } = require('../seed');
const { formatWitaDateTime } = require('../utils/formatters');
const { getPngDimensions } = require('../utils/pngTools');

function fitBox(imgW, imgH, maxW, maxH) {
  const sw = Math.max(1, imgW || 360);
  const sh = Math.max(1, imgH || 140);
  const scale = Math.min(maxW / sw, maxH / sh);
  return { w: sw * scale, h: sh * scale };
}

function generateIndividualPdf(signatory, pngBuffer, documentMeta) {
  return new Promise((resolve, reject) => {
    const meta = documentMeta || cloneDefaultDocumentMeta();
    const dateRow = (meta.eventDetails || []).find((r) => /tanggal/i.test(r.label));
    const placeRow = (meta.eventDetails || []).find((r) => /tempat/i.test(r.label));

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 54, bottom: 54, left: 54, right: 54 },
      info: {
        Title: `Bukti TTD - ${signatory.name}`,
        Author: 'Forum Satu Data Kabupaten Berau 2026',
      },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const pageH = doc.page.height;
    const margin = 54;
    const cw = pageW - margin * 2;

    doc.save().lineWidth(0.75).strokeColor('#D1D5DB').rect(34, 34, pageW - 68, pageH - 68).stroke().restore();

    doc.y = 58;
    doc.font('Helvetica-Bold').fontSize(13.5).fillColor('#111827').text('BUKTI PENANDATANGANAN BERITA ACARA', {
      align: 'center',
    });
    doc.moveDown(0.2);
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor('#374151')
      .text((meta.titleLines || []).slice(1).join(' ') || 'FORUM SATU DATA KABUPATEN BERAU TAHUN 2026', {
        align: 'center',
      });
    if (meta.documentNumber) {
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(9.5).fillColor('#6B7280').text(meta.documentNumber, { align: 'center' });
    }

    doc.moveDown(0.6);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).lineWidth(1).strokeColor('#111827').stroke();
    doc.moveDown(1);

    doc
      .font('Helvetica')
      .fontSize(9.8)
      .fillColor('#1F2937')
      .text(
        `Dokumen ini menerangkan bahwa pihak di bawah ini telah menyepakati dan menandatangani Berita Acara Hasil Kesepakatan Forum Satu Data Kabupaten Berau Tahun 2026 (${dateRow ? dateRow.value : 'Rabu, 25 November 2026'}${placeRow ? ` — ${placeRow.value}` : ''}).`,
        { align: 'justify', lineGap: 2.8 }
      );
    doc.moveDown(1);

    const rows = [
      ['Bagian', signatory.isRepresentative ? 'Perwakilan Unsur Peserta' : `Lampiran I — No. ${signatory.rowNumber}`],
      ['Nama', signatory.name],
      ['Lembaga / Instansi / Jabatan', signatory.role],
      ['Waktu Penandatanganan', signatory.signed ? formatWitaDateTime(signatory.signedAt) : '-'],
      ['Kode Verifikasi (SHA-256)', signatory.verificationHash || '-'],
    ];

    const labelW = 160;
    const valW = cw - labelW;
    let y = doc.y;

    for (const [label, value] of rows) {
      doc.font('Helvetica').fontSize(9.5);
      const h = Math.max(24, doc.heightOfString(value, { width: valW - 16 }) + 12);

      doc.save();
      doc.rect(margin, y, labelW, h).fillAndStroke('#F9FAFB', '#D1D5DB');
      doc.rect(margin + labelW, y, valW, h).fillAndStroke('#FFFFFF', '#D1D5DB');
      doc.restore();

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(label, margin + 8, y + 7, { width: labelW - 16 });
      doc
        .font(label.includes('SHA-256') ? 'Courier-Bold' : 'Helvetica')
        .fontSize(label.includes('SHA-256') ? 9 : 9.4)
        .fillColor('#111827')
        .text(value, margin + labelW + 8, y + 7, { width: valW - 16 });

      y += h;
    }

    doc.y = y + 18;
    doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#111827').text('Kesepakatan yang Disetujui:', margin, doc.y);
    doc.moveDown(0.45);

    (meta.agreements || []).forEach((ag) => {
      const sy = doc.y;
      doc.font('Helvetica-Bold').fontSize(9.2).fillColor('#111827').text(`${ag.label}:`, margin + 4, sy, { width: 52 });
      doc.font('Helvetica').fontSize(9.2).fillColor('#374151').text(ag.value, margin + 56, sy, {
        width: cw - 56,
        align: 'justify',
        lineGap: 2.2,
      });
      doc.moveDown(0.4);
    });

    const sigBoxW = 225;
    const sigBoxX = pageW - margin - sigBoxW;
    doc.y = Math.max(doc.y + 24, 540);

    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text('Pihak yang Menyepakati,', sigBoxX, doc.y, {
      width: sigBoxW,
      align: 'center',
    });

    const boxTop = doc.y + 8;
    if (signatory.signed && pngBuffer) {
      const dims = getPngDimensions(pngBuffer);
      const { w, h } = fitBox(dims.width, dims.height, 175, 68);
      doc.image(pngBuffer, sigBoxX + (sigBoxW - w) / 2, boxTop + (74 - h) / 2, { width: w, height: h });
    } else {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#9CA3AF')
        .text('( Belum ditandatangani )', sigBoxX, boxTop + 28, { width: sigBoxW, align: 'center' });
    }

    doc.y = boxTop + 82;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(signatory.name, sigBoxX, doc.y, {
      width: sigBoxW,
      align: 'center',
      underline: true,
    });
    doc.font('Helvetica').fontSize(8.8).fillColor('#4B5563').text(signatory.role, sigBoxX, doc.y + 2, {
      width: sigBoxW,
      align: 'center',
    });

    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#6B7280')
      .text(
        `e-TTD Berita Acara • Forum Satu Data Kabupaten Berau 2026 • ID: ${signatory.verificationHash || 'UNVERIFIED'}`,
        margin,
        pageH - 52,
        { width: cw, align: 'center', lineBreak: false }
      );
    doc.page.margins.bottom = prevBottom;

    doc.end();
  });
}

module.exports = { generateIndividualPdf };
