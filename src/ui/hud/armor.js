import { Sprite, GlyphFont, font, FAM_DISPLAY, strokeFill, slantRect, jetIconPath } from './draw.js';
import { armorColor } from './layout.js';
import { t } from '../i18n.js';

// the C opens to the right: the arc runs clockwise from lower-right to upper-right
const A0 = Math.PI * 0.3;
const SPAN = Math.PI * 2 - Math.PI * 0.6;
const RGB = [0, 0, 0];

/**
 * Armor: big C-shaped gauge (green → yellow → red), percentage, ARMOR plate,
 * jet name and remaining lives. Flashes on damage, blinks when low.
 */
export class Armor {
  constructor(hud) {
    this.hud = hud;
    this.back = new Sprite();
    this.name = new Sprite();
    this.pct = new GlyphFont({ chars: '0123456789%', fill: ['#ffffff', '#fff7c8', '#ffd23b'], outer: '#1a1000', outerW: 0.13 });
    this.lives = new GlyphFont({ chars: '0123456789x', fill: ['#ffffff', '#f0f6ff', '#c6d6f0'], outer: '#0a1020', outerW: 0.16 });
    this.jetName = null;
    this.shown = 100;
    this.flash = 0;
    this.lastArmor = 100;
    this.colors = [];
    for (let i = 0; i <= 20; i++) {
      armorColor(i / 20, RGB);
      this.colors.push(`rgb(${RGB[0]},${RGB[1]},${RGB[2]})`);
    }
  }

  layout(L) {
    const u = L.u;
    const { x, y, r } = L.armor;
    const s = r / (60 * u); // compact scale
    const th = 14 * u * s;
    const c = this.back.begin(r * 2 + 150 * u * s, r * 2 + 40 * u, r + 20 * u, r + 20 * u);
    if (c) {
      // track
      c.lineCap = 'butt';
      c.beginPath();
      c.arc(0, 0, r, A0, A0 + SPAN);
      c.strokeStyle = 'rgba(0, 14, 30, 0.6)';
      c.lineWidth = th + 6 * u * s;
      c.stroke();
      c.strokeStyle = 'rgba(4, 16, 34, 0.55)';
      c.lineWidth = th;
      c.stroke();
      // outlines
      c.strokeStyle = 'rgba(240, 250, 255, 0.9)';
      c.lineWidth = 1.5 * u;
      c.beginPath();
      c.arc(0, 0, r + th / 2 + 2 * u, A0 - 0.02, A0 + SPAN + 0.02);
      c.stroke();
      c.beginPath();
      c.arc(0, 0, r - th / 2 - 2 * u, A0, A0 + SPAN);
      c.stroke();
      // tick marks every 10 %
      c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      c.lineWidth = 1 * u;
      c.beginPath();
      for (let i = 1; i < 10; i++) {
        const a = A0 + (SPAN * i) / 10;
        c.moveTo(Math.cos(a) * (r - th / 2), Math.sin(a) * (r - th / 2));
        c.lineTo(Math.cos(a) * (r + th / 2), Math.sin(a) * (r + th / 2));
      }
      c.stroke();
      // ARMOR plate across the C's opening
      const pw = 74 * u * s, ph = 18 * u * s;
      const px = r * 0.08, py = r * 0.3;
      slantRect(c, px, py, pw, ph, 5 * u * s);
      c.fillStyle = '#ffffff';
      c.fill();
      c.strokeStyle = '#d0101c';
      c.lineWidth = 2.2 * u * s;
      c.stroke();
      c.font = font(12 * u * s, 900, FAM_DISPLAY, 'italic');
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#d0101c';
      c.fillText(t('hud.armor'), px + pw / 2 + 2.5 * u * s, py + ph / 2 + 0.5 * u, pw - 8 * u);
    }
    this.pct.build(24 * u * s);
    this.lives.build(13 * u * s);
    this.jetName = null; // rebuild the name sprite on next draw
  }

  _buildName(L, name) {
    this.jetName = name;
    const u = L.u, s = L.armor.r / (60 * u);
    const w = 300 * u * s, h = 60 * u * s;
    const c = this.name.begin(w, h, w, h * 0.5);
    if (!c) return;
    // name comes as "F-15E STRIKE EAGLE" → code + title-cased model name
    const sp = name.indexOf(' ');
    const code = sp > 0 ? name.slice(0, sp) : '';
    const model = (sp > 0 ? name.slice(sp + 1) : name).toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.font = font(10 * u * s, 900, FAM_DISPLAY, 'italic');
    strokeFill(c, code, -4 * u, -2 * u * s, '#e8101c', '#ffffff', 3 * u * s);
    c.font = font(17 * u * s, 900, "Rajdhani, 'Noto Sans Thai', sans-serif", 'italic');
    strokeFill(c, model, -2 * u, 16 * u * s, '#e8101c', '#ffffff', 4 * u * s);
    // swoosh underline toward the gauge
    c.beginPath();
    c.moveTo(-w + 20 * u, 22 * u * s);
    c.lineTo(0, 22 * u * s);
    c.lineTo(10 * u, 14 * u * s);
    c.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    c.lineWidth = 1.6 * u;
    c.stroke();
  }

  draw(c, s, dt, L, time) {
    const u = L.u;
    const { x, y, r } = L.armor;
    const sc = r / (60 * u);
    const th = 14 * u * sc;
    const armor = Math.max(0, Math.min(100, s.armor ?? 100));
    if (armor < this.lastArmor - 0.01) this.flash = 1;
    this.lastArmor = armor;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.shown += (armor - this.shown) * Math.min(1, dt * 10);
    const v = this.shown / 100;
    let ox = 0, oy = 0;
    if (this.flash > 0) {
      ox = Math.sin(time * 90) * 3 * u * this.flash;
      oy = Math.cos(time * 77) * 2 * u * this.flash;
    }
    const gx = x + ox, gy = y + oy;
    this.back.draw(c, gx, gy);
    // fill arc
    const low = v < 0.3;
    const blink = low && Math.sin(time * 12) < 0;
    const col = this.flash > 0.5 ? '#ffffff' : blink ? '#ff8a70' : this.colors[Math.round(v * 20)];
    c.lineCap = 'butt';
    c.beginPath();
    c.arc(gx, gy, r, A0, A0 + SPAN * Math.max(0.001, v));
    c.strokeStyle = col;
    c.lineWidth = th;
    c.stroke();
    c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    c.lineWidth = th * 0.3;
    c.beginPath();
    c.arc(gx, gy, r + th * 0.22, A0, A0 + SPAN * Math.max(0.001, v));
    c.stroke();
    c.lineCap = 'round';
    // percentage
    const pw = this.pct.numberWidth(Math.ceil(armor), 1);
    const pctW = this.pct.textWidth('%', 0.62);
    const tx = gx + r * 0.2 - (pw + pctW) / 2;
    this.pct.number(c, Math.ceil(armor), tx, gy - r * 0.08, 1, 0);
    this.pct.text(c, '%', tx + pw, gy - r * 0.02, 0, 0.62);
    // jet name + lives
    const name = s.jetName || '';
    if (name !== this.jetName) this._buildName(L, name);
    const nx = gx - r - 14 * u * sc, ny = gy + r * 0.5;
    const compact = L.armor.compact;
    if (name && !compact) this.name.draw(c, nx, ny);
    const lives = Math.max(0, s.lives | 0);
    const lx = compact ? gx - r - 44 * u : nx - 44 * u * sc, ly = compact ? gy : ny - 30 * u * sc;
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(6, 12, 30, 0.9)';
    c.lineWidth = 2 * u;
    jetIconPath(c, lx, ly, 8 * u * sc);
    c.stroke();
    c.fill();
    const ex = this.lives.text(c, 'x', lx + 11 * u * sc, ly + 1 * u, 0);
    this.lives.number(c, lives, ex + 1 * u, ly + 1 * u, 1, 0);
  }
}
