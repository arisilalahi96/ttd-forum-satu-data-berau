'use strict';

const PDFDocument = require('pdfkit');
const { getPngDimensions } = require('../utils/pngTools');

// A4 dimensions matching BERITA ACARA HASIL KESEPAKATAN_Baru.docx (210mm x 297mm)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 62;

function fitBox(imgW, imgH, maxW, maxH) {
  const sw = Math.max(1, imgW || 320);
  const sh = Math.max(1, imgH || 120);
  const scale = Math.min(maxW / sw, maxH / sh);
  return { w: sw * scale, h: sh * scale };
}

function generateBeritaAcaraPdf(store) {
  return new Promise((resolve, reject) => {
    const meta = store.getDocumentMeta();
    const all = store.getAllSignatories();
    const reps = all.filter((s) => s.isRepresentative).sort((a, b) => (a.repOrder || 0) - (b.repOrder || 0));
    const lampiran = all.filter((s) => !s.isRepresentative).sort((a, b) => a.rowNumber - b.rowNumber);

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      info: {
        Title: (meta.titleLines || []).join(' '),
        Author: 'Forum Satu Data Kabupaten Berau',
      },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const cw = A4_WIDTH - MARGIN * 2;
    const bottomLimit = A4_HEIGHT - MARGIN - 16;

    function ensureSpace(needed) {
      if (doc.y + needed > bottomLimit) {
        doc.addPage({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
      }
    }

    // ===== TITLE & NUMBER =====
    doc.font('Helvetica-Bold').fontSize(12.5).fillColor('#000000');
    (meta.titleLines || []).forEach((line) => {
      doc.text(line, MARGIN, doc.y, { width: cw, align: 'center', lineGap: 2 });
    });
    if (meta.documentNumber) {
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(10.5).text(meta.documentNumber, MARGIN, doc.y, {
        width: cw,
        align: 'center',
      });
    }

    doc.moveDown(1);
    doc.font('Helvetica').fontSize(10.2).fillColor('#000000');

    // Opening
    if (meta.openingParagraph) {
      doc.text(meta.openingParagraph, MARGIN, doc.y, { width: cw, align: 'justify', lineGap: 2.8 });
      doc.moveDown(0.55);
    }

    // Considerations
    if (meta.considerationsHeading) {
      doc.text(meta.considerationsHeading, MARGIN, doc.y, { width: cw, align: 'justify', lineGap: 2.5 });
      doc.moveDown(0.3);
    }
    (meta.considerations || []).forEach((pt, idx) => {
      const h = doc.heightOfString(pt, { width: cw - 24, lineGap: 2.3 });
      ensureSpace(h + 8);
      const y = doc.y;
      doc.text(`${idx + 1}.`, MARGIN + 6, y, { width: 18 });
      doc.text(pt, MARGIN + 24, y, { width: cw - 24, align: 'justify', lineGap: 2.3 });
      doc.moveDown(0.32);
    });

    // Event details
    if (meta.eventLead) {
      ensureSpace(24);
      doc.moveDown(0.25);
      doc.text(meta.eventLead, MARGIN, doc.y, { width: cw });
      doc.moveDown(0.25);
    }
    (meta.eventDetails || []).forEach((row) => {
      const labelW = 105;
      const valW = cw - labelW - 14;
      const h = Math.max(14, doc.heightOfString(row.value || '', { width: valW, lineGap: 2 }));
      ensureSpace(h + 6);
      const y = doc.y;
      doc.text(row.label || '', MARGIN + 8, y, { width: labelW - 8 });
      doc.text(':', MARGIN + labelW, y, { width: 12, align: 'center' });
      doc.text(row.value || '', MARGIN + labelW + 14, y, { width: valW, align: 'justify', lineGap: 2 });
      doc.y = y + h + 4;
    });

    // MENYEPAKATI
    if (meta.agreementLead) {
      ensureSpace(40);
      doc.moveDown(0.5);
      doc.text(meta.agreementLead, MARGIN, doc.y, { width: cw });
    }
    if (meta.agreementHeading) {
      doc.moveDown(0.35);
      doc.font('Helvetica-Bold').fontSize(10.5).text(meta.agreementHeading, MARGIN, doc.y, {
        width: cw,
        align: 'center',
      });
      doc.moveDown(0.4);
    }
    doc.font('Helvetica').fontSize(10.2);
    (meta.agreements || []).forEach((row) => {
      const labelW = 68;
      const valW = cw - labelW - 14;
      const h = Math.max(14, doc.heightOfString(row.value || '', { width: valW, lineGap: 2.2 }));
      ensureSpace(h + 8);
      const y = doc.y;
      doc.text(row.label || '', MARGIN + 6, y, { width: labelW - 6 });
      doc.text(':', MARGIN + labelW, y, { width: 12, align: 'center' });
      doc.text(row.value || '', MARGIN + labelW + 14, y, { width: valW, align: 'justify', lineGap: 2.2 });
      doc.y = y + h + 5;
    });

    // Closing
    if (meta.closingParagraph) {
      ensureSpace(40);
      doc.moveDown(0.5);
      doc.text(meta.closingParagraph, MARGIN, doc.y, { width: cw, align: 'justify', lineGap: 2.6 });
    }

    // 4 Representatives 2x2 Signature Grid
    ensureSpace(175);
    doc.moveDown(0.9);
    if (meta.representativesHeading) {
      doc.font('Helvetica-Bold').fontSize(10.2).text(meta.representativesHeading, MARGIN, doc.y, {
        width: cw,
        align: 'center',
      });
      doc.moveDown(0.7);
    }

    const halfW = cw / 2;
    for (let i = 0; i < reps.length; i += 2) {
      ensureSpace(130);
      const pair = [reps[i], reps[i + 1]];
      const startY = doc.y;

      // Measure role heights
      doc.font('Helvetica').fontSize(9.5);
      let maxRoleH = 14;
      pair.forEach((rep) => {
        if (!rep) return;
        const lines = Array.isArray(rep.roleLines) && rep.roleLines.length ? rep.roleLines : [rep.role];
        const h = doc.heightOfString(lines.join('\n'), { width: halfW - 18, align: 'center', lineGap: 1.5 });
        if (h > maxRoleH) maxRoleH = h;
      });

      const sigTop = startY + maxRoleH + 6;
      const sigAreaH = 54;
      const nameY = sigTop + sigAreaH + 6;

      pair.forEach((rep, idx) => {
        if (!rep) return;
        const colX = MARGIN + idx * halfW;
        const lines = Array.isArray(rep.roleLines) && rep.roleLines.length ? rep.roleLines : [rep.role];
        doc.font('Helvetica').fontSize(9.5).fillColor('#000000').text(lines.join('\n'), colX + 9, startY, {
          width: halfW - 18,
          align: 'center',
          lineGap: 1.5,
        });

        const buf = rep.signed ? store.getSignatureBuffer(rep.id) : null;
        if (buf) {
          const dims = getPngDimensions(buf);
          const { w, h } = fitBox(dims.width, dims.height, 138, sigAreaH - 6);
          doc.image(buf, colX + (halfW - w) / 2, sigTop + (sigAreaH - h) / 2, { width: w, height: h });
        }

        doc.font('Helvetica-Bold').fontSize(9.8).fillColor('#000000').text(rep.name, colX + 6, nameY, {
          width: halfW - 12,
          align: 'center',
          underline: true,
        });
      });

      doc.y = nameY + 26;
    }

    // ===== LAMPIRAN I TABLE (NEW PAGE) =====
    doc.addPage({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(meta.lampiranHeading || 'LAMPIRAN I', MARGIN, MARGIN);
    if (meta.lampiranSubheading) {
      doc.moveDown(0.25);
      doc.font('Helvetica').fontSize(10).text(meta.lampiranSubheading, MARGIN, doc.y, { width: cw });
    }
    doc.moveDown(0.6);

    const colWidths = [30, 146, 175, cw - 30 - 146 - 175];
    const colX = [
      MARGIN,
      MARGIN + colWidths[0],
      MARGIN + colWidths[0] + colWidths[1],
      MARGIN + colWidths[0] + colWidths[1] + colWidths[2],
    ];
    const headerH = 24;

    function drawTableHeader(y) {
      doc.save();
      doc.rect(MARGIN, y, cw, headerH).fillAndStroke('#F3F4F6', '#111827');
      for (let i = 1; i < colX.length; i++) {
        doc.moveTo(colX[i], y).lineTo(colX[i], y + headerH).stroke('#111827');
      }
      doc.fillColor('#000000').font('Helvetica-Bold').fontSize(8.8);
      ['NO', 'NAMA', 'LEMBAGA/INSTANSI/JABATAN', 'TANDA TANGAN'].forEach((lbl, idx) => {
        doc.text(lbl, colX[idx] + 4, y + 7, {
          width: colWidths[idx] - 8,
          align: idx === 0 || idx === 3 ? 'center' : 'left',
        });
      });
      doc.restore();
      return y + headerH;
    }

    let cursorY = drawTableHeader(doc.y);

    for (const s of lampiran) {
      doc.font('Helvetica').fontSize(8.8);
      const nameH = doc.heightOfString(s.name, { width: colWidths[1] - 10 });
      const roleH = doc.heightOfString(s.role, { width: colWidths[2] - 10 });
      const rowH = Math.max(s.signed ? 42 : 32, nameH + 12, roleH + 12);

      if (cursorY + rowH > bottomLimit) {
        doc.addPage({ size: 'A4', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
        cursorY = drawTableHeader(MARGIN);
      }

      doc.save();
      doc.lineWidth(0.55).strokeColor('#1F2937');
      doc.rect(MARGIN, cursorY, cw, rowH).stroke();
      for (let i = 1; i < colX.length; i++) {
        doc.moveTo(colX[i], cursorY).lineTo(colX[i], cursorY + rowH).stroke();
      }
      doc.restore();

      doc.font('Helvetica').fontSize(8.8).fillColor('#000000');
      doc.text(String(s.rowNumber), colX[0] + 3, cursorY + (rowH - 9) / 2, {
        width: colWidths[0] - 6,
        align: 'center',
      });
      doc.text(s.name, colX[1] + 5, cursorY + (rowH - nameH) / 2, { width: colWidths[1] - 10 });
      doc.text(s.role, colX[2] + 5, cursorY + (rowH - roleH) / 2, { width: colWidths[2] - 10 });

      const sigBuf = s.signed ? store.getSignatureBuffer(s.id) : null;
      if (sigBuf) {
        const dims = getPngDimensions(sigBuf);
        const { w, h } = fitBox(dims.width, dims.height, colWidths[3] - 14, rowH - 8);
        try {
          doc.image(sigBuf, colX[3] + (colWidths[3] - w) / 2, cursorY + (rowH - h) / 2, { width: w, height: h });
        } catch {
          // ignore
        }
      }

      cursorY += rowH;
    }

    doc.end();
  });
}

module.exports = { generateBeritaAcaraPdf };
