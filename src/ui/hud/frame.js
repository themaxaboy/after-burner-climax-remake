import { Sprite } from './draw.js';

/**
 * Thin light frame line along the top edge: outer segments curve down to the
 * screen sides, the centre span steps up through angled notches. Static,
 * cached in one sprite per resize.
 */
export class FrameLine {
  constructor(hud) {
    this.hud = hud;
    this.sprite = new Sprite();
  }

  layout(L) {
    const { W, u } = L;
    const h = 140 * u;
    const c = this.sprite.begin(W, h, 0, 0);
    if (!c) return;
    const cx = W / 2;
    const yOut = 38 * u, yIn = 15 * u, notch = 26 * u;
    const span = Math.min(330 * u, W * 0.26);
    const path = () => {
      c.beginPath();
      c.moveTo(-2, 124 * u);
      c.bezierCurveTo(60 * u, 70 * u, 150 * u, yOut + 4 * u, 290 * u, yOut);
      c.lineTo(cx - span - notch, yOut);
      c.lineTo(cx - span, yIn);
      c.lineTo(cx + span, yIn);
      c.lineTo(cx + span + notch, yOut);
      c.lineTo(W - 290 * u, yOut);
      c.bezierCurveTo(W - 150 * u, yOut + 4 * u, W - 60 * u, 70 * u, W + 2, 124 * u);
    };
    c.lineJoin = 'miter';
    // dark under-stroke keeps the line visible on bright skies
    path();
    c.strokeStyle = 'rgba(0, 18, 48, 0.28)';
    c.lineWidth = 4.5 * u;
    c.stroke();
    path();
    c.shadowColor = 'rgba(140, 220, 255, 0.9)';
    c.shadowBlur = 6 * u;
    c.strokeStyle = 'rgba(236, 248, 255, 0.9)';
    c.lineWidth = 1.8 * u;
    c.stroke();
    c.shadowBlur = 0;
    // notch accents: short parallel ticks and end caps
    c.strokeStyle = 'rgba(236, 248, 255, 0.75)';
    c.lineWidth = 1.2 * u;
    for (const d of [-1, 1]) {
      const x0 = cx + d * (span + notch);
      c.beginPath();
      c.moveTo(x0 + d * 10 * u, yOut + 6 * u);
      c.lineTo(x0 + d * 70 * u, yOut + 6 * u);
      c.stroke();
      c.beginPath();
      c.moveTo(cx + d * (span - 40 * u), yIn + 5 * u);
      c.lineTo(cx + d * (span - 4 * u), yIn + 5 * u);
      c.lineTo(cx + d * (span + notch * 0.72), yOut + 1 * u);
      c.stroke();
      // tick marks along the centre span
      for (let i = 1; i <= 3; i++) {
        const tx = cx + d * (span - 60 * u - i * 14 * u);
        c.beginPath();
        c.moveTo(tx, yIn + 3 * u);
        c.lineTo(tx - d * 4 * u, yIn + 8 * u);
        c.stroke();
      }
    }
  }

  draw(c) {
    this.sprite.draw(c, 0, 0);
  }
}
