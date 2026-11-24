'use strict';

const PDFDocument = require('pdfkit');
const { DOCUMENT_META } = require('../seed');
const { getPngDimensions } = require('../utils/pngTools');
const { formatWitaDateTime } = require('../utils/formatters');

// Indonesian Official F4 / Folio dimensions in points (215mm x 330mm)
const F4_WIDTH = 609.45;
const F4_HEIGHT = 935.43;
const MARGIN = 68; // ~2.4 cm

function fitBox(imgW, imgH, maxW, maxH) {
  const sw = Math.max(1, imgW || 360);
  const sh = Math.max(1, imgH || 140);
  const scale = Math.min(maxW / sw, maxH / sh);
  return { w: sw * scale, h: sh * scale };
}

/**
 * Generates a print-ready F4/Folio PDF of the complete Berita Acara with all live signatures.
 */
function generateBeritaAcaraPdf(store) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [F4_WIDTH, F4_HEIGHT],
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: 'Berita Acara Kesepakatan Forum Satu Data Kabupaten Berau Tahun 2026',
        Author: 'Forum Satu Data Kabupaten Berau',
        Subject: 'Berita Acara Kesepakatan Renaksi SDI 2026',
      },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const contentWidth = F4_WIDTH - MARGIN * 2;
    const allSignatories = store.getAllSignatories();
    const leader = allSignatories.find((s) => s.isLeader);
    const tableSignatories = allSignatories
      .filter((s) => !s.isLeader)
      .sort((a, b) => a.rowNumber - b.rowNumber);

    // ===== PAGE 1: OFFICIAL BERITA ACARA TEXT + BUPATI SIGNATURE =====
    doc.font('Helvetica-Bold').fontSize(13.5).fillColor('#000000');
    DOCUMENT_META.titleLines.forEach((line) => {
      doc.text(line, { align: 'center', lineGap: 2 });
    });

    doc.moveDown(1.4);
    doc.font('Helvetica').fontSize(11).fillColor('#000000');

    DOCUMENT_META.paragraphsBeforePoints.forEach((para) => {
      doc.text(para, { align: 'justify', lineGap: 3.5 });
      doc.moveDown(0.7);
    });

    // Numbered agreement points 1..4
    DOCUMENT_META.agreementPoints.forEach((point, idx) => {
      const startY = doc.y;
      doc.font('Helvetica').fontSize(11).text(`${idx + 1}.`, MARGIN + 10, startY, { width: 18 });
      doc.text(point, MARGIN + 28, startY, {
        width: contentWidth - 28,
        align: 'justify',
        lineGap: 3.2,
      });
      doc.moveDown(0.45);
    });

    doc.x = MARGIN;
    doc.moveDown(0.4);
    doc.text(DOCUMENT_META.closingParagraph, { align: 'justify', lineGap: 3.5 });
    doc.moveDown(1.8);

    // Bupati signature block aligned to right half (matching template left=4962 twips)
    const sigColX = MARGIN + contentWidth * 0.48;
    const sigColW = contentWidth * 0.52;

    doc.font('Helvetica').fontSize(11);
    DOCUMENT_META.leaderBlock.lines.forEach((line) => {
      doc.text(line, sigColX, doc.y, { width: sigColW, align: 'center', lineGap: 2 });
    });

    const leaderBuf = leader && leader.signed ? store.getSignatureBuffer(leader.id) : null;
    if (leaderBuf) {
      const dims = getPngDimensions(leaderBuf);
      const { w, h } = fitBox(dims.width, dims.height, 155, 64);
      const imgX = sigColX + (sigColW - w) / 2;
      const imgY = doc.y + 8;
      doc.image(leaderBuf, imgX, imgY, { width: w, height: h });
      doc.y = imgY + h + 8;
      if (leader.representedBy && leader.representedBy.name) {
        doc
          .font('Helvetica-Oblique')
          .fontSize(8.5)
          .fillColor('#334155')
          .text(
            `a.n. ${leader.representedBy.name}${leader.representedBy.role ? ` (${leader.representedBy.role})` : ''}`,
            sigColX,
            doc.y,
            { width: sigColW, align: 'center' }
          );
        doc.moveDown(0.2);
      }
    } else {
      doc.moveDown(4.2);
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#000000')
      .text(leader ? leader.name : DOCUMENT_META.leaderBlock.name, sigColX, doc.y, {
        width: sigColW,
        align: 'center',
        underline: true,
      });

    // ===== PAGE 2+: PIHAK-PIHAK YANG MENYEPAKATI TABLE =====
    doc.addPage({
      size: [F4_WIDTH, F4_HEIGHT],
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    });

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000000');
    doc.text('PIHAK-PIHAK YANG MENYEPAKATI :', MARGIN, MARGIN);
    doc.moveDown(0.6);

    const colWidths = [32, 148, 162, contentWidth - 32 - 148 - 162]; // No, Nama, Jabatan, Tanda tangan
    const colX = [
      MARGIN,
      MARGIN + colWidths[0],
      MARGIN + colWidths[0] + colWidths[1],
      MARGIN + colWidths[0] + colWidths[1] + colWidths[2],
    ];
    const headerHeight = 26;
    const bottomLimit = F4_HEIGHT - MARGIN - 20;

    function drawTableHeader(y) {
      doc.save();
      doc.rect(MARGIN, y, contentWidth, headerHeight).fillAndStroke('#F1F5F9', '#1E293B');
      for (let i = 1; i < colX.length; i++) {
        doc.moveTo(colX[i], y).lineTo(colX[i], y + headerHeight).stroke('#1E293B');
      }
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9.5);
      const labels = ['No', 'Nama', 'Jabatan/Instansi', 'Tanda tangan'];
      labels.forEach((lbl, idx) => {
        doc.text(lbl, colX[idx] + 5, y + 8, {
          width: colWidths[idx] - 10,
          align: idx === 0 || idx === 3 ? 'center' : 'left',
        });
      });
      doc.restore();
      return y + headerHeight;
    }

    let cursorY = drawTableHeader(doc.y);

    for (const s of tableSignatories) {
      doc.font('Helvetica').fontSize(9.2);
      const nameH = doc.heightOfString(s.name, { width: colWidths[1] - 10 });
      const roleH = doc.heightOfString(s.role, { width: colWidths[2] - 10 });
      const repExtra = s.representedBy && s.representedBy.name ? 13 : 0;
      const sigMinH = s.signed ? 44 + repExtra : 34;
      const rowH = Math.max(36, nameH + 14, roleH + 14, sigMinH);

      if (cursorY + rowH > bottomLimit) {
        doc.addPage({
          size: [F4_WIDTH, F4_HEIGHT],
          margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        });
        cursorY = drawTableHeader(MARGIN);
      }

      // Draw row borders
      doc.save();
      doc.lineWidth(0.6).strokeColor('#334155');
      doc.rect(MARGIN, cursorY, contentWidth, rowH).stroke();
      for (let i = 1; i < colX.length; i++) {
        doc.moveTo(colX[i], cursorY).lineTo(colX[i], cursorY + rowH).stroke();
      }
      doc.restore();

      // Col 1: No
      doc.font('Helvetica').fontSize(9.2).fillColor('#000000');
      doc.text(String(s.rowNumber), colX[0] + 4, cursorY + (rowH - 10) / 2, {
        width: colWidths[0] - 8,
        align: 'center',
      });

      // Col 2: Nama
      doc.text(s.name, colX[1] + 6, cursorY + (rowH - nameH) / 2, {
        width: colWidths[1] - 12,
      });

      // Col 3: Jabatan/Instansi
      doc.text(s.role, colX[2] + 6, cursorY + (rowH - roleH) / 2, {
        width: colWidths[2] - 12,
      });

      // Col 4: Tanda tangan
      const sigBuf = s.signed ? store.getSignatureBuffer(s.id) : null;
      if (sigBuf) {
        const dims = getPngDimensions(sigBuf);
        const maxSigW = colWidths[3] - 16;
        const maxSigH = rowH - (repExtra ? 20 : 10);
        const { w, h } = fitBox(dims.width, dims.height, maxSigW, maxSigH);
        const imgX = colX[3] + (colWidths[3] - w) / 2;
        const imgY = cursorY + (rowH - repExtra - h) / 2;
        try {
          doc.image(sigBuf, imgX, imgY, { width: w, height: h });
        } catch {
          doc.text('(TTD tercatat)', colX[3] + 6, cursorY + rowH / 2 - 5, {
            width: colWidths[3] - 12,
            align: 'center',
          });
        }

        if (s.representedBy && s.representedBy.name) {
          doc
            .font('Helvetica-Oblique')
            .fontSize(7.2)
            .fillColor('#334155')
            .text(`a.n. ${s.representedBy.name}`, colX[3] + 4, cursorY + rowH - 12, {
              width: colWidths[3] - 8,
              align: 'center',
              ellipsis: true,
              lineBreak: false,
            });
        }
      } else {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#64748B')
          .text('……………………………', colX[3] + 6, cursorY + (rowH - 10) / 2, {
            width: colWidths[3] - 12,
            align: 'center',
          });
      }

      cursorY += rowH;
    }

    // Subtle page footers across all pages (temporarily zero bottom margin so PDFKit never auto-adds blank pages)
    const range = doc.bufferedPageRange();
    const generatedLabel = formatWitaDateTime(new Date().toISOString());
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#64748B')
        .text(
          `Berita Acara Kesepakatan Forum Satu Data Kabupaten Berau 2026  •  Dicetak ${generatedLabel}`,
          MARGIN,
          F4_HEIGHT - 36,
          { width: contentWidth - 70, align: 'left', lineBreak: false }
        );
      doc.text(`Hal. ${i + 1} / ${range.count}`, MARGIN + contentWidth - 70, F4_HEIGHT - 36, {
        width: 70,
        align: 'right',
        lineBreak: false,
      });
      doc.page.margins.bottom = prevBottom;
    }

    doc.end();
  });
}

module.exports = { generateBeritaAcaraPdf };
