/**
 * Calligraphic Auto-Beautified Ink Ribbon Signature Pad
 *
 * Eliminates jagged/polygonal breaks when drawing slowly or pausing mid-stroke:
 * 1. Real-time streamline low-pass filtering removes hand/mouse micro-jitter.
 * 2. Distance filtering avoids stacked blobs when pausing on one spot.
 * 3. Chaikin corner-cutting curve subdivision (3 passes) converts strokes into fluid C1 curves.
 * 4. Gaussian-smoothed velocity/pressure width profile + soft start/end pen tapering.
 * 5. True filled variable-width ink polygon ribbon (no stepped lineWidth seams).
 */
export class SignaturePad {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true });
    this.onChange = onChange || (() => {});

    this.strokes = []; // { color, thickness, rawPoints: [{x,y,t,p}], beautified: null | [{x,y,r}] }
    this.currentStroke = null;
    this.isDrawing = false;
    this.activePointerId = null;

    this.color = '#111827';
    this.thickness = 'medium'; // 'fine' | 'medium' | 'bold'
    this.logicalWidth = 0;
    this.logicalHeight = 0;

    this._rafPending = false;
    this._bindEvents();
  }

  _sizeSpec(mode) {
    if (mode === 'fine') return { minR: 0.75, maxR: 1.85 };
    if (mode === 'bold') return { minR: 1.5, maxR: 3.4 };
    return { minR: 1.05, maxR: 2.55 };
  }

  _bindEvents() {
    this.canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
    window.addEventListener('pointercancel', (e) => this._onUp(e));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const prevW = this.logicalWidth;
    const prevH = this.logicalHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);

    this.logicalWidth = rect.width;
    this.logicalHeight = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (prevW > 0 && prevH > 0 && (Math.abs(prevW - rect.width) > 1 || Math.abs(prevH - rect.height) > 1)) {
      const sx = rect.width / prevW;
      const sy = rect.height / prevH;
      for (const stroke of this.strokes) {
        for (const p of stroke.rawPoints) {
          p.x *= sx;
          p.y *= sy;
        }
        stroke.beautified = this._buildBeautifiedRibbon(stroke.rawPoints, stroke.thickness, true);
      }
    }

    this.redraw();
  }

  setColor(hex) {
    this.color = hex;
  }

  setThickness(mode) {
    this.thickness = mode;
  }

  isEmpty() {
    return this.strokes.length === 0;
  }

  clear() {
    this.strokes = [];
    this.currentStroke = null;
    this.isDrawing = false;
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    this.onChange();
  }

  undo() {
    if (!this.strokes.length) return;
    this.strokes.pop();
    this.redraw();
    this.onChange();
  }

  _rawPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      t: e.timeStamp || performance.now(),
      p: e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : null,
    };
  }

  _onDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    if (!this.logicalWidth) this.resize();

    this.activePointerId = e.pointerId;
    if (this.canvas.setPointerCapture) {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    const pt = this._rawPoint(e);
    this.isDrawing = true;
    this.currentStroke = {
      color: this.color,
      thickness: this.thickness,
      rawPoints: [pt],
      smoothedCursor: { x: pt.x, y: pt.y },
      beautified: null,
    };
    this.strokes.push(this.currentStroke);
    this._scheduleRedraw();
    this.onChange();
  }

  _onMove(e) {
    if (!this.isDrawing || e.pointerId !== this.activePointerId || !this.currentStroke) return;
    e.preventDefault();

    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    const pts = this.currentStroke.rawPoints;
    const cursor = this.currentStroke.smoothedCursor;

    // Streamline low-pass filter removes mouse/touch micro-tremors while keeping responsiveness
    const alpha = 0.52;
    let added = false;

    for (const ev of events) {
      const raw = this._rawPoint(ev);
      cursor.x = cursor.x + (raw.x - cursor.x) * alpha;
      cursor.y = cursor.y + (raw.y - cursor.y) * alpha;

      const prev = pts[pts.length - 1];
      const dist = Math.hypot(cursor.x - prev.x, cursor.y - prev.y);
      // Ignore stationary pause jitter (< 2.4px) so stopping mid-stroke never creates jagged knots
      if (dist < 2.4) continue;

      pts.push({
        x: cursor.x,
        y: cursor.y,
        t: raw.t,
        p: raw.p,
      });
      added = true;
    }

    if (added) {
      this._scheduleRedraw();
    }
  }

  _onUp(e) {
    if (!this.isDrawing || (this.activePointerId !== null && e.pointerId !== this.activePointerId)) return;
    if (this.currentStroke) {
      // Auto-beautify completed stroke with full Chaikin curve smoothing + graceful pen tapering
      this.currentStroke.beautified = this._buildBeautifiedRibbon(
        this.currentStroke.rawPoints,
        this.currentStroke.thickness,
        true
      );
    }
    this.isDrawing = false;
    this.activePointerId = null;
    this.currentStroke = null;
    this.redraw();
    this.onChange();
  }

  _scheduleRedraw() {
    if (this._rafPending) return;
    this._rafPending = true;
    requestAnimationFrame(() => {
      this._rafPending = false;
      this.redraw();
    });
  }

  /**
   * Builds a smooth calligraphic ribbon [{ x, y, r }] from raw points.
   */
  _buildBeautifiedRibbon(rawPoints, thickness, finalize) {
    const { minR, maxR } = this._sizeSpec(thickness);
    if (!rawPoints || rawPoints.length === 0) return [];
    if (rawPoints.length === 1) {
      return [{ x: rawPoints[0].x, y: rawPoints[0].y, r: (minR + maxR) * 0.55 }];
    }

    // 1. Deduplicate near-coincident points and compute initial target radius per point
    const cleaned = [];
    for (let i = 0; i < rawPoints.length; i++) {
      const pt = rawPoints[i];
      if (i > 0) {
        const prev = cleaned[cleaned.length - 1];
        const d = Math.hypot(pt.x - prev.x, pt.y - prev.y);
        if (d < 1.8 && i < rawPoints.length - 1) continue;
      }
      cleaned.push(pt);
    }
    if (cleaned.length < 2) {
      return [{ x: cleaned[0].x, y: cleaned[0].y, r: (minR + maxR) * 0.55 }];
    }

    // Compute velocity-based (or stylus pressure) radius with clamping so pauses don't create huge ink blobs
    const withR = cleaned.map((pt, i) => {
      if (pt.p !== null) {
        const r = minR + (maxR - minR) * Math.min(1, Math.max(0.15, pt.p * 1.1));
        return { x: pt.x, y: pt.y, r };
      }
      if (i === 0) return { x: pt.x, y: pt.y, r: (minR + maxR) * 0.52 };
      const prev = cleaned[i - 1];
      const dist = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      const dt = Math.max(8, Math.min(85, pt.t - prev.t)); // Clamp dt so pausing doesn't spike thickness
      const vel = dist / dt; // px/ms
      const speedFactor = Math.min(1, vel / 1.75);
      // Graceful calligraphic response: faster strokes slightly thinner, deliberate curves richer
      const r = maxR - (maxR - minR) * Math.pow(speedFactor, 0.85);
      return { x: pt.x, y: pt.y, r };
    });

    // 2. Chaikin corner-cutting subdivision (turns any sharp kinks into silky organic splines!)
    const passes = finalize ? 3 : 2;
    let pts = withR;
    for (let pass = 0; pass < passes; pass++) {
      if (pts.length < 3) break;
      const next = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        next.push({
          x: 0.75 * a.x + 0.25 * b.x,
          y: 0.75 * a.y + 0.25 * b.y,
          r: 0.75 * a.r + 0.25 * b.r,
        });
        next.push({
          x: 0.25 * a.x + 0.75 * b.x,
          y: 0.25 * a.y + 0.75 * b.y,
          r: 0.25 * a.r + 0.75 * b.r,
        });
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }

    // 3. Gaussian smooth radius along the stroke so thickness flows seamlessly
    const kernel = [0.06, 0.12, 0.2, 0.24, 0.2, 0.12, 0.06];
    const half = 3;
    const smoothR = pts.map((_, i) => {
      let acc = 0;
      for (let k = -half; k <= half; k++) {
        const idx = Math.max(0, Math.min(pts.length - 1, i + k));
        acc += pts[idx].r * kernel[k + half];
      }
      return acc;
    });

    // 4. Arc-length based graceful entry & exit pen taper
    const cumDist = [0];
    for (let i = 1; i < pts.length; i++) {
      cumDist.push(cumDist[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    const totalLen = cumDist[cumDist.length - 1] || 1;
    const taperIn = Math.min(18, totalLen * 0.14);
    const taperOut = finalize ? Math.min(28, totalLen * 0.2) : 0;

    return pts.map((p, i) => {
      const dStart = cumDist[i];
      const dEnd = totalLen - dStart;
      let scale = 1;
      if (taperIn > 0 && dStart < taperIn) {
        const t = dStart / taperIn;
        scale = Math.min(scale, 0.42 + 0.58 * (t * (2 - t)));
      }
      if (taperOut > 0 && dEnd < taperOut) {
        const t = dEnd / taperOut;
        scale = Math.min(scale, 0.25 + 0.75 * (t * (2 - t)));
      }
      return {
        x: p.x,
        y: p.y,
        r: Math.max(0.45, smoothR[i] * scale),
      };
    });
  }

  _renderRibbon(pts, color) {
    if (!pts || pts.length === 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = color;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, pts[0].r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const left = [];
    const right = [];

    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) {
        if (left.length > 0) {
          left.push(left[left.length - 1]);
          right.push(right[right.length - 1]);
        }
        continue;
      }
      dx /= len;
      dy /= len;
      const nx = -dy;
      const ny = dx;
      const r = pts[i].r;
      left.push({ x: pts[i].x + nx * r, y: pts[i].y + ny * r });
      right.push({ x: pts[i].x - nx * r, y: pts[i].y - ny * r });
    }

    if (left.length < 2) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, pts[0].r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Build smooth closed ink polygon using quadratic midpoints along both edges
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length - 1; i++) {
      const mx = (left[i].x + left[i + 1].x) / 2;
      const my = (left[i].y + left[i + 1].y) / 2;
      ctx.quadraticCurveTo(left[i].x, left[i].y, mx, my);
    }
    ctx.lineTo(left[left.length - 1].x, left[left.length - 1].y);

    // Smooth rounded end cap
    const lastPt = pts[pts.length - 1];
    ctx.lineTo(right[right.length - 1].x, right[right.length - 1].y);

    for (let i = right.length - 2; i >= 1; i--) {
      const mx = (right[i].x + right[i - 1].x) / 2;
      const my = (right[i].y + right[i - 1].y) / 2;
      ctx.quadraticCurveTo(right[i].x, right[i].y, mx, my);
    }
    ctx.lineTo(right[0].x, right[0].y);
    ctx.closePath();
    ctx.fill();

    // Clean start & end circular caps
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, pts[0].r, 0, Math.PI * 2);
    ctx.arc(lastPt.x, lastPt.y, lastPt.r, 0, Math.PI * 2);
    ctx.fill();
  }

  redraw() {
    this.ctx.clearRect(0, 0, this.logicalWidth, this.logicalHeight);
    for (const stroke of this.strokes) {
      const ribbon =
        stroke.beautified || this._buildBeautifiedRibbon(stroke.rawPoints, stroke.thickness, false);
      this._renderRibbon(ribbon, stroke.color);
    }
  }

  exportTrimmedPng() {
    if (this.isEmpty()) return null;

    const w = this.canvas.width;
    const h = this.canvas.height;
    const imgData = this.ctx.getImageData(0, 0, w, h).data;

    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (imgData[(y * w + x) * 4 + 3] > 12) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }

    if (!found) return null;

    const pad = Math.round(Math.max(18, Math.min(w, h) * 0.04));
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(w - sx, maxX - minX + pad * 2);
    const sh = Math.min(h - sy, maxY - minY + pad * 2);

    const scale = Math.min(1, 900 / Math.max(sw, 1));
    const outW = Math.max(20, Math.round(sw * scale));
    const outH = Math.max(20, Math.round(sh * scale));

    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    out.getContext('2d').drawImage(this.canvas, sx, sy, sw, sh, 0, 0, outW, outH);
    return out.toDataURL('image/png');
  }
}
