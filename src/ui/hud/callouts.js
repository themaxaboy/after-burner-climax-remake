import { Sprite, font, FAM_DISPLAY, FAM_UI, starPath } from './draw.js';

const VARIANTS = {
  red: { fill: ['#ffe2d6', '#ff4020', '#b4000e'], stroke: '#ffe53b', outer: '#240000', band: 'rgba(60, 0, 8, 0.55)', edge: '#ffe53b' },
  gold: { fill: ['#fffbd0', '#ffd21a', '#ff6a00'], stroke: '#d8101c', outer: '#2a0400', band: 'rgba(70, 10, 0, 0.5)', edge: '#ff3b30' },
  cyan: { fill: ['#ffffff', '#86ecff', '#1c74ff'], stroke: '#ffffff', outer: '#001640', band: 'rgba(0, 30, 70, 0.5)', edge: '#8ff0ff' },
  green: { fill: ['#f2fff2', '#86ff7c', '#16a034'], stroke: '#ffffff', outer: '#002810', band: 'rgba(0, 40, 14, 0.5)', edge: '#b6ff9a' }
};

/** Callout variant from an explicit name or a message colour. */
export function calloutVariant(v, color) {
  if (v && VARIANTS[v]) return v;
  const c = (color || '').toLowerCase();
  if (!c) return 'red';
  if (c === '#7dffb0' || c.startsWith('#7d') || c.startsWith('#8d')) return 'green';
  if (c.includes('5fd4ff') || c.includes('5fe3ff') || c.startsWith('#4') || c.startsWith('#6f')) return 'cyan';
  if (c.includes('ffd')) return 'gold';
  return 'red';
}

const easeOutBack = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);

/**
 * Screen messages (`hud.messages`): 'callout' style = big skewed banners that
 * slide in from the right (ENGAGE, MISSION COMPLETE, CLIMAX, ALL DOWN,
 * EVADED); 'top' / 'center' = clean italic headline with a sub line. Each
 * message is pre-rendered once into its own sprite.
 */
export class Callouts {
  constructor(hud) {
    this.hud = hud;
    this.L = null;
  }

  layout(L) {
    this.L = L;
    for (const m of this.hud.messages) m.sprite = null;
  }

  _build(m) {
    const u = this.L.u;
    const sp = (m.sprite = new Sprite());
    if (m.style === 'callout') this._buildCallout(sp, m, u);
    else this._buildHeadline(sp, m, u);
  }

  _buildCallout(sp, m, u) {
    const V = VARIANTS[m.variant] || VARIANTS.red;
    const size = (m.size || 62) * u;
    const skew = 0.24;
    const probe = sp.begin(8, 8);
    if (!probe) return;
    const f = font(size, 900, FAM_DISPLAY);
    probe.font = f;
    const tw = Math.min(probe.measureText(m.text).width, this.L.W * 0.9);
    const subF = font(18 * u, 700, FAM_UI, 'italic');
    const w = tw + size * 1.6, h = size * 1.9 + (m.sub ? 26 * u : 0);
    const c = sp.begin(w, h, w / 2, size * 0.95);
    // banner band behind the text
    c.save();
    c.transform(1, 0, -skew, 1, 0, 0);
    const bh = size * 0.78;
    const g0 = c.createLinearGradient(-w / 2, 0, w / 2, 0);
    g0.addColorStop(0, 'rgba(0,0,0,0)');
    g0.addColorStop(0.2, V.band);
    g0.addColorStop(0.8, V.band);
    g0.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g0;
    c.fillRect(-w / 2, -bh / 2, w, bh);
    const ge = c.createLinearGradient(-w / 2, 0, w / 2, 0);
    ge.addColorStop(0, 'rgba(255,255,255,0)');
    ge.addColorStop(0.3, V.edge);
    ge.addColorStop(0.7, V.edge);
    ge.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = ge;
    c.fillRect(-w / 2, -bh / 2 - 3 * u, w, 2.5 * u);
    c.fillRect(-w / 2, bh / 2 + 1 * u, w, 2.5 * u);
    // text
    c.font = f;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = size * 0.3;
    c.strokeStyle = V.outer;
    c.strokeText(m.text, 0, 0, tw);
    c.lineWidth = size * 0.15;
    c.strokeStyle = V.stroke;
    c.strokeText(m.text, 0, 0, tw);
    const g = c.createLinearGradient(0, -size * 0.45, 0, size * 0.45);
    V.fill.forEach((col, i) => g.addColorStop(i / (V.fill.length - 1), col));
    c.fillStyle = g;
    c.fillText(m.text, 0, 0, tw);
    // glossy top half
    c.save();
    c.beginPath();
    c.rect(-w / 2, -size * 0.6, w, size * 0.52);
    c.clip();
    c.globalAlpha = 0.35;
    c.fillStyle = '#ffffff';
    c.fillText(m.text, 0, 0, tw);
    c.restore();
    c.restore();
    if (m.sub) {
      c.font = subF;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 4 * u;
      c.strokeStyle = 'rgba(0, 6, 20, 0.85)';
      c.strokeText(m.sub, 0, size * 0.72 + 8 * u);
      c.fillStyle = '#ffffff';
      c.fillText(m.sub, 0, size * 0.72 + 8 * u);
    }
    m.w = tw;
  }

  _buildHeadline(sp, m, u) {
    const size = 32 * u;
    const probe = sp.begin(8, 8);
    if (!probe) return;
    const f = font(size, 900, FAM_DISPLAY, 'italic');
    const subF = font(17 * u, 700, FAM_UI);
    probe.font = f;
    const tw = Math.min(probe.measureText(m.text).width, this.L.W * 0.86);
    probe.font = subF;
    const sw = m.sub ? probe.measureText(m.sub).width : 0;
    const w = Math.max(tw, sw) + 260 * u, h = size * 1.6 + (m.sub ? 34 * u : 10 * u);
    const c = sp.begin(w, h, w / 2, size * 0.85);
    const col = m.color || '#ffffff';
    c.font = f;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = size * 0.26;
    c.strokeStyle = 'rgba(0, 8, 24, 0.85)';
    c.strokeText(m.text, 0, 0, tw);
    c.lineWidth = size * 0.1;
    c.strokeStyle = col;
    c.strokeText(m.text, 0, 0, tw);
    c.fillStyle = '#ffffff';
    c.fillText(m.text, 0, 0, tw);
    // accent rules either side
    c.fillStyle = col;
    const lx = tw / 2 + 18 * u, lw = 90 * u;
    for (const d of [-1, 1]) {
      c.beginPath();
      c.moveTo(d * lx, -2 * u);
      c.lineTo(d * (lx + lw), -2 * u);
      c.lineTo(d * (lx + lw - 6 * u), 2 * u);
      c.lineTo(d * lx, 2 * u);
      c.closePath();
      c.fill();
    }
    if (m.sub) {
      c.font = subF;
      c.lineWidth = 4 * u;
      c.strokeStyle = 'rgba(0, 8, 24, 0.85)';
      c.strokeText(m.sub, 0, size * 0.62 + 12 * u);
      c.fillStyle = '#ffe9a8';
      c.fillText(m.sub, 0, size * 0.62 + 12 * u);
    }
  }

  draw(c, dt, L, time) {
    const list = this.hud.messages;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      m.t += dt;
      if (m.t > m.dur) list.splice(i, 1);
    }
    let call = null, head = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      if (m.t < 0) continue;
      if (m.style === 'callout') call ??= m;
      else head ??= m;
      if (call && head) break;
    }
    // a callout banner (EVADED, CLIMAX…) takes the stage: the headline steps back instead of
    // being drawn through it
    if (head) this._drawHeadline(c, head, L, call ? 0.15 : 1);
    if (call) this._drawCallout(c, call, L, time);
  }

  _drawHeadline(c, m, L, dim = 1) {
    if (!m.sprite) this._build(m);
    const inA = Math.min(1, m.t * 4), outA = Math.min(1, (m.dur - m.t) * 3);
    const k = 1 + (1 - inA) * (1 - inA) * 0.35;
    const y = m.style === 'center' ? L.H * 0.5 : L.H * 0.24;
    c.globalAlpha = Math.max(0, Math.min(inA, outA)) * dim;
    m.sprite.drawScaled(c, L.W / 2, y, k);
    c.globalAlpha = 1;
  }

  _drawCallout(c, m, L, time) {
    if (!m.sprite) this._build(m);
    const sp = m.sprite;
    if (!sp.canvas) return;
    const { W, u } = L;
    const inT = 0.3, outT = 0.32;
    // warning plates (MISSILE, CAUTION…) own the centre column: go up into the headline slot
    const y0 = m.y != null ? L.H * m.y : this.hud.warnings?.columnBusy ? L.H * 0.2 : L.callout.y;
    const x0 = L.callout.x;
    let dx = 0, sx = 1, a = 1;
    if (m.t < inT) {
      const p = m.t / inT;
      dx = (1 - easeOutBack(p)) * W * 0.7;
      sx = 1 + (1 - p) * 0.5;
      a = Math.min(1, p * 3);
    } else if (m.t > m.dur - outT) {
      const p = (m.t - (m.dur - outT)) / outT;
      dx = -p * p * W * 0.6;
      sx = 1 + p * 0.4;
      a = 1 - p;
    }
    const pulse = 1 + 0.025 * Math.sin(time * 10);
    c.globalAlpha = Math.max(0, a);
    // speed streaks while moving
    if (dx !== 0) {
      const V = VARIANTS[m.variant] || VARIANTS.red;
      c.fillStyle = V.edge;
      for (let i = 0; i < 5; i++) {
        const yy = y0 + (i - 2) * 16 * u + Math.sin(i * 7.3) * 5 * u;
        const len = (140 + 90 * ((i * 37) % 5)) * u;
        c.fillRect(x0 + dx + (m.w || 200 * u) * 0.5 * Math.sign(dx) - (dx > 0 ? 0 : len), yy, len, 2 * u);
      }
    }
    c.drawImage(sp.canvas, x0 + dx - sp.ox * sx * pulse, y0 - sp.oy * pulse, sp.w * sx * pulse, sp.h * pulse);
    if (m.variant === 'gold') this._stars(c, x0 + dx, y0, (m.w || 300 * u) / 2 + 40 * u, u, time, m.t);
    c.globalAlpha = 1;
  }

  _stars(c, x, y, rx, u, time, t) {
    for (let i = 0; i < 6; i++) {
      const side = i < 3 ? -1 : 1;
      const j = i % 3;
      const px = x + side * (rx + j * 26 * u), py = y + (j - 1) * 24 * u + Math.sin(time * 3 + i) * 4 * u;
      const r = (9 + (j === 1 ? 6 : 0)) * u * (0.85 + 0.25 * Math.sin(time * 7 + i * 2)) * Math.min(1, t * 3);
      starPath(c, px, py, r, 0.42);
      c.fillStyle = '#ffe53b';
      c.strokeStyle = '#b4000e';
      c.lineWidth = 2.2 * u;
      c.stroke();
      c.fill();
    }
  }
}
