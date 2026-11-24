'use strict';

const PDFDocument = require('pdfkit');
const { DOCUMENT_META } = require('../seed');
const { formatWitaDateTime } = require('../utils/formatters');
const { getPngDimensions } = require('../utils/pngTools');

function fitBox(imgW, imgH, maxW, maxH) {
  const sw = Math.max(1, imgW || 360);
  const sh = Math.max(1, imgH || 140);
  const scale = Math.min(maxW / sw, maxH / sh);
  return { w: sw * scale, h: sh * scale };
}

/**
 * Generates an official A4 1-page individual signature proof PDF for a specific participant.
 */
function generateIndividualPdf(signatory, pngBuffer) {
  return new Promise((resolve, reject) => {
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

    // Top ceremonial accent bar (Navy + Gold)
    doc.rect(0, 0, pageW, 8).fill('#0F2342');
    doc.rect(0, 8, pageW, 2.5).fill('#9E7628');

    // Subtle archival border
    doc.save().lineWidth(0.75).strokeColor('#CBD5E1').rect(34, 34, pageW - 68, pageH - 68).stroke().restore();

    doc.y = 56;
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0F2342').text('PEMERINTAH KABUPATEN BERAU', {
      align: 'center',
    });
    doc.moveDown(0.2);
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor('#0F2342')
      .text('BUKTI PENANDATANGANAN BERITA ACARA', { align: 'center' });
    doc.moveDown(0.2);
    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor('#9E7628')
      .text('FORUM SATU DATA KABUPATEN BERAU TAHUN 2026', { align: 'center' });

    doc.moveDown(0.6);
    doc.moveTo(margin, doc.y).lineTo(pageW - margin, doc.y).lineWidth(1.5).strokeColor('#0F2342').stroke();
    doc.moveTo(margin, doc.y + 3).lineTo(pageW - margin, doc.y + 3).lineWidth(0.5).strokeColor('#9E7628').stroke();
    doc.moveDown(1);

    doc
      .font('Helvetica')
      .fontSize(9.8)
      .fillColor('#1E293B')
      .text(
        `Dokumen ini menerangkan bahwa pihak di bawah ini telah membaca, menyetujui, dan membubuhkan tanda tangan ` +
          `pada Berita Acara Kesepakatan Forum Satu Data Kabupaten Berau Tahun 2026 yang diselenggarakan pada ` +
          `${DOCUMENT_META.eventDateLabel} bertempat di ${DOCUMENT_META.venue}.`,
        { align: 'justify', lineGap: 3 }
      );
    doc.moveDown(1);

    const attendance =
      signatory.representedBy && signatory.representedBy.name
        ? `Diwakili — a.n. ${signatory.representedBy.name}${signatory.representedBy.role ? ` (${signatory.representedBy.role})` : ''}`
        : 'Hadir Langsung';

    const method = signatory.signed
      ? signatory.signatureMethod === 'upload'
        ? 'Unggah Gambar Tanda Tangan'
        : 'Tanda Tangan Langsung (Digital Pad)'
      : 'Belum Ditandatangani';

    const rows = [
      ['Nomor Urut', signatory.isLeader ? 'Pimpinan Rapat (Bupati)' : `No. ${signatory.rowNumber}`],
      ['Nama Pejabat / Pihak', signatory.name],
      ['Jabatan / Instansi', signatory.role],
      ['Status Kehadiran', signatory.signed ? attendance : 'Belum Tercatat'],
      ['Waktu Penandatanganan', signatory.signed ? formatWitaDateTime(signatory.signedAt) : '-'],
      ['Metode Penandatanganan', method],
      ['Kode Verifikasi (SHA-256)', signatory.verificationHash || '-'],
    ];

    const labelW = 158;
    const valW = cw - labelW;
    let y = doc.y;

    for (const [label, value] of rows) {
      doc.font('Helvetica').fontSize(9.5);
      const h = Math.max(24, doc.heightOfString(value, { width: valW - 16 }) + 12);

      doc.save();
      doc.rect(margin, y, labelW, h).fillAndStroke('#F8FAFC', '#CBD5E1');
      doc.rect(margin + labelW, y, valW, h).fillAndStroke('#FFFFFF', '#CBD5E1');
      doc.restore();

      doc.font('Helvetica-Bold').fontSize(9.2).fillColor('#1E293B').text(label, margin + 8, y + 7, {
        width: labelW - 16,
      });
      doc
        .font(label.includes('SHA-256') ? 'Courier-Bold' : 'Helvetica')
        .fontSize(label.includes('SHA-256') ? 9 : 9.4)
        .fillColor('#0F172A')
        .text(value, margin + labelW + 8, y + 7, { width: valW - 16 });

      y += h;
    }

    doc.y = y + 16;
    doc
      .font('Helvetica-Bold')
      .fontSize(9.8)
      .fillColor('#0F2342')
      .text('Poin Kesepakatan yang Disetujui:', margin, doc.y);
    doc.moveDown(0.45);

    DOCUMENT_META.agreementPoints.forEach((pt, idx) => {
      const sy = doc.y;
      doc.font('Helvetica-Bold').fontSize(9.2).fillColor('#0F2342').text(`${idx + 1}.`, margin + 6, sy, { width: 16 });
      doc
        .font('Helvetica')
        .fontSize(9.2)
        .fillColor('#334155')
        .text(pt, margin + 22, sy, { width: cw - 22, align: 'justify', lineGap: 2.2 });
      doc.moveDown(0.35);
    });

    // Signature box right-aligned
    const sigBoxW = 225;
    const sigBoxX = pageW - margin - sigBoxW;
    doc.y = Math.max(doc.y + 18, 560);

    doc
      .font('Helvetica')
      .fontSize(9.5)
      .fillColor('#1E293B')
      .text('Tanjung Redeb, 25 November 2026', sigBoxX, doc.y, { width: sigBoxW, align: 'center' });
    doc
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#0F2342')
      .text(signatory.isLeader ? 'Pimpinan Rapat Forum Data,' : 'Pihak yang Menyepakati,', sigBoxX, doc.y + 2, {
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
        .fillColor('#94A3B8')
        .text('( Belum ditandatangani )', sigBoxX, boxTop + 28, { width: sigBoxW, align: 'center' });
    }

    doc.y = boxTop + 82;
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#0F172A')
      .text(signatory.name, sigBoxX, doc.y, { width: sigBoxW, align: 'center', underline: true });
    doc
      .font('Helvetica')
      .fontSize(8.8)
      .fillColor('#475569')
      .text(signatory.role, sigBoxX, doc.y + 2, { width: sigBoxW, align: 'center' });

    if (signatory.representedBy && signatory.representedBy.name) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(8.3)
        .fillColor('#475569')
        .text(
          `a.n. ${signatory.representedBy.name}${signatory.representedBy.role ? ` (${signatory.representedBy.role})` : ''}`,
          sigBoxX,
          doc.y + 3,
          { width: sigBoxW, align: 'center' }
        );
    }

    // Verification footer (keep within safe printable area without auto-adding a 2nd page)
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#64748B')
      .text(
        `Arsip Digital Resmi • Sistem Penandatanganan Forum Satu Data Kabupaten Berau 2026 • ID: ${signatory.verificationHash || 'UNVERIFIED'}`,
        margin,
        pageH - 52,
        { width: cw, align: 'center', lineBreak: false }
      );
    doc.page.margins.bottom = prevBottom;

    doc.end();
  });
}

module.exports = { generateIndividualPdf };
