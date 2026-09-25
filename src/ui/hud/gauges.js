import { Sprite, GlyphFont, font, FAM_DISPLAY, slantRect, glowSprite, flareSprite, strokeFill } from './draw.js';
import { t } from '../i18n.js';

let _glow = null, _flare = null;
const GLOW = () => (_glow ??= glowSprite('rgba(255, 70, 200, 0.6)', 64));
const FLARE = () => (_flare ??= flareSprite('rgba(255, 120, 230, 0.9)', 96));

/**
 * Bottom-left gauges: missile icon row (ready / reloading), CLIMAX bar
 * (orange→magenta, glows and flares when READY, drains cyan while active) and
 * SPEED bar (blue, yellow notch at cruise speed).
 */
export class Gauges {
  constructor(hud) {
    this.hud = hud;
    this.frame = new Sprite();
    this.msl = new Sprite();
    this.mslSmall = new Sprite();
    this.mslEmpty = new Sprite();
    this.band = new Sprite();
    this.ready = new Sprite();
    this.count = new GlyphFont({ chars: '0123456789x', fill: ['#ffffff', '#f0f6ff', '#c6d6f0'], outer: '#0a1020', outerW: 0.16 });
    this.readyT = 0;
    this.wasReady = false;
    this.g = null;
  }

  _geo(L) {
    const u = L.u;
    const x0 = L.gauges.x, yb = L.gauges.y;
    const bx = x0 + 88 * u;
    const bw = (L.touch ? 250 : 300) * u;
    return { u, x0, yb, bx, bw, bh: 11 * u, ySpeed: yb - 12 * u, yClimax: yb - 38 * u, yMsl: yb - 62 * u };
  }

  layout(L) {
    const G = (this.g = this._geo(L));
    const { u, x0, bx, bw, bh } = G;
    this.fX = font(17 * u, 900, FAM_DISPLAY);
    this.count.build(15 * u);
    // static frame: label plates, bar tracks, outlines, end knobs
    const top = G.yClimax - 16 * u, bottom = G.yb + 4 * u;
    // sprite in screen coordinates (origin shifted so that y = top is row 0)
    const c = this.frame.begin(bx + bw + 40 * u, bottom - top, 0, -top);
    if (c) {
      const rows = [
        [G.yClimax, t('hud.climax'), ['#ffffff', '#c9f0ff'], '#0a2a6a'],
        [G.ySpeed, t('hud.speed'), ['#ffffff', '#fff1a6'], '#3a2a00']
      ];
      for (const [y, label, grad, ink] of rows) {
        const ph = 18 * u, pw = 82 * u;
        slantRect(c, x0, y - ph / 2, pw, ph, 6 * u);
        const g = c.createLinearGradient(0, y - ph / 2, 0, y + ph / 2);
        g.addColorStop(0, grad[0]);
        g.addColorStop(1, grad[1]);
        c.fillStyle = g;
        c.fill();
        c.strokeStyle = 'rgba(10, 30, 70, 0.95)';
        c.lineWidth = 2.2 * u;
        c.stroke();
        c.font = font(12.5 * u, 900, FAM_DISPLAY, 'italic');
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = ink;
        c.fillText(label, x0 + pw / 2 + 3 * u, y + 0.5 * u, pw - 12 * u);
        // track
        c.fillStyle = 'rgba(4, 12, 30, 0.62)';
        c.fillRect(bx, y - bh / 2, bw, bh);
        // frame: top rail from the plate, angled drop to the end knob
        c.beginPath();
        c.moveTo(x0 + pw + 4 * u, y - bh / 2 - 3 * u);
        c.lineTo(bx + bw + 4 * u, y - bh / 2 - 3 * u);
        c.lineTo(bx + bw + 12 * u, y);
        c.lineTo(bx + bw + 4 * u, y + bh / 2 + 3 * u);
        c.lineTo(bx - 2 * u, y + bh / 2 + 3 * u);
        c.strokeStyle = 'rgba(0, 16, 40, 0.5)';
        c.lineWidth = 3.5 * u;
        c.stroke();
        c.strokeStyle = 'rgba(235, 248, 255, 0.92)';
        c.lineWidth = 1.5 * u;
        c.stroke();
        c.beginPath();
        c.arc(bx + bw + 20 * u, y, 6 * u, 0, Math.PI * 2);
        const kg = c.createRadialGradient(bx + bw + 18 * u, y - 2 * u, 0, bx + bw + 20 * u, y, 6 * u);
        kg.addColorStop(0, '#ffffff');
        kg.addColorStop(1, '#6b7a96');
        c.fillStyle = kg;
        c.fill();
        c.strokeStyle = 'rgba(0, 16, 40, 0.8)';
        c.lineWidth = 1.5 * u;
        c.stroke();
      }
      // segment ticks on the climax track
      c.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      c.lineWidth = 1 * u;
      c.beginPath();
      for (let i = 1; i < 10; i++) {
        c.moveTo(bx + (bw * i) / 10, G.yClimax - bh / 2);
        c.lineTo(bx + (bw * i) / 10, G.yClimax + bh / 2);
      }
      c.stroke();
    }
    // fills (gradients live in main-canvas coordinates)
    const main = this.hud.ctx;
    this.gClimax = main.createLinearGradient(bx, 0, bx + bw, 0);
    this.gClimax.addColorStop(0, '#ffb22a');
    this.gClimax.addColorStop(0.55, '#ff4fa0');
    this.gClimax.addColorStop(1, '#e03cff');
    this.gActive = main.createLinearGradient(bx, 0, bx + bw, 0);
    this.gActive.addColorStop(0, '#2ea8ff');
    this.gActive.addColorStop(1, '#e8fdff');
    this.gSpeed = main.createLinearGradient(0, G.ySpeed - bh / 2, 0, G.ySpeed + bh / 2);
    this.gSpeed.addColorStop(0, '#8ad8ff');
    this.gSpeed.addColorStop(0.5, '#2f7bff');
    this.gSpeed.addColorStop(1, '#173fb8');
    // missile icons
    this._missile(this.msl, 1, u, true);
    this._missile(this.mslSmall, 0.62, u, true);
    this._missile(this.mslEmpty, 0.62, u, false);
    // highlight band for the READY shimmer
    const bc = this.band.begin(40 * u, bh, 20 * u, bh / 2);
    if (bc) {
      const g = bc.createLinearGradient(-20 * u, 0, 20 * u, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      bc.fillStyle = g;
      bc.fillRect(-20 * u, -bh / 2, 40 * u, bh);
    }
    const rc = this.ready.begin(90 * u, 22 * u, 0, 11 * u);
    if (rc) {
      rc.font = font(12 * u, 900, FAM_DISPLAY, 'italic');
      rc.textBaseline = 'middle';
      strokeFill(rc, t('hud.ready'), 2 * u, 0, '#ffffff', '#c0149a', 3.5 * u);
    }
  }

  _missile(sp, scale, u, lit) {
    const w = 10 * u * scale, h = 30 * u * scale;
    const c = sp.begin(w + 8 * u, h + 8 * u, w / 2 + 4 * u, h + 4 * u);
    if (!c) return;
    // origin at the bottom centre
    c.beginPath();
    c.moveTo(0, -h);
    c.quadraticCurveTo(w * 0.42, -h * 0.82, w * 0.3, -h * 0.66);
    c.lineTo(w * 0.3, -h * 0.2);
    c.lineTo(w * 0.62, -h * 0.02);
    c.lineTo(w * 0.62, 0);
    c.lineTo(-w * 0.62, 0);
    c.lineTo(-w * 0.62, -h * 0.02);
    c.lineTo(-w * 0.3, -h * 0.2);
    c.lineTo(-w * 0.3, -h * 0.66);
    c.quadraticCurveTo(-w * 0.42, -h * 0.82, 0, -h);
    c.closePath();
    c.strokeStyle = lit ? 'rgba(6, 12, 30, 0.95)' : 'rgba(6, 12, 30, 0.5)';
    c.lineWidth = 2.6 * u * Math.max(0.7, scale);
    c.stroke();
    if (lit) {
      const g = c.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, '#b9c6dc');
      g.addColorStop(0.45, '#ffffff');
      g.addColorStop(1, '#8fa0bd');
      c.fillStyle = g;
    } else c.fillStyle = 'rgba(160, 175, 200, 0.35)';
    c.fill();
    if (lit) {
      c.fillStyle = '#ff3b30';
      c.beginPath();
      c.moveTo(0, -h);
      c.quadraticCurveTo(w * 0.42, -h * 0.82, w * 0.3, -h * 0.72);
      c.lineTo(-w * 0.3, -h * 0.72);
      c.quadraticCurveTo(-w * 0.42, -h * 0.82, 0, -h);
      c.fill();
    }
  }

  draw(c, s, dt, L, time) {
    const G = this.g;
    if (!G) return;
    const { u, bx, bw, bh } = G;
    this.frame.draw(c, 0, 0);
    // --- missiles
    const max = Math.max(1, s.missilesMax | 0 || 8);
    const ready = Math.max(0, Math.min(max, s.missiles | 0));
    let x = G.x0 + 8 * u;
    const yb = G.yMsl + 12 * u;
    if (s.missilesInfinite) {
      this.msl.draw(c, x, yb);
      this._infinity(c, x + 32 * u, yb - 12 * u, u);
    } else if (max > 12) {
      // big magazines: a few icons plus the count
      const n = Math.min(ready, 4);
      for (let i = 0; i < n; i++) {
        this.msl.draw(c, x, yb);
        x += 14 * u;
      }
      if (n === 0) this.mslEmpty.draw(c, x, yb);
      this.count.text(c, 'x', x + 4 * u, yb - 11 * u, 0);
      this.count.number(c, ready, x + 4 * u + this.count.textWidth('x'), yb - 11 * u, 2, 0);
    } else {
      for (let i = 0; i < ready; i++) {
        this.msl.draw(c, x, yb);
        x += 14 * u;
      }
      for (let i = ready; i < max; i++) {
        this.mslEmpty.draw(c, x - 2 * u, yb);
        if (i === ready && s.missileReload > 0) {
          const sp = this.mslSmall;
          const f = Math.min(1, s.missileReload);
          const hh = sp.h * f;
          c.drawImage(sp.canvas, 0, sp.h - hh, sp.w, hh, x - 2 * u - sp.ox, yb - sp.oy + sp.h - hh, sp.w, hh);
        }
        x += 9 * u;
      }
    }
    // --- climax bar
    const v = Math.min(1, Math.max(0, s.climaxGauge || 0));
    const yc = G.yClimax;
    const readyNow = !!s.climaxReady && !s.climax;
    if (readyNow && !this.wasReady) this.readyT = 0;
    this.wasReady = readyNow;
    this.readyT += dt;
    if (readyNow && !this.hud.lowFx) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.35 + 0.2 * Math.sin(time * 7);
      const gl = GLOW();
      c.drawImage(gl.canvas, bx - 20 * u, yc - bh * 2.2, bw + 40 * u, bh * 4.4);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
    c.fillStyle = s.climax ? this.gActive : this.gClimax;
    c.fillRect(bx, yc - bh / 2, bw * v, bh);
    c.fillStyle = 'rgba(255, 255, 255, 0.28)';
    c.fillRect(bx, yc - bh / 2, bw * v, bh * 0.35);
    if (readyNow) {
      // shimmer band sweeping along the full bar + flare at the end
      c.save();
      c.beginPath();
      c.rect(bx, yc - bh / 2, bw, bh);
      c.clip();
      c.globalCompositeOperation = 'lighter';
      this.band.draw(c, bx + ((time * 1.4) % 1.3) * bw - 0.15 * bw, yc);
      c.restore();
      const fl = FLARE();
      const pulse = 0.8 + 0.25 * Math.sin(time * 9) + Math.max(0, 1 - this.readyT * 3) * 0.8;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.translate(bx + bw, yc);
      c.rotate(time * 0.8);
      fl.drawScaled(c, 0, 0, (pulse * 118 * u) / 96);
      c.rotate(Math.PI / 4);
      fl.drawScaled(c, 0, 0, (pulse * 60 * u) / 96);
      c.restore();
      if (Math.sin(time * 8) > -0.4) this.ready.draw(c, bx + bw - 64 * u, yc - 18 * u);
    } else if (s.climax && Math.sin(time * 14) > 0) {
      c.fillStyle = 'rgba(255, 255, 255, 0.35)';
      c.fillRect(bx, yc - bh / 2, bw * v, bh);
    }
    // --- speed bar
    const sp = Math.min(1, Math.max(0, s.speed01 || 0));
    const ys = G.ySpeed;
    c.fillStyle = this.gSpeed;
    c.fillRect(bx, ys - bh / 2, bw * sp, bh);
    if (s.throttle > 0) {
      c.fillStyle = 'rgba(255, 150, 40, 0.55)';
      c.fillRect(bx + bw * sp * 0.6, ys - bh / 2, bw * sp * 0.4, bh);
    }
    const mark = s.speedMark ?? 0.41;
    const mx = bx + bw * mark;
    c.fillStyle = '#ffe53b';
    c.fillRect(mx - 9 * u, ys - bh / 2, 18 * u, bh);
    c.fillStyle = 'rgba(40, 20, 0, 0.7)';
    c.fillRect(mx - 1 * u, ys - bh / 2, 2 * u, bh);
    // speed head
    c.fillStyle = '#ffffff';
    c.fillRect(bx + bw * sp - 1.5 * u, ys - bh / 2 - 2 * u, 3 * u, bh + 4 * u);
  }

  _infinity(c, x, y, u) {
    const r = 9 * u;
    x += 8 * u;
    c.font = this.fX;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    strokeFill(c, '×', x - 22 * u, y, '#ffffff', 'rgba(0,0,0,0.8)', 3 * u);
    c.beginPath();
    c.ellipse(x - r * 0.9, y, r, r * 0.7, 0, 0, Math.PI * 2);
    c.moveTo(x + r * 1.9, y);
    c.ellipse(x + r * 0.9, y, r, r * 0.7, 0, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    c.lineWidth = 5 * u;
    c.stroke();
    c.strokeStyle = '#d8ff3b';
    c.lineWidth = 2.6 * u;
    c.stroke();
  }
}
