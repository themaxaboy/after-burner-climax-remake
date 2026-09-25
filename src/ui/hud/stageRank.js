import { Sprite, GlyphFont, drawWingBadge, drawLabel, starPath } from './draw.js';
import { t } from '../i18n.js';

/** Top-right block: mirrored badge, STAGE label + number, rank stars (shining = rainbow sweep). */
export class StageRank {
  constructor(hud) {
    this.hud = hud;
    this.badge = new Sprite();
    this.star = new Sprite();
    this.starShine = new Sprite();
    this.digits = new GlyphFont({ fill: ['#fffbd6', '#ffe53b', '#ffae00'], outer: '#2c1a00', outerW: 0.13, stroke: '#fff4b0', strokeW: 0.02 });
  }

  layout(L) {
    const u = L.u;
    const w = 330 * u;
    const c = this.badge.begin(w, 110 * u, w, 0);
    if (c) {
      drawWingBadge(c, -110 * 0.86 * u - 4 * u, 6 * u, 0.86 * u, -1);
      drawLabel(c, t('hud.stage'), -104 * u, 34 * u, 15 * u, { align: 'right' });
    }
    this.digits.build(29 * u);
    const r = 8.5 * u;
    for (const [sp, shine] of [[this.star, false], [this.starShine, true]]) {
      const sc = sp.begin(r * 2 + 6 * u, r * 2 + 6 * u, r + 3 * u, r + 3 * u);
      if (!sc) continue;
      starPath(sc, 0, 0, r);
      const g = sc.createLinearGradient(0, -r, 0, r);
      g.addColorStop(0, shine ? '#ffffff' : '#fff6b0');
      g.addColorStop(0.5, shine ? '#b8f4ff' : '#ffd23b');
      g.addColorStop(1, shine ? '#3c9bff' : '#ff9800');
      sc.fillStyle = g;
      sc.strokeStyle = 'rgba(40, 20, 0, 0.9)';
      sc.lineWidth = 2.4 * u;
      sc.stroke();
      sc.fill();
    }
  }

  draw(c, s, dt, L, time) {
    const u = L.u;
    const xr = L.stage.x, y0 = L.stage.y;
    this.badge.draw(c, xr, y0);
    this.digits.number(c, s.stageNo || 1, xr - 108 * u, y0 + 58 * u, 2, 1);
    const n = Math.min(5, s.stars | 0);
    for (let i = 0; i < n; i++) {
      const x = xr - 116 * u - i * 19 * u, y = y0 + 86 * u;
      if (s.shining) {
        // a bright glint sweeps across the row
        const ph = (time * 1.6 - i * 0.12) % 1.6;
        const k = 1 + Math.max(0, 0.25 - Math.abs(ph - 0.3)) * 1.2;
        this.starShine.drawScaled(c, x, y, k);
      } else this.star.draw(c, x, y);
    }
  }
}
