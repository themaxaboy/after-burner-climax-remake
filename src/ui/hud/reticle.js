import { TAU, GlyphFont, Sprite, font, FAM_DISPLAY, strokeFill, glowSprite } from './draw.js';
import { t } from '../i18n.js';

let _glow = null;
const GLOW = () => (_glow ??= glowSprite('rgba(40, 190, 255, 0.5)', 128));

const GREEN = '#6dff7c';
const RED = '#ff2b2b';
const CYAN = '#5fe3ff';

/**
 * Aiming reticle: a tiny green square bracket with a "+" (≈ reticleSize × H),
 * red flash on a new lock, lock-slot pips under it; in Climax a huge animated
 * lock circle (radius lockRadius × H/2) with the "ENEMIES n" readout.
 */
export class Reticle {
  constructor(hud) {
    this.hud = hud;
    this.climaxK = 0; // 0..1 open animation of the Climax circle
    this.wasClimax = false;
    this.burstT = 9; // time since Climax activation (ring burst)
    this.dash = [0, 0];
    this.dash2 = [0, 0];
    this.noDash = [];
    this.count = new GlyphFont({ fill: ['#ffffff', '#bff6ff', '#38c8ff'], outer: '#021a36', outerW: 0.13 });
    this.lockNum = new GlyphFont({ chars: '0123456789/', fill: ['#ffffff', '#fff3a0', '#ffd23b'], outer: '#1a0e00', outerW: 0.16 });
    this.enemiesLabel = new Sprite();
    this.lockedLabel = new Sprite();
  }

  layout(L) {
    const u = L.u;
    this.dash[0] = 26 * u;
    this.dash[1] = 12 * u;
    this.dash2[0] = 3 * u;
    this.dash2[1] = 9 * u;
    this.count.build(30 * u);
    this.lockNum.build(11 * u);
    for (const [sp, key, col] of [[this.enemiesLabel, 'hud.enemies', CYAN], [this.lockedLabel, 'hud.locked', '#ffe53b']]) {
      const c = sp.begin(140 * u, 20 * u, 0, 10 * u);
      if (!c) continue;
      c.font = font(key === 'hud.locked' ? 8.5 * u : 11 * u, 900, FAM_DISPLAY, 'italic');
      c.textBaseline = 'middle';
      strokeFill(c, t(key), 2 * u, 0, col, 'rgba(0, 12, 30, 0.9)', 3 * u);
    }
  }

  draw(c, s, dt, L, time) {
    const r = s.reticle;
    if (!r) return;
    const { W, H, u, k } = L;
    const x = (r.x * 0.5 + 0.5) * W;
    const y = (-r.y * 0.5 + 0.5) * H;
    const climax = !!s.climax;
    if (climax && !this.wasClimax) this.burstT = 0;
    this.wasClimax = climax;
    this.climaxK = climax ? Math.min(1, this.climaxK + dt * 4) : Math.max(0, this.climaxK - dt * 5);
    if (this.climaxK > 0) this._climaxCircle(c, s, x, y, L, time);
    if (this.burstT < 0.7) {
      // activation burst: expanding cyan rings
      this.burstT += dt;
      const R0 = Math.max(40 * u, (s.lockRadius || 0.45) * H * 0.5);
      c.strokeStyle = '#8ff0ff';
      for (let i = 0; i < 3; i++) {
        const p = this.burstT / 0.7 - i * 0.12;
        if (p <= 0 || p >= 1) continue;
        c.globalAlpha = (1 - p) * 0.9;
        c.lineWidth = (10 - i * 3) * u * (1 - p) + 1;
        c.beginPath();
        c.arc(x, y, R0 * (0.2 + p * 1.6), 0, TAU);
        c.stroke();
      }
      c.globalAlpha = 1;
    }

    // tiny bracket
    const flash = Math.min(1, s.newLock || 0);
    const side = Math.max(14 * u, (s.reticleSize || 0.032) * H) * (1 + flash * 0.35);
    const h = side / 2, arm = side * 0.32;
    const col = flash > 0.05 ? RED : climax ? CYAN : s.assistActive ? '#ffc05a' : GREEN;
    c.lineCap = 'square';
    for (let pass = 0; pass < 2; pass++) {
      c.beginPath();
      c.moveTo(x - h, y - h + arm); c.lineTo(x - h, y - h); c.lineTo(x - h + arm, y - h);
      c.moveTo(x + h - arm, y - h); c.lineTo(x + h, y - h); c.lineTo(x + h, y - h + arm);
      c.moveTo(x + h, y + h - arm); c.lineTo(x + h, y + h); c.lineTo(x + h - arm, y + h);
      c.moveTo(x - h + arm, y + h); c.lineTo(x - h, y + h); c.lineTo(x - h, y + h - arm);
      const p = side * 0.17;
      c.moveTo(x - p, y); c.lineTo(x + p, y);
      c.moveTo(x, y - p); c.lineTo(x, y + p);
      if (pass === 0) {
        c.strokeStyle = 'rgba(0, 16, 8, 0.5)';
        c.lineWidth = 4 * k;
      } else {
        c.strokeStyle = col;
        c.lineWidth = 2 * k;
      }
      c.stroke();
    }
    c.lineCap = 'round';

    // lock slots: a thin column beside the bracket (normal mode) — nothing is
    // drawn under the reticle, where targets usually are
    const cap = s.lockCap | 0, n = s.lockCount | 0;
    if (!climax && cap > 0 && cap <= 12) {
      const pw = 3.2 * u, ph = 2.4 * u, gap = 1.8 * u;
      const total = cap * ph + (cap - 1) * gap;
      const px = x + Math.max(h, 10 * u) + 7 * u;
      let py = y + total / 2 - ph;
      c.globalAlpha = n > 0 ? 0.9 : 0.5;
      for (let i = 0; i < cap; i++) {
        c.fillStyle = 'rgba(0, 10, 4, 0.45)';
        c.fillRect(px - 0.8 * u, py - 0.8 * u, pw + 1.6 * u, ph + 1.6 * u);
        c.fillStyle = i < n ? RED : 'rgba(170, 255, 190, 0.4)';
        c.fillRect(px, py, pw, ph);
        py -= ph + gap;
      }
      c.globalAlpha = 1;
    }
  }

  _climaxCircle(c, s, x, y, L, time) {
    const { H, u } = L;
    const e = this.climaxK;
    const ease = 1 - Math.pow(1 - e, 3);
    const R = Math.max(40 * u, (s.lockRadius || 0.45) * H * 0.5) * (0.35 + 0.65 * ease) * (1 + (1 - e) * 0.2);
    c.globalAlpha = e;
    if (!this.hud.lowFx) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = e * (0.18 + 0.06 * Math.sin(time * 6));
      GLOW().drawScaled(c, x, y, (R * 2.4) / 128);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = e;
    }
    // outer dashed ring rotating
    c.setLineDash(this.dash);
    c.lineDashOffset = -time * 60 * u;
    c.strokeStyle = 'rgba(0, 20, 50, 0.45)';
    c.lineWidth = 7 * u;
    c.beginPath();
    c.arc(x, y, R, 0, TAU);
    c.stroke();
    c.strokeStyle = CYAN;
    c.lineWidth = 3.5 * u;
    c.stroke();
    // inner tick ring counter-rotating
    c.setLineDash(this.dash2);
    c.lineDashOffset = time * 40 * u;
    c.strokeStyle = 'rgba(210, 250, 255, 0.85)';
    c.lineWidth = 5 * u;
    c.beginPath();
    c.arc(x, y, R * 0.9, 0, TAU);
    c.stroke();
    c.setLineDash(this.noDash);
    // thin full ring
    c.strokeStyle = 'rgba(95, 227, 255, 0.5)';
    c.lineWidth = 1.2 * u;
    c.beginPath();
    c.arc(x, y, R * 1.08, 0, TAU);
    c.stroke();
    // four inward pointers, breathing
    const br = R * (1.14 + 0.03 * Math.sin(time * 8));
    c.fillStyle = '#ffffff';
    c.strokeStyle = 'rgba(0, 20, 50, 0.7)';
    c.lineWidth = 2 * u;
    for (let i = 0; i < 4; i++) {
      const a = time * 0.8 + (i * TAU) / 4;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = x + ca * br, py = y + sa * br;
      const tw = 9 * u, tl = 14 * u;
      c.beginPath();
      c.moveTo(px - ca * tl * 0.2, py - sa * tl * 0.2);
      c.lineTo(px + ca * tl + -sa * tw, py + sa * tl + ca * tw);
      c.lineTo(px + ca * tl + sa * tw, py + sa * tl - ca * tw);
      c.closePath();
      c.stroke();
      c.fill();
    }
    // ENEMIES n (on screen) and LOCKS n
    const lx = x + R * 0.74, ly = y + R * 0.74 + 8 * u;
    this.enemiesLabel.draw(c, lx, ly);
    this.count.number(c, s.climaxOnScreen | 0, lx + 4 * u, ly + 24 * u, 2, 0);
    if (s.lockCount > 0) {
      this.lockedLabel.draw(c, x - R * 0.74 - 70 * u, y - R * 0.74 - 12 * u);
      this.count.number(c, s.lockCount | 0, x - R * 0.74 - 70 * u, y - R * 0.74 + 12 * u, 2, 0, 0.8);
    }
    c.globalAlpha = 1;
  }
}
