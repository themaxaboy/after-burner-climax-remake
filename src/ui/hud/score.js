import { Sprite, GlyphFont, drawWingBadge, drawLabel, font, FAM_DISPLAY, strokeFill } from './draw.js';
import { comboTier } from './layout.js';
import { t } from '../i18n.js';

const COMBO_FILLS = [
  ['#effcff', '#62ccff', '#1b4fe0'],
  ['#fffbe0', '#ffe53b', '#ff9500'],
  ['#fff0f0', '#ff5040', '#c4000f']
];
const COMBO_BARS = ['#48b8ff', '#ffd23b', '#ff3b30'];

/** Top-left block: winged badge, SCORE label and digits, big italic combo with its timer bar. */
export class ScoreBlock {
  constructor(hud) {
    this.hud = hud;
    this.badge = new Sprite();
    this.comboLabel = new Sprite();
    this.digits = new GlyphFont({ fill: ['#fffbd6', '#ffe53b', '#ffae00'], outer: '#2c1a00', outerW: 0.13, stroke: '#fff4b0', strokeW: 0.02 });
    this.combo = COMBO_FILLS.map((fill) => new GlyphFont({ fill, stroke: '#ffffff', strokeW: 0.045, outer: '#050d26', outerW: 0.09, skew: 0.24 }));
    this.lastCombo = 0;
    this.shown = 0; // combo number currently on screen (kept while fading out)
    this.pop = 0;
    this.fade = 0;
  }

  layout(L) {
    const u = L.u;
    const c = this.badge.begin(330 * u, 110 * u, 0, 0);
    if (c) {
      drawWingBadge(c, 4 * u, 6 * u, 0.86 * u, 1);
      drawLabel(c, t('hud.score'), 116 * u, 34 * u, 15 * u);
    }
    this.digits.build(29 * u);
    for (const g of this.combo) g.build(58 * u);
    const cl = this.comboLabel.begin(120 * u, 30 * u, 0, 0);
    if (cl) {
      cl.font = font(13 * u, 900, FAM_DISPLAY, 'italic');
      cl.textBaseline = 'alphabetic';
      cl.textAlign = 'left';
      strokeFill(cl, t('hud.combo'), 4 * u, 20 * u, '#ffffff', 'rgba(5, 12, 36, 0.9)', 3.5 * u);
    }
  }

  draw(c, s, dt, L) {
    const u = L.u;
    const x0 = L.score.x, y0 = L.score.y;
    this.badge.draw(c, x0, y0);
    this.digits.number(c, s.score, x0 + 112 * u, y0 + 58 * u, 7, 0);
    // combo
    const n = s.combo | 0;
    if (n >= 2) {
      if (n > this.lastCombo) this.pop = 1;
      this.shown = n;
      this.fade = 1;
    } else if (this.fade > 0) {
      this.fade = Math.max(0, this.fade - dt * 2.5);
    }
    this.lastCombo = n;
    this.pop = Math.max(0, this.pop - dt * 4.5);
    if (this.fade <= 0 || this.shown < 2) return;
    const tier = comboTier(this.shown);
    const k = 1 + this.pop * this.pop * 0.45;
    const cx = x0 + 24 * u, cy = y0 + 126 * u;
    c.globalAlpha = this.fade;
    const w = this.combo[tier].number(c, this.shown, cx, cy, 1, 0, k);
    this.comboLabel.draw(c, cx + Math.max(w, 40 * u) + 2 * u, cy - 2 * u);
    // timer bar (frozen during Climax: shown cyan)
    const win = s.comboWindow || 4;
    const f = n >= 2 ? Math.min(1, Math.max(0, s.comboTimer / win)) : 0;
    const bw = 132 * u, bh = 4 * u, by = cy + 30 * u;
    c.fillStyle = 'rgba(4, 10, 28, 0.55)';
    c.fillRect(cx, by, bw, bh);
    c.fillStyle = s.climax ? '#9ff4ff' : COMBO_BARS[tier];
    c.fillRect(cx, by, bw * f, bh);
    c.globalAlpha = 1;
  }
}
