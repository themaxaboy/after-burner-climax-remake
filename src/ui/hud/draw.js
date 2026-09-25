// Shared Canvas2D helpers for the HUD modules: font strings, offscreen
// sprites (static layers cached until the next resize), glyph atlases for
// numbers (no per-frame string building) and a few reusable shapes.

export const TAU = Math.PI * 2;
export const FAM_DISPLAY = "Orbitron, Rajdhani, 'Noto Sans Thai', sans-serif";
export const FAM_UI = "Rajdhani, 'Noto Sans Thai', Tahoma, sans-serif";

export const COL = {
  green: '#6dff7c',
  greenDim: 'rgba(170, 255, 190, 0.5)',
  red: '#ff2b2b',
  redDeep: '#c80a14',
  yellow: '#ffe53b',
  yellowDeep: '#ffb400',
  orange: '#ff9a2a',
  magenta: '#ff3fd0',
  pink: '#ff4fc8',
  cyan: '#5fe3ff',
  blue: '#2f7bff',
  white: '#ffffff',
  ink: '#0b1426',
  inkSoft: 'rgba(6, 12, 26, 0.72)'
};

/** CSS font shorthand. Build these at layout time, not per frame. */
export function font(size, weight = 700, fam = FAM_DISPLAY, style = '') {
  const px = Math.max(1, Math.round(size * 10) / 10);
  return `${style ? style + ' ' : ''}${weight} ${px}px ${fam}`;
}

export function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w));
  h = Math.max(1, Math.ceil(h));
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

/**
 * Offscreen drawing with an origin: `begin(w, h, ox, oy)` returns a context
 * whose (0, 0) is the origin; `draw(c, x, y)` blits it with the origin at x, y.
 */
export class Sprite {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.ox = 0;
    this.oy = 0;
    this.w = 0;
    this.h = 0;
  }

  begin(w, h, ox = 0, oy = 0) {
    w = Math.max(1, Math.ceil(w));
    h = Math.max(1, Math.ceil(h));
    if (!this.canvas) {
      this.canvas = makeCanvas(w, h);
      this.ctx = this.canvas?.getContext('2d') || null;
    } else if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = w;
    this.h = h;
    this.ox = ox;
    this.oy = oy;
    const c = this.ctx;
    if (!c) return null;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.setTransform(1, 0, 0, 1, ox, oy);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.miterLimit = 2;
    return c;
  }

  draw(c, x, y) {
    if (this.canvas) c.drawImage(this.canvas, x - this.ox, y - this.oy);
  }

  /** Draw scaled about the origin. */
  drawScaled(c, x, y, s) {
    if (this.canvas) c.drawImage(this.canvas, x - this.ox * s, y - this.oy * s, this.w * s, this.h * s);
  }
}

/** Stroke-then-fill text (outlined arcade lettering). */
export function strokeFill(c, text, x, y, fill, stroke, lw) {
  if (stroke && lw > 0) {
    c.lineWidth = lw;
    c.strokeStyle = stroke;
    c.strokeText(text, x, y);
  }
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

/**
 * Glyph atlas for numbers and a few symbols in one arcade style (fill
 * gradient, inner light stroke, dark outer stroke, optional glow and skew).
 * `number()` and `text()` draw without allocating strings.
 */
export class GlyphFont {
  /**
   * @param {object} o {chars, weight, family, fill: string | [stops], stroke, strokeW, outer, outerW, glow, skew, mono}
   */
  constructor(o) {
    this.o = o;
    this.sprite = new Sprite();
    this.size = 0;
    this.adv = 0;
    this.cellW = 0;
    this.cellH = 0;
    this.map = new Int16Array(128).fill(-1);
    this.advs = [];
  }

  build(size) {
    const o = this.o;
    const chars = o.chars || '0123456789';
    this.size = size;
    const outerW = (o.outerW ?? 0.16) * size;
    const glow = o.glow ? size * 0.35 : 0;
    const skew = o.skew || 0;
    const pad = Math.ceil(outerW + glow + 2);
    const f = font(size, o.weight || 900, o.family || FAM_DISPLAY);
    const probe = makeCanvas(4, 4)?.getContext('2d');
    if (!probe) return;
    probe.font = f;
    let mono = 0;
    for (let d = 0; d < 10; d++) mono = Math.max(mono, probe.measureText(String(d)).width);
    this.adv = mono * (o.tracking ?? 0.96);
    this.advs.length = 0;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const w = ch >= '0' && ch <= '9' ? this.adv : probe.measureText(ch).width * (o.tracking ?? 0.96);
      this.advs.push(w);
    }
    const maxW = Math.max(this.adv, ...this.advs);
    this.cellW = Math.ceil(maxW + pad * 2 + Math.abs(skew) * size);
    this.cellH = Math.ceil(size * 1.15 + pad * 2);
    const c = this.sprite.begin(this.cellW * chars.length, this.cellH, 0, 0);
    c.font = f;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      this.map[ch.charCodeAt(0)] = i;
      const cx = i * this.cellW + this.cellW / 2, cy = this.cellH / 2;
      c.setTransform(1, 0, -skew, 1, cx + skew * cy, 0);
      let fill = o.fill || '#fff';
      if (Array.isArray(fill)) {
        const g = c.createLinearGradient(0, cy - size * 0.5, 0, cy + size * 0.5);
        fill.forEach((col, k) => g.addColorStop(k / (fill.length - 1), col));
        fill = g;
      }
      if (glow) {
        c.shadowColor = o.glow;
        c.shadowBlur = glow;
      }
      if (o.outer) {
        c.lineWidth = outerW * 2;
        c.strokeStyle = o.outer;
        c.strokeText(ch, 0, cy);
      }
      c.shadowBlur = 0;
      if (o.stroke) {
        c.lineWidth = (o.strokeW ?? 0.07) * size * 2;
        c.strokeStyle = o.stroke;
        c.strokeText(ch, 0, cy);
      }
      c.fillStyle = fill;
      c.fillText(ch, 0, cy);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
  }

  _glyph(c, code, x, y, k) {
    const i = code < 128 ? this.map[code] : -1;
    if (i < 0 || !this.sprite.canvas) return 0;
    const cw = this.cellW, ch = this.cellH;
    const adv = this.advs[i];
    c.drawImage(this.sprite.canvas, i * cw, 0, cw, ch, x + (adv - cw) * 0.5 * k, y - ch * 0.5 * k, cw * k, ch * k);
    return adv * k;
  }

  numberWidth(n, pad = 1, k = 1) {
    n = Math.max(0, Math.floor(n));
    let digits = 1;
    for (let m = n; m >= 10; m = Math.floor(m / 10)) digits++;
    return Math.max(digits, pad) * this.adv * k;
  }

  /**
   * Draw a non-negative integer, zero-padded to `pad` digits. y is the glyph
   * middle; align 0 = left, 0.5 = centre, 1 = right. Returns the width.
   */
  number(c, n, x, y, pad = 1, align = 0, k = 1) {
    n = Math.max(0, Math.floor(n));
    const w = this.numberWidth(n, pad, k);
    const count = Math.round(w / (this.adv * k));
    let px = x - w * align + (count - 1) * this.adv * k;
    let m = n;
    for (let i = 0; i < count; i++) {
      this._glyph(c, 48 + (m % 10), px, y, k);
      m = Math.floor(m / 10);
      px -= this.adv * k;
    }
    return w;
  }

  textWidth(str, k = 1) {
    let w = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      const j = code < 128 ? this.map[code] : -1;
      w += j >= 0 ? this.advs[j] : this.adv * 0.5;
    }
    return w * k;
  }

  /** Draw a short string of atlas characters (unknown chars leave a gap). */
  text(c, str, x, y, align = 0, k = 1) {
    let px = x - this.textWidth(str, k) * align;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      const adv = this._glyph(c, code, px, y, k);
      px += adv || this.adv * 0.5 * k;
    }
    return px;
  }
}

/** Radial glow sprite (white core, coloured falloff), for additive blits. */
const glowCache = new Map();
export function glowSprite(color, size = 64) {
  const key = color + size;
  let s = glowCache.get(key);
  if (s) return s;
  s = new Sprite();
  const r = size / 2;
  const c = s.begin(size, size, r, r);
  if (c) {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.18, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(-r, -r, size, size);
  }
  glowCache.set(key, s);
  return s;
}

/** Four-point lens flare sprite (glint at the end of the Climax bar). */
export function flareSprite(color, size = 96) {
  const key = 'flare' + color + size;
  let s = glowCache.get(key);
  if (s) return s;
  s = new Sprite();
  const r = size / 2;
  const c = s.begin(size, size, r, r);
  if (c) {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.45);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(-r, -r, size, size);
    c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) {
      c.save();
      c.rotate(k * Math.PI / 2);
      const lg = c.createLinearGradient(-r, 0, r, 0);
      lg.addColorStop(0, 'rgba(0,0,0,0)');
      lg.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      lg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = lg;
      c.beginPath();
      c.moveTo(-r, 0);
      c.lineTo(0, -r * 0.05);
      c.lineTo(r, 0);
      c.lineTo(0, r * 0.05);
      c.closePath();
      c.fill();
      c.restore();
    }
  }
  glowCache.set(key, s);
  return s;
}

/** Five-point star path centred at (x, y). */
export function starPath(c, x, y, r, inner = 0.45) {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const rr = k % 2 === 0 ? r : r * inner;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

/** Rounded rectangle path. */
export function roundRect(c, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

/** Parallelogram (slanted plate) path: x, y top-left, slant in px. */
export function slantRect(c, x, y, w, h, slant) {
  c.beginPath();
  c.moveTo(x + slant, y);
  c.lineTo(x + w + slant, y);
  c.lineTo(x + w, y + h);
  c.lineTo(x, y + h);
  c.closePath();
}

/** Small jet silhouette (top view, nose up) centred at x, y. */
export function jetIconPath(c, x, y, s) {
  c.beginPath();
  c.moveTo(x, y - s);
  c.lineTo(x + s * 0.14, y - s * 0.45);
  c.lineTo(x + s * 0.9, y + s * 0.2);
  c.lineTo(x + s * 0.9, y + s * 0.38);
  c.lineTo(x + s * 0.16, y + s * 0.2);
  c.lineTo(x + s * 0.14, y + s * 0.62);
  c.lineTo(x + s * 0.45, y + s * 0.9);
  c.lineTo(x + s * 0.45, y + s);
  c.lineTo(x, y + s * 0.86);
  c.lineTo(x - s * 0.45, y + s);
  c.lineTo(x - s * 0.45, y + s * 0.9);
  c.lineTo(x - s * 0.14, y + s * 0.62);
  c.lineTo(x - s * 0.16, y + s * 0.2);
  c.lineTo(x - s * 0.9, y + s * 0.38);
  c.lineTo(x - s * 0.9, y + s * 0.2);
  c.lineTo(x - s * 0.14, y - s * 0.45);
  c.closePath();
}

/**
 * Winged badge (original design): three swept feathers in red, white and
 * blue with a dark outline, drawn in a 110×84 box (dir 1 = wing sweeps left,
 * -1 = mirrored). x, y = top-left of the box.
 */
export function drawWingBadge(c, x, y, u, dir = 1) {
  c.save();
  c.translate(x + (dir < 0 ? 110 * u : 0), y);
  c.scale(dir * u, u);
  const feathers = [
    { tip: [4, 6], rootT: [92, 26], rootB: [98, 38], inner: [26, 20], fill: ['#ffffff', '#ff5a5a', '#d4101c'] },
    { tip: [12, 28], rootT: [92, 40], rootB: [98, 53], inner: [34, 41], fill: ['#ffffff', '#f2f6ff', '#b8c6e0'] },
    { tip: [22, 50], rootT: [92, 55], rootB: [96, 68], inner: [42, 62], fill: ['#ffffff', '#5a8dff', '#1238b8'] }
  ];
  c.lineJoin = 'round';
  for (const f of feathers) {
    c.beginPath();
    c.moveTo(f.tip[0], f.tip[1]);
    c.lineTo(f.rootT[0], f.rootT[1]);
    c.lineTo(f.rootB[0], f.rootB[1]);
    c.lineTo(f.inner[0], f.inner[1]);
    c.closePath();
    const g = c.createLinearGradient(f.tip[0], f.tip[1], f.rootB[0], f.rootB[1]);
    g.addColorStop(0, f.fill[0]);
    g.addColorStop(0.45, f.fill[1]);
    g.addColorStop(1, f.fill[2]);
    c.fillStyle = g;
    c.strokeStyle = 'rgba(8, 14, 30, 0.9)';
    c.lineWidth = 4.5;
    c.stroke();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(f.tip[0] + 3, f.tip[1] + 1.5);
    c.lineTo(f.rootT[0] - 4, f.rootT[1] + 1.5);
    c.stroke();
  }
  // root clasp: a slanted bar the feathers plug into
  c.beginPath();
  c.moveTo(94, 20);
  c.lineTo(106, 24);
  c.lineTo(104, 76);
  c.lineTo(92, 72);
  c.closePath();
  const g = c.createLinearGradient(92, 20, 106, 76);
  g.addColorStop(0, '#f4f8ff');
  g.addColorStop(1, '#7d8cab');
  c.fillStyle = g;
  c.strokeStyle = 'rgba(8, 14, 30, 0.9)';
  c.lineWidth = 3.5;
  c.stroke();
  c.fill();
  c.restore();
}

/**
 * HUD label ("SCORE", "STAGE"…): heavy italic white text with a dark outline
 * and a red speed slash in front. Returns the text width.
 */
export function drawLabel(c, text, x, y, size, { align = 'left', slash = COL.red, color = '#fff', italic = true } = {}) {
  c.font = font(size, 900, FAM_DISPLAY, italic ? 'italic' : '');
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  const w = c.measureText(text).width;
  const x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  if (slash) {
    c.fillStyle = slash;
    const sh = size * 0.34;
    c.beginPath();
    c.moveTo(x0 - size * 1.9, y - size * 0.05);
    c.lineTo(x0 - size * 0.25, y - size * 0.05 - sh);
    c.lineTo(x0 - size * 0.35, y - size * 0.05);
    c.closePath();
    c.fill();
  }
  c.lineJoin = 'round';
  strokeFill(c, text, x, y, color, 'rgba(6, 10, 24, 0.9)', size * 0.22);
  return w;
}
