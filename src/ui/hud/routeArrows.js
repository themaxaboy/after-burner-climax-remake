import { Sprite, font, FAM_DISPLAY, strokeFill, glowSprite } from './draw.js';
import { t } from '../i18n.js';

let _glow = null;
const GLOW = () => (_glow ??= glowSprite('rgba(255, 60, 200, 0.7)', 64));

const STYLES = {
  pink: { fill: ['#ffd0f2', '#ff5fd0', '#d4148c'], line: '#ffffff', outer: 'rgba(60, 0, 40, 0.9)' },
  grey: { fill: ['#f2f5fa', '#b9c1ce', '#79839a'], line: 'rgba(255,255,255,0.9)', outer: 'rgba(10, 16, 30, 0.8)' },
  white: { fill: ['#ffffff', '#ffffff', '#ffe6f8'], line: '#ffffff', outer: 'rgba(255, 90, 210, 0.9)' }
};

/**
 * Route select at the end of a fork stage (`s.routeSelect`): big ◀ / ▶
 * arrows with the route names; the side being steered to is pink and
 * pulsing, the other grey; on commit the chosen arrow flashes and zooms.
 */
export class RouteArrows {
  constructor(hud) {
    this.hud = hud;
    this.arrows = { pink: new Sprite(), grey: new Sprite(), white: new Sprite() };
    this.header = new Sprite();
    this.names = new Map();
    this.commit = 0;
    this.commitT = 0;
    this.openT = 0;
    this.L = null;
  }

  layout(L) {
    this.L = L;
    this.names.clear();
    const u = L.u;
    for (const key in this.arrows) this._arrow(this.arrows[key], STYLES[key], u);
    const c = this.header.begin(360 * u, 34 * u, 180 * u, 17 * u);
    if (c) {
      c.font = font(17 * u, 900, FAM_DISPLAY, 'italic');
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      strokeFill(c, t('hud.routeSelect'), 0, 0, '#ffffff', 'rgba(90, 0, 60, 0.9)', 5 * u);
    }
  }

  /** Arrow pointing left, centred on its body. */
  _arrow(sp, S, u) {
    const w = 230 * u, h = 124 * u;
    const c = sp.begin(w + 16 * u, h + 16 * u, (w + 16 * u) / 2, (h + 16 * u) / 2);
    if (!c) return;
    const hx = -w / 2, bx = -w / 2 + 88 * u, bh = 30 * u, hh = h / 2;
    const path = () => {
      c.beginPath();
      c.moveTo(hx, 0);
      c.lineTo(bx, -hh);
      c.lineTo(bx, -bh);
      c.lineTo(w / 2 - 8 * u, -bh);
      c.lineTo(w / 2, -bh + 8 * u);
      c.lineTo(w / 2, bh - 8 * u);
      c.lineTo(w / 2 - 8 * u, bh);
      c.lineTo(bx, bh);
      c.lineTo(bx, hh);
      c.closePath();
    };
    c.lineJoin = 'round';
    path();
    c.lineWidth = 10 * u;
    c.strokeStyle = S.outer;
    c.stroke();
    const g = c.createLinearGradient(0, -hh, 0, hh);
    S.fill.forEach((col, i) => g.addColorStop(i / (S.fill.length - 1), col));
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3.5 * u;
    c.strokeStyle = S.line;
    c.stroke();
    // gloss on the upper half
    c.save();
    path();
    c.clip();
    c.fillStyle = 'rgba(255, 255, 255, 0.3)';
    c.fillRect(-w / 2, -hh, w, hh * 0.9);
    c.restore();
    // speed notches in the tail
    c.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let i = 0; i < 3; i++) {
      const x = w / 2 - 22 * u - i * 16 * u;
      c.beginPath();
      c.moveTo(x, -bh + 8 * u);
      c.lineTo(x + 6 * u, -bh + 8 * u);
      c.lineTo(x + 6 * u, bh - 8 * u);
      c.lineTo(x, bh - 8 * u);
      c.closePath();
      c.fill();
    }
  }

  _name(route) {
    const key = route?.name || route?.id || '';
    let sp = this.names.get(key);
    if (sp) return sp;
    sp = new Sprite();
    this.names.set(key, sp);
    const u = this.L.u;
    const c = sp.begin(300 * u, 36 * u, 150 * u, 18 * u);
    if (c) {
      c.font = font(17 * u, 900, FAM_DISPLAY, 'italic');
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      strokeFill(c, key, 0, 0, '#ffffff', 'rgba(8, 14, 40, 0.92)', 5 * u);
    }
    return sp;
  }

  draw(c, s, dt, L, time) {
    const rs = s.routeSelect;
    if (!rs) {
      this.openT = 0;
      this.commit = 0;
      return;
    }
    const u = L.u;
    this.openT += dt;
    if (rs.commit && rs.commit !== this.commit) this.commitT = 0;
    this.commit = rs.commit || 0;
    this.commitT += dt;
    const open = Math.min(1, this.openT / 0.35);
    const y = L.route.y;
    // header + progress
    c.globalAlpha = open;
    this.header.draw(c, L.W / 2, L.H * 0.2);
    const pw = 240 * u, ph = 5 * u, px = L.W / 2 - pw / 2, py = L.H * 0.2 + 20 * u;
    c.fillStyle = 'rgba(10, 6, 30, 0.55)';
    c.fillRect(px, py, pw, ph);
    c.fillStyle = '#ff5fd0';
    c.fillRect(px, py, pw * Math.min(1, Math.max(0, rs.t || 0)), ph);
    for (const dir of [-1, 1]) {
      const route = dir < 0 ? rs.left : rs.right;
      if (!route) continue;
      const chosen = this.commit ? this.commit === dir : rs.side === dir;
      const x = (dir < 0 ? L.route.lx : L.route.rx) + (1 - open) * dir * 200 * u;
      let k = 1, a = open;
      let sp = chosen ? this.arrows.pink : this.arrows.grey;
      if (this.commit) {
        if (chosen) {
          const p = Math.min(1, this.commitT / 0.7);
          k = 1 + p * 0.35;
          a = open * (1 - Math.max(0, p - 0.5) * 2);
          if (Math.sin(this.commitT * 40) > 0 && p < 0.6) sp = this.arrows.white;
        } else a = open * Math.max(0, 1 - this.commitT * 3);
      } else if (chosen) {
        k = 1.06 + 0.05 * Math.sin(time * 9);
      } else {
        k = 0.92;
        a = open * 0.8;
      }
      if (a <= 0) continue;
      c.globalAlpha = a;
      if (chosen && !this.hud.lowFx) {
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = a * (0.45 + 0.15 * Math.sin(time * 9));
        GLOW().drawScaled(c, x, y, (300 * u * k) / 64);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = a;
      }
      c.save();
      c.translate(x, y);
      if (dir > 0) c.scale(-1, 1);
      if (chosen && !this.commit) {
        // ghost echo sliding outward
        const ph = (time * 1.8) % 1;
        c.globalAlpha = a * 0.35 * (1 - ph);
        sp.drawScaled(c, -ph * 40 * u, 0, k);
        c.globalAlpha = a;
      }
      sp.drawScaled(c, 0, 0, k);
      c.restore();
      this._name(route).draw(c, x, y + 78 * u * k);
    }
    c.globalAlpha = 1;
  }
}
