import { Sprite, GlyphFont, font, FAM_DISPLAY, FAM_UI, strokeFill, glowSprite, TAU } from './draw.js';
import { t } from '../i18n.js';

let _glow = null;
const GLOW = () => (_glow ??= glowSprite('rgba(90, 255, 120, 0.7)', 64));

/**
 * Emergency Order sign, bottom-centre: EO emblem + title, progress (done /
 * total) and time left. Glows green on clear; shatters into shards on fail.
 */
export class EoSign {
  constructor(hud) {
    this.hud = hud;
    this.sign = new Sprite();
    this.clear = new Sprite();
    this.fail = new Sprite();
    this.nums = new GlyphFont({ chars: '0123456789/.', fill: ['#fffbd6', '#ffe53b', '#ffae00'], outer: '#2c1a00', outerW: 0.14 });
    this.eo = null;
    this.total = 1;
    this.status = '';
    this.fx = 0;
    this.shards = [];
    this.L = null;
  }

  layout(L) {
    this.L = L;
    const u = L.u;
    this.nums.build(17 * u);
    for (const [sp, key, fill, stroke] of [[this.clear, 'hud.clear', '#8dff7a', '#063a12'], [this.fail, 'hud.failed', '#ff3b30', '#2a0000']]) {
      const c = sp.begin(200 * u, 40 * u, 100 * u, 20 * u);
      if (!c) continue;
      c.font = font(22 * u, 900, FAM_DISPLAY, 'italic');
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      strokeFill(c, t(key), 0, 0, fill, stroke, 6 * u);
    }
    if (this.eo) this._buildSign(this.eo);
  }

  _buildSign(eo) {
    const u = this.L.u;
    const w = 330 * u, h = 64 * u;
    const c = this.sign.begin(w, h, w / 2, h / 2);
    if (!c) return;
    // plate
    c.beginPath();
    c.moveTo(-120 * u, -22 * u);
    c.lineTo(150 * u, -22 * u);
    c.lineTo(138 * u, 22 * u);
    c.lineTo(-132 * u, 22 * u);
    c.closePath();
    c.fillStyle = 'rgba(30, 6, 4, 0.55)';
    c.fill();
    c.strokeStyle = 'rgba(255, 190, 90, 0.7)';
    c.lineWidth = 1.2 * u;
    c.stroke();
    // emblem: hexagon with "EO"
    const ex = -118 * u, r = 25 * u;
    c.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      c.lineTo(ex + Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    const g = c.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, '#ffd23b');
    g.addColorStop(0.5, '#ff6a1a');
    g.addColorStop(1, '#c8101c');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2.5 * u;
    c.stroke();
    c.font = font(15 * u, 900, FAM_DISPLAY, 'italic');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    strokeFill(c, t('hud.eo'), ex, 1 * u, '#ffffff', 'rgba(60, 0, 0, 0.9)', 3 * u);
    // title
    c.textAlign = 'left';
    c.font = font(14 * u, 700, FAM_UI);
    c.fillStyle = '#ffffff';
    c.fillText(eo.title || t('ui.eo'), -86 * u, -9 * u, 226 * u);
  }

  draw(c, s, dt, L, time) {
    const eo = s.eo;
    if (!eo) {
      this.eo = null;
      return;
    }
    const u = L.u;
    if (eo !== this.eo) {
      this.eo = eo;
      this.total = Math.max(1, eo.remaining | 0);
      this.status = '';
      this._buildSign(eo);
    }
    this.total = Math.max(this.total, eo.remaining | 0);
    if (eo.status !== this.status) {
      this.status = eo.status;
      this.fx = 0;
      if (eo.status === 'failed') this._shatter(u);
    }
    this.fx += dt;
    const x = L.eo.x, y = L.eo.y;
    if (eo.status === 'failed') {
      this._drawShards(c, x, y, u);
      const a = Math.min(1, this.fx * 4);
      c.globalAlpha = a;
      this.fail.drawScaled(c, x, y - 4 * u, 1 + Math.max(0, 0.3 - this.fx) * 1.5);
      c.globalAlpha = 1;
      return;
    }
    if (eo.status === 'cleared' && !this.hud.lowFx) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = Math.max(0.25, 1 - this.fx * 0.8) * (0.8 + 0.2 * Math.sin(time * 10));
      GLOW().drawScaled(c, x, y, (360 * u) / 64);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    this.sign.draw(c, x, y);
    const done = Math.max(0, this.total - Math.max(0, eo.remaining | 0));
    const px = x - 86 * u, py = y + 10 * u;
    const w = this.nums.number(c, eo.status === 'cleared' ? this.total : done, px, py, 1, 0);
    const sx = this.nums.text(c, '/', px + w, py, 0);
    this.nums.number(c, this.total, sx, py, 1, 0);
    if (eo.status === 'active' && eo.timeLimit > 0) {
      const left = Math.max(0, eo.timeLimit - eo.t);
      const tx = x + 128 * u;
      if (left > 5 || Math.sin(time * 14) > -0.3) drawSeconds(this.nums, c, left, tx, py);
    }
    if (eo.status === 'cleared') {
      // expanding ring + CLEAR
      const p = Math.min(1, this.fx / 0.6);
      if (p < 1) {
        c.globalAlpha = 1 - p;
        c.strokeStyle = '#8cff96';
        c.lineWidth = 4 * u * (1 - p) + 1;
        c.beginPath();
        c.arc(x - 118 * u, y, 25 * u + p * 90 * u, 0, TAU);
        c.stroke();
        c.globalAlpha = 1;
      }
      this.clear.drawScaled(c, x + 40 * u, y - 34 * u, 1 + Math.max(0, 0.25 - this.fx) * 2);
    }
  }

  _shatter(u) {
    const sh = this.shards;
    sh.length = 0;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
      const r = 200 * u;
      const mid = (a0 + a1) / 2;
      sh.push({
        a0,
        a1,
        r,
        vx: Math.cos(mid) * (80 + ((i * 53) % 60)) * u,
        vy: Math.sin(mid) * (50 + ((i * 29) % 40)) * u - 60 * u,
        spin: ((i % 2 ? 1 : -1) * (1 + (i % 3))) * 0.9
      });
    }
  }

  _drawShards(c, x, y, u) {
    const sp = this.sign;
    if (!sp.canvas) return;
    const tt = this.fx;
    const a = Math.max(0, 1 - tt / 1.1);
    if (a <= 0) return;
    const cx = x - 20 * u;
    for (const s of this.shards) {
      c.save();
      c.globalAlpha = a;
      c.translate(cx + s.vx * tt, y + s.vy * tt + 260 * u * tt * tt);
      c.rotate(s.spin * tt);
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(s.a0) * s.r, Math.sin(s.a0) * s.r);
      c.lineTo(Math.cos(s.a1) * s.r, Math.sin(s.a1) * s.r);
      c.closePath();
      c.clip();
      c.drawImage(sp.canvas, -(sp.ox - (x - cx)), -sp.oy);
      c.restore();
    }
    // red flash
    if (tt < 0.25) {
      c.globalAlpha = 0.5 * (1 - tt / 0.25);
      c.fillStyle = '#ff281e';
      c.fillRect(x - 170 * u, y - 30 * u, 340 * u, 60 * u);
      c.globalAlpha = 1;
    }
  }
}

/** "SS.d" right-aligned at x with a glyph font that has '.' (no string building). */
export function drawSeconds(g, c, sec, x, y, k = 1) {
  sec = Math.max(0, sec);
  const whole = Math.floor(sec);
  const tenth = Math.min(9, Math.floor((sec - whole) * 10));
  const dot = g.textWidth('.', k);
  g.number(c, tenth, x, y, 1, 1, k);
  g.text(c, '.', x - g.adv * k - dot, y, 0, k);
  g.number(c, whole, x - g.adv * k - dot, y, 2, 1, k);
}
