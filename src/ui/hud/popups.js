import { font, FAM_DISPLAY } from './draw.js';

/** Floating score popups (`hud.popups`: {x, y, text, t, color}), rise and fade. */
export class Popups {
  constructor(hud) {
    this.hud = hud;
    this.f = '';
    this.fBig = '';
  }

  layout(L) {
    this.f = font(13 * L.u, 900, FAM_DISPLAY, 'italic');
    this.fBig = font(16 * L.u, 900, FAM_DISPLAY, 'italic');
  }

  draw(c, dt, L) {
    const list = this.hud.popups;
    if (!list.length) return;
    const u = L.u;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.lineJoin = 'round';
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.t += dt;
      if (p.t > 1.1) {
        list.splice(i, 1);
        continue;
      }
      const a = 1 - Math.max(0, p.t - 0.6) / 0.5;
      const big = p.text.length > 7;
      c.font = big ? this.fBig : this.f;
      c.globalAlpha = a;
      const y = p.y - p.t * 38 * u - (1 - Math.min(1, p.t * 8)) * 6 * u;
      c.lineWidth = 3.5 * u;
      c.strokeStyle = 'rgba(20, 8, 0, 0.85)';
      c.strokeText(p.text, p.x, y);
      c.fillStyle = p.color;
      c.fillText(p.text, p.x, y);
    }
    c.globalAlpha = 1;
  }
}
