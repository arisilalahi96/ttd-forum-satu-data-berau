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
  VerticalAlign,
  PageBreak,
  ShadingType,
} = require('docx');
const { getPngDimensions } = require('../utils/pngTools');

const NO_BORDER = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

const THIN_BORDER = {
  top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
  right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
};

function fitPx(w, h, maxW, maxH) {
  const sw = Math.max(1, w || 320);
  const sh = Math.max(1, h || 120);
  const ratio = Math.min(maxW / sw, maxH / sh);
  return {
    width: Math.max(36, Math.round(sw * ratio)),
    height: Math.max(20, Math.round(sh * ratio)),
  };
}

function makeTextRun(text, opts = {}) {
  return new TextRun({
    text: String(text ?? ''),
    font: 'Calibri',
    size: opts.size || 24, // 12pt
    bold: Boolean(opts.bold),
    italics: Boolean(opts.italics),
    underline: opts.underline ? {} : undefined,
    color: opts.color || '000000',
  });
}

function buildKeyValueTable(rows, labelPct = 24) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: NO_BORDER.top,
      bottom: NO_BORDER.bottom,
      left: NO_BORDER.left,
      right: NO_BORDER.right,
      insideHorizontal: NO_BORDER.top,
      insideVertical: NO_BORDER.left,
    },
    rows: rows.map(
      (r) =>
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: labelPct, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              margins: { top: 40, bottom: 40, left: 60, right: 60 },
              children: [new Paragraph({ children: [makeTextRun(r.label)] })],
            }),
            new TableCell({
              width: { size: 4, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              margins: { top: 40, bottom: 40, left: 20, right: 20 },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [makeTextRun(':')] })],
            }),
            new TableCell({
              width: { size: 100 - labelPct - 4, type: WidthType.PERCENTAGE },
              borders: NO_BORDER,
              margins: { top: 40, bottom: 40, left: 60, right: 60 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.JUSTIFIED,
                  children: [makeTextRun(r.value)],
                }),
              ],
            }),
          ],
        })
    ),
  });
}

function buildRepCellRole(rep) {
  const lines =
    rep && Array.isArray(rep.roleLines) && rep.roleLines.length
      ? rep.roleLines
      : [rep ? rep.role : ''];
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    verticalAlign: VerticalAlign.BOTTOM,
    margins: { top: 80, bottom: 40, left: 80, right: 80 },
    children: lines.map(
      (line) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 20 },
          children: [makeTextRun(line, { size: 22 })],
        })
    ),
  });
}

function buildRepCellSig(rep, store) {
  const buf = rep && rep.signed ? store.getSignatureBuffer(rep.id) : null;
  const children = [];
  if (buf) {
    const dims = getPngDimensions(buf);
    const { width, height } = fitPx(dims.width, dims.height, 165, 64);
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 40 },
        children: [
          new ImageRun({
            type: 'png',
            data: buf,
            transformation: { width, height },
          }),
        ],
      })
    );
  } else {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 340, after: 340 },
        children: [makeTextRun('', { size: 22 })],
      })
    );
  }

  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children,
  });
}

function buildRepCellName(rep) {
  return new TableCell({
    width: { size: 50, type: WidthType.PERCENTAGE },
    borders: NO_BORDER,
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 20, bottom: 140, left: 80, right: 80 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [makeTextRun(rep ? rep.name : '', { size: 22, bold: true, underline: true })],
      }),
    ],
  });
}

/**
 * Generates the official A4 Calibri Berita Acara .docx dynamically from live documentMeta + all signatures.
 */
async function generateBeritaAcaraDocx(store) {
  const meta = store.getDocumentMeta();
  const all = store.getAllSignatories();
  const reps = all.filter((s) => s.isRepresentative).sort((a, b) => (a.repOrder || 0) - (b.repOrder || 0));
  const lampiran = all.filter((s) => !s.isRepresentative).sort((a, b) => a.rowNumber - b.rowNumber);

  const children = [];

  // Title lines
  (meta.titleLines || []).forEach((line, idx) => {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: idx === meta.titleLines.length - 1 ? 60 : 20 },
        children: [makeTextRun(line, { size: 28, bold: true })],
      })
    );
  });

  // Document Number
  if (meta.documentNumber) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 220 },
        children: [makeTextRun(meta.documentNumber, { size: 24 })],
      })
    );
  }

  // Opening paragraph
  if (meta.openingParagraph) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 140, line: 276 },
        children: [makeTextRun(meta.openingParagraph)],
      })
    );
  }

  // Considerations
  if (meta.considerationsHeading) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80, line: 276 },
        children: [makeTextRun(meta.considerationsHeading)],
      })
    );
  }

  (meta.considerations || []).forEach((pt, idx) => {
    children.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        indent: { left: 420, hanging: 260 },
        spacing: { after: 60, line: 276 },
        children: [makeTextRun(`${idx + 1}.  `), makeTextRun(pt)],
      })
    );
  });

  // Event Details Table
  if (meta.eventLead) {
    children.push(
      new Paragraph({
        spacing: { before: 120, after: 80 },
        children: [makeTextRun(meta.eventLead)],
      })
    );
  }
  if (Array.isArray(meta.eventDetails) && meta.eventDetails.length) {
    children.push(buildKeyValueTable(meta.eventDetails, 24));
  }

  // Agreement Lead + MENYEPAKATI + Kesatu/Kedua
  if (meta.agreementLead) {
    children.push(
      new Paragraph({
        spacing: { before: 160, after: 80 },
        children: [makeTextRun(meta.agreementLead)],
      })
    );
  }
  if (meta.agreementHeading) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 100 },
        children: [makeTextRun(meta.agreementHeading, { bold: true })],
      })
    );
  }
  if (Array.isArray(meta.agreements) && meta.agreements.length) {
    children.push(buildKeyValueTable(meta.agreements, 16));
  }

  // Closing paragraph
  if (meta.closingParagraph) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 160, after: 180, line: 276 },
        children: [makeTextRun(meta.closingParagraph)],
      })
    );
  }

  // 4 Representatives 2x2 Grid ("Mewakili unsur peserta...")
  if (meta.representativesHeading) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 100, after: 120 },
        children: [makeTextRun(meta.representativesHeading, { bold: true })],
      })
    );
  }

  const repRows = [];
  for (let i = 0; i < reps.length; i += 2) {
    const leftRep = reps[i] || null;
    const rightRep = reps[i + 1] || null;
    repRows.push(
      new TableRow({ cantSplit: true, children: [buildRepCellRole(leftRep), buildRepCellRole(rightRep)] }),
      new TableRow({ cantSplit: true, children: [buildRepCellSig(leftRep, store), buildRepCellSig(rightRep, store)] }),
      new TableRow({ cantSplit: true, children: [buildRepCellName(leftRep), buildRepCellName(rightRep)] })
    );
  }

  if (repRows.length) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: NO_BORDER.top,
          bottom: NO_BORDER.bottom,
          left: NO_BORDER.left,
          right: NO_BORDER.right,
          insideHorizontal: NO_BORDER.top,
          insideVertical: NO_BORDER.left,
        },
        rows: repRows,
      })
    );
  }

  // ===== PAGE BREAK -> LAMPIRAN I =====
  children.push(
    new Paragraph({
      children: [new PageBreak()],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [makeTextRun(meta.lampiranHeading || 'LAMPIRAN I', { bold: true, size: 24 })],
    }),
    new Paragraph({
      spacing: { after: 160 },
      children: [makeTextRun(meta.lampiranSubheading || '', { size: 22 })],
    })
  );

  // Lampiran I Table
  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: [
      { text: 'NO', pct: 8, align: AlignmentType.CENTER },
      { text: 'NAMA', pct: 32, align: AlignmentType.LEFT },
      { text: 'LEMBAGA/INSTANSI/JABATAN', pct: 37, align: AlignmentType.LEFT },
      { text: 'TANDA TANGAN', pct: 23, align: AlignmentType.CENTER },
    ].map(
      (col) =>
        new TableCell({
          width: { size: col.pct, type: WidthType.PERCENTAGE },
          borders: THIN_BORDER,
          shading: { type: ShadingType.CLEAR, fill: 'F3F4F6', color: 'auto' },
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 80, bottom: 80, left: 90, right: 90 },
          children: [
            new Paragraph({
              alignment: col.align,
              children: [makeTextRun(col.text, { size: 20, bold: true })],
            }),
          ],
        })
    ),
  });

  const dataRows = lampiran.map((s) => {
    const buf = s.signed ? store.getSignatureBuffer(s.id) : null;
    const sigChildren = [];
    if (buf) {
      const dims = getPngDimensions(buf);
      const { width, height } = fitPx(dims.width, dims.height, 130, 44);
      sigChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 20 },
          children: [
            new ImageRun({
              type: 'png',
              data: buf,
              transformation: { width, height },
            }),
          ],
        })
      );
    } else {
      sigChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
          children: [makeTextRun('', { size: 20 })],
        })
      );
    }

    return new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 8, type: WidthType.PERCENTAGE },
          borders: THIN_BORDER,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 60, right: 60 },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [makeTextRun(String(s.rowNumber), { size: 20 })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          borders: THIN_BORDER,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 90, right: 90 },
          children: [new Paragraph({ children: [makeTextRun(s.name, { size: 20 })] })],
        }),
        new TableCell({
          width: { size: 37, type: WidthType.PERCENTAGE },
          borders: THIN_BORDER,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 60, bottom: 60, left: 90, right: 90 },
          children: [new Paragraph({ children: [makeTextRun(s.role, { size: 20 })] })],
        }),
        new TableCell({
          width: { size: 23, type: WidthType.PERCENTAGE },
          borders: THIN_BORDER,
          verticalAlign: VerticalAlign.CENTER,
          margins: { top: 40, bottom: 40, left: 60, right: 60 },
          children: sigChildren,
        }),
      ],
    });
  });

  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    })
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 (matching BERITA ACARA HASIL KESEPAKATAN_Baru.docx)
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateBeritaAcaraDocx };
