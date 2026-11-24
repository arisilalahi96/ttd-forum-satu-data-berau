'use strict';

const crypto = require('crypto');
const { PNG } = require('pngjs');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Decode a base64 PNG data URL into a validated PNG Buffer with exact pixel dimensions.
 */
function parseAndValidatePngDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Format tanda tangan harus berupa gambar PNG yang valid.');
  }

  const base64Body = dataUrl.slice('data:image/png;base64,'.length);
  const buffer = Buffer.from(base64Body, 'base64');

  if (buffer.length < 32 || buffer.length > MAX_PNG_BYTES) {
    throw new Error('Ukuran gambar tanda tangan tidak valid (maksimal 2 MB).');
  }

  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Header file PNG tidak valid.');
  }

  let parsed;
  try {
    parsed = PNG.sync.read(buffer);
  } catch (err) {
    throw new Error('Gagal membaca data gambar PNG.');
  }

  if (parsed.width < 10 || parsed.height < 10 || parsed.width > 4000 || parsed.height > 4000) {
    throw new Error('Dimensi gambar tanda tangan di luar batas wajar.');
  }

  // Verify there are actually visible non-transparent pixels so blank submissions are rejected
  let visiblePixels = 0;
  for (let i = 3; i < parsed.data.length; i += 4) {
    if (parsed.data[i] > 20) {
      visiblePixels++;
      if (visiblePixels >= 25) break;
    }
  }
  if (visiblePixels < 25) {
    throw new Error('Kanvas tanda tangan masih kosong. Silakan goreskan atau unggah tanda tangan.');
  }

  return {
    buffer,
    width: parsed.width,
    height: parsed.height,
  };
}

function getPngDimensions(buffer) {
  try {
    const parsed = PNG.sync.read(buffer);
    return { width: parsed.width, height: parsed.height };
  } catch {
    return { width: 400, height: 160 };
  }
}

function computeVerificationHash({ documentId, signatoryId, name, representedBy, signedAt, pngBuffer }) {
  const pngDigest = crypto.createHash('sha256').update(pngBuffer).digest('hex');
  const payload = [
    documentId,
    signatoryId,
    name,
    representedBy ? `${representedBy.name}|${representedBy.role}` : 'DIRECT',
    signedAt,
    pngDigest,
  ].join('::');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 20).toUpperCase();
}

module.exports = {
  parseAndValidatePngDataUrl,
  getPngDimensions,
  computeVerificationHash,
};
