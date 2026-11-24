/**
 * Smart Signature Image Processor
 * Converts uploaded signature images (even phone photos on white paper) into
 * crisp, anti-aliased transparent PNG signatures with optional ink recoloring & auto-trim.
 */
export class SignatureImageCleaner {
  constructor(previewCanvas) {
    this.previewCanvas = previewCanvas;
    this.sourceImage = null;
    this.removeBg = true;
    this.threshold = 205;
    this.recolor = 'original'; // 'original' | '#0F172A' | '#0F295C'
    this.processedCanvas = null;
  }

  hasImage() {
    return Boolean(this.sourceImage);
  }

  reset() {
    this.sourceImage = null;
    this.processedCanvas = null;
    const ctx = this.previewCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
  }

  async loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Pilih file gambar PNG, JPG, atau WebP yang valid.');
    }
    if (file.size > 6 * 1024 * 1024) {
      throw new Error('Ukuran file gambar maksimal 6 MB.');
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Gambar tidak dapat dimuat.'));
      image.src = dataUrl;
    });

    this.sourceImage = img;

    // Auto-detect whether the uploaded PNG already has meaningful transparency
    const hasExistingTransparency = this._detectTransparency(img);
    this.removeBg = !hasExistingTransparency;
    this.process();

    return { hasExistingTransparency, removeBg: this.removeBg };
  }

  _detectTransparency(img) {
    const sample = document.createElement('canvas');
    const maxDim = 240;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    sample.width = Math.max(1, Math.round(img.width * scale));
    sample.height = Math.max(1, Math.round(img.height * scale));
    const ctx = sample.getContext('2d');
    ctx.drawImage(img, 0, 0, sample.width, sample.height);
    const data = ctx.getImageData(0, 0, sample.width, sample.height).data;
    let transparentCount = 0;
    const total = sample.width * sample.height;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 200) transparentCount++;
    }
    return transparentCount / total > 0.12;
  }

  setOptions({ removeBg, threshold, recolor }) {
    if (typeof removeBg === 'boolean') this.removeBg = removeBg;
    if (typeof threshold === 'number') this.threshold = threshold;
    if (typeof recolor === 'string') this.recolor = recolor;
    if (this.sourceImage) this.process();
  }

  _hexToRgb(hex) {
    const clean = hex.replace('#', '');
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }

  process() {
    if (!this.sourceImage) return;

    const img = this.sourceImage;
    const maxDim = 1000;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(10, Math.round(img.width * scale));
    const h = Math.max(10, Math.round(img.height * scale));

    const work = document.createElement('canvas');
    work.width = w;
    work.height = h;
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const recolorRgb = this.recolor !== 'original' ? this._hexToRgb(this.recolor) : null;

    if (this.removeBg) {
      // Soft luminance ramp for crisp, anti-aliased paper removal
      const upper = this.threshold;
      const lower = Math.max(20, upper - 68);
      const span = Math.max(1, upper - lower);

      for (let i = 0; i < d.length; i += 4) {
        const origA = d[i + 3];
        if (origA === 0) continue;

        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;

        if (lum >= upper) {
          d[i + 3] = 0;
        } else {
          // Smooth opacity transition for anti-aliased stroke edges
          const factor = lum <= lower ? 1 : (upper - lum) / span;
          const boostedAlpha = Math.min(255, Math.round(origA * Math.pow(factor, 0.85)));
          d[i + 3] = boostedAlpha;

          if (recolorRgb) {
            d[i] = recolorRgb[0];
            d[i + 1] = recolorRgb[1];
            d[i + 2] = recolorRgb[2];
          } else {
            // Gently deepen ink contrast when lifting off paper
            d[i] = Math.round(r * 0.85);
            d[i + 1] = Math.round(g * 0.85);
            d[i + 2] = Math.round(b * 0.85);
          }
        }
      }
    } else if (recolorRgb) {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 15) {
          d[i] = recolorRgb[0];
          d[i + 1] = recolorRgb[1];
          d[i + 2] = recolorRgb[2];
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Auto-trim transparent bounds
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 18) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }

    const out = document.createElement('canvas');
    if (found) {
      const pad = Math.round(Math.max(14, Math.min(w, h) * 0.03));
      const sx = Math.max(0, minX - pad);
      const sy = Math.max(0, minY - pad);
      const sw = Math.min(w - sx, maxX - minX + pad * 2);
      const sh = Math.min(h - sy, maxY - minY + pad * 2);
      out.width = Math.max(20, sw);
      out.height = Math.max(20, sh);
      out.getContext('2d').drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height);
    } else {
      out.width = w;
      out.height = h;
      out.getContext('2d').drawImage(work, 0, 0);
    }

    this.processedCanvas = out;

    // Paint to visible preview canvas
    this.previewCanvas.width = out.width;
    this.previewCanvas.height = out.height;
    const pctx = this.previewCanvas.getContext('2d');
    pctx.clearRect(0, 0, out.width, out.height);
    pctx.drawImage(out, 0, 0);
  }

  exportPng() {
    if (!this.processedCanvas) return null;
    return this.processedCanvas.toDataURL('image/png');
  }
}
