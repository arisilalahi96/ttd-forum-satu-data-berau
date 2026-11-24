'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { escapeXml } = require('../utils/formatters');
const { getPngDimensions } = require('../utils/pngTools');

const TEMPLATE_PATH = path.join(__dirname, '..', '..', 'templates', 'berita-acara-template.docx');

/**
 * Compute proportional EMU dimensions fitting inside maxW x maxH.
 * 1 cm = 360000 EMU, 1 inch = 914400 EMU.
 */
function fitEmu(imgW, imgH, maxW, maxH) {
  const safeW = Math.max(1, imgW || 400);
  const safeH = Math.max(1, imgH || 160);
  const ratio = Math.min(maxW / safeW, maxH / safeH);
  return {
    cx: Math.max(91440, Math.round(safeW * ratio)),
    cy: Math.max(45720, Math.round(safeH * ratio)),
  };
}

function buildDrawingRunXml({ rId, docPrId, name, cx, cy }) {
  const safeName = escapeXml(name);
  return (
    `<w:r>` +
    `<w:rPr><w:noProof/></w:rPr>` +
    `<w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${docPrId}" name="${safeName}"/>` +
    `<wp:cNvGraphicFramePr>` +
    `<a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>` +
    `</wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr>` +
    `<pic:cNvPr id="${docPrId}" name="${safeName}.png"/>` +
    `<pic:cNvPicPr/>` +
    `</pic:nvPicPr>` +
    `<pic:blipFill>` +
    `<a:blip r:embed="${rId}"/>` +
    `<a:stretch><a:fillRect/></a:stretch>` +
    `</pic:blipFill>` +
    `<pic:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `</pic:spPr>` +
    `</pic:pic>` +
    `</a:graphicData>` +
    `</a:graphic>` +
    `</wp:inline>` +
    `</w:drawing>` +
    `</w:r>`
  );
}

function buildTextCellContentXml(text, opts = {}) {
  const { align = null, bold = false, sizeHalfPt = 20, italic = false, color = null } = opts;
  const jc = align ? `<w:jc w:val="${align}"/>` : '';
  const b = bold ? '<w:b/><w:bCs/>' : '';
  const i = italic ? '<w:i/><w:iCs/>' : '';
  const c = color ? `<w:color w:val="${color}"/>` : '';
  const sz = `<w:sz w:val="${sizeHalfPt}"/><w:szCs w:val="${sizeHalfPt}"/>`;
  return (
    `<w:p>` +
    `<w:pPr><w:widowControl/><w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>${jc}` +
    `<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Times New Roman" w:hAnsi="Arial" w:cs="Arial"/>${b}${i}${c}${sz}</w:rPr></w:pPr>` +
    `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Times New Roman" w:hAnsi="Arial" w:cs="Arial"/>${b}${i}${c}${sz}</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>` +
    `</w:p>`
  );
}

function buildSignatureCellInnerXml(signatory, imageRef) {
  if (!imageRef) {
    return buildTextCellContentXml('……………………………...', { align: 'center', sizeHalfPt: 20 });
  }
  const drawingRun = buildDrawingRunXml({
    rId: imageRef.rId,
    docPrId: imageRef.docPrId,
    name: `TTD_${signatory.rowNumber || 'Bupati'}`,
    cx: imageRef.cx,
    cy: imageRef.cy,
  });

  let xml =
    `<w:p>` +
    `<w:pPr><w:widowControl/><w:spacing w:before="30" w:after="20" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>` +
    drawingRun +
    `</w:p>`;

  if (signatory.representedBy && signatory.representedBy.name) {
    const repText = signatory.representedBy.role
      ? `a.n. ${signatory.representedBy.name} (${signatory.representedBy.role})`
      : `a.n. ${signatory.representedBy.name}`;
    xml += buildTextCellContentXml(repText, {
      align: 'center',
      italic: true,
      sizeHalfPt: 15,
      color: '334155',
    });
  }
  return xml;
}

function buildCustomRowXml(signatory, imageRef) {
  const noCell =
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:vAlign w:val="center"/></w:tcPr>` +
    buildTextCellContentXml(String(signatory.rowNumber), { align: 'left', sizeHalfPt: 20 }) +
    `</w:tc>`;
  const nameCell =
    `<w:tc><w:tcPr><w:tcW w:w="3672" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
    buildTextCellContentXml(signatory.name, { align: 'left', sizeHalfPt: 20 }) +
    `</w:tc>`;
  const roleCell =
    `<w:tc><w:tcPr><w:tcW w:w="3517" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
    buildTextCellContentXml(signatory.role, { align: 'left', sizeHalfPt: 20 }) +
    `</w:tc>`;
  const sigCell =
    `<w:tc><w:tcPr><w:tcW w:w="2634" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
    buildSignatureCellInnerXml(signatory, imageRef) +
    `</w:tc>`;

  return (
    `<w:tr>` +
    `<w:trPr><w:cantSplit/><w:trHeight w:val="651" w:hRule="atLeast"/><w:tblCellSpacing w:w="15" w:type="dxa"/></w:trPr>` +
    noCell +
    nameCell +
    roleCell +
    sigCell +
    `</w:tr>`
  );
}

/**
 * Split top-level occurrences of a non-nested XML element like <w:tr ...>...</w:tr> or <w:tc>...</w:tc>.
 */
function findTagRanges(xml, tagName) {
  const ranges = [];
  const openToken = `<${tagName}`;
  const closeToken = `</${tagName}>`;
  let cursor = 0;

  while (cursor < xml.length) {
    const start = xml.indexOf(openToken, cursor);
    if (start === -1) break;
    const afterOpen = xml[start + openToken.length];
    if (afterOpen !== '>' && afterOpen !== ' ' && afterOpen !== '/') {
      cursor = start + openToken.length;
      continue;
    }
    const end = xml.indexOf(closeToken, start);
    if (end === -1) break;
    ranges.push({ start, end: end + closeToken.length });
    cursor = end + closeToken.length;
  }
  return ranges;
}

function replaceCellInnerContent(tcXml, newInnerXml) {
  const tcPrEnd = tcXml.indexOf('</w:tcPr>');
  const closeIdx = tcXml.lastIndexOf('</w:tc>');
  if (tcPrEnd === -1 || closeIdx === -1) return tcXml;
  const header = tcXml.slice(0, tcPrEnd + '</w:tcPr>'.length);
  return `${header}${newInnerXml}</w:tc>`;
}

/**
 * Generates the official Berita Acara .docx by injecting all collected signatures
 * directly into the original template file.
 */
async function generateBeritaAcaraDocx(store) {
  const templateBuffer = fs.readFileSync(TEMPLATE_PATH);
  const zip = await JSZip.loadAsync(templateBuffer);

  let docXml = await zip.file('word/document.xml').async('string');
  let relsXml = await zip.file('word/_rels/document.xml.rels').async('string');
  let contentTypesXml = await zip.file('[Content_Types].xml').async('string');

  // Ensure PNG content type exists
  if (!/Extension="png"/i.test(contentTypesXml)) {
    contentTypesXml = contentTypesXml.replace(
      '</Types>',
      '<Default Extension="png" ContentType="image/png"/></Types>'
    );
  }

  // Track unique relationship IDs and drawing IDs
  let nextRelNum = 100;
  let nextDocPrId = 1000;
  const addedRels = [];

  function registerPng(signatory, maxW, maxH) {
    if (!signatory || !signatory.signed) return null;
    const buf = store.getSignatureBuffer(signatory.id);
    if (!buf) return null;

    const dims =
      signatory.signatureWidth && signatory.signatureHeight
        ? { width: signatory.signatureWidth, height: signatory.signatureHeight }
        : getPngDimensions(buf);

    const { cx, cy } = fitEmu(dims.width, dims.height, maxW, maxH);
    const rId = `rIdSig${nextRelNum++}`;
    const docPrId = nextDocPrId++;
    const fileName = `sig_${signatory.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    zip.file(`word/media/${fileName}`, buf);
    addedRels.push(
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fileName}"/>`
    );
    return { rId, docPrId, cx, cy };
  }

  const allSignatories = store.getAllSignatories();
  const leader = allSignatories.find((s) => s.isLeader);
  const tableSignatories = allSignatories
    .filter((s) => !s.isLeader)
    .sort((a, b) => a.rowNumber - b.rowNumber);

  // 1. Inject Bupati (Pimpinan Rapat) signature if signed
  if (leader && leader.signed) {
    const leaderImg = registerPng(leader, 1950000, 760000); // ~5.4cm x 2.1cm
    if (leaderImg) {
      const drawingRun = buildDrawingRunXml({
        rId: leaderImg.rId,
        docPrId: leaderImg.docPrId,
        name: 'TTD_Bupati_Berau',
        cx: leaderImg.cx,
        cy: leaderImg.cy,
      });

      const bupatiRepNote =
        leader.representedBy && leader.representedBy.name
          ? `<w:p><w:pPr><w:ind w:left="4962"/><w:jc w:val="center"/><w:spacing w:before="20" w:after="40"/></w:pPr>` +
            `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:i/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="334155"/></w:rPr>` +
            `<w:t xml:space="preserve">${escapeXml(`a.n. ${leader.representedBy.name}${leader.representedBy.role ? ` (${leader.representedBy.role})` : ''}`)}</w:t></w:r></w:p>`
          : '';

      const bupatiSigParagraph =
        `<w:p><w:pPr><w:widowControl/><w:spacing w:before="60" w:after="60"/><w:ind w:left="4962"/><w:jc w:val="center"/></w:pPr>` +
        drawingRun +
        `</w:p>` +
        bupatiRepNote;

      // Replace the 3 blank spacer paragraphs between "Bupati" and "HJ. SRI JUNIARSIH MAS, M.PD."
      const blankBlockRegex =
        /<w:p[^>]*w14:paraId="62FB70DA"[^>]*>.*?<\/w:p><w:p[^>]*w14:paraId="269B5E7E"[^>]*>.*?<\/w:p><w:p[^>]*w14:paraId="3184DA92"[^>]*>.*?<\/w:p>/s;
      if (blankBlockRegex.test(docXml)) {
        docXml = docXml.replace(blankBlockRegex, bupatiSigParagraph);
      }
    }
  }

  // Update leader name if Panitia edited it
  if (leader && leader.name) {
    docXml = docXml.replace(
      /<w:t>HJ\. SRI JUNIARSIH MAS, M\.PD\.<\/w:t>/,
      `<w:t>${escapeXml(leader.name)}</w:t>`
    );
  }

  // 2. Process the signatories table
  const tblStart = docXml.indexOf('<w:tbl>');
  const tblEnd = docXml.indexOf('</w:tbl>', tblStart);

  if (tblStart !== -1 && tblEnd !== -1) {
    const tblXml = docXml.slice(tblStart, tblEnd + '</w:tbl>'.length);
    const trRanges = findTagRanges(tblXml, 'w:tr');

    const byTemplateIdx = new Map();
    const customRows = [];
    for (const s of tableSignatories) {
      if (s.templateRowIndex && s.templateRowIndex >= 1 && s.templateRowIndex < trRanges.length) {
        byTemplateIdx.set(s.templateRowIndex, s);
      } else {
        customRows.push(s);
      }
    }

    let rebuiltTbl = tblXml.slice(0, trRanges[0].start);

    for (let rIdx = 0; rIdx < trRanges.length; rIdx++) {
      const range = trRanges[rIdx];
      let rowXml = tblXml.slice(range.start, range.end);

      if (rIdx === 0) {
        // Ensure table header repeats across every F4 page in Word!
        if (!rowXml.includes('<w:tblHeader')) {
          rowXml = rowXml.replace('<w:trPr>', '<w:trPr><w:tblHeader/>');
        }
        rebuiltTbl += rowXml;
        continue;
      }

      // Ensure rows don't split across pages
      if (!rowXml.includes('<w:cantSplit')) {
        rowXml = rowXml.replace('<w:trPr>', '<w:trPr><w:cantSplit/>');
      }

      const sig = byTemplateIdx.get(rIdx);
      if (sig) {
        const tcRanges = findTagRanges(rowXml, 'w:tc');
        if (tcRanges.length >= 4) {
          const imageRef = sig.signed ? registerPng(sig, 1420000, 490000) : null; // ~3.95cm x 1.36cm
          let newRow = rowXml.slice(0, tcRanges[0].start);

          for (let cIdx = 0; cIdx < tcRanges.length; cIdx++) {
            const cRange = tcRanges[cIdx];
            const cellXml = rowXml.slice(cRange.start, cRange.end);
            if (cIdx === 0) {
              newRow += cellXml;
            } else if (cIdx === 1) {
              newRow += replaceCellInnerContent(
                cellXml,
                buildTextCellContentXml(sig.name, { sizeHalfPt: 20 })
              );
            } else if (cIdx === 2) {
              newRow += replaceCellInnerContent(
                cellXml,
                buildTextCellContentXml(sig.role, { sizeHalfPt: 20 })
              );
            } else if (cIdx === 3) {
              if (imageRef) {
                newRow += replaceCellInnerContent(
                  cellXml,
                  buildSignatureCellInnerXml(sig, imageRef)
                );
              } else {
                newRow += cellXml; // Preserve original dots for unsigned rows
              }
            } else {
              newRow += cellXml;
            }
          }
          newRow += rowXml.slice(tcRanges[tcRanges.length - 1].end);
          rowXml = newRow;
        }
      }

      rebuiltTbl += rowXml;
    }

    // Append custom added participants (Row 55+)
    for (const extra of customRows) {
      const imageRef = extra.signed ? registerPng(extra, 1420000, 490000) : null;
      rebuiltTbl += buildCustomRowXml(extra, imageRef);
    }

    rebuiltTbl += tblXml.slice(trRanges[trRanges.length - 1].end);
    docXml = docXml.slice(0, tblStart) + rebuiltTbl + docXml.slice(tblEnd + '</w:tbl>'.length);
  }

  if (addedRels.length > 0) {
    relsXml = relsXml.replace('</Relationships>', `${addedRels.join('')}</Relationships>`);
  }

  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', relsXml);
  zip.file('[Content_Types].xml', contentTypesXml);

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

module.exports = { generateBeritaAcaraDocx };
