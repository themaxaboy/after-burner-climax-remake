import { Sprite, GlyphFont, font, FAM_DISPLAY, strokeFill } from './draw.js';
import { targetBoxSize } from './layout.js';
import { t } from '../i18n.js';

/**
 * Per-target markers: rotating red lock box (sized by distance), red ✕ for
 * targets already covered by missiles in flight, faint brackets on lock
 * candidates, "!" chevrons on rammers, TARGET ▼ on tagged (EO) targets and a
 * health bar on big targets.
 */
export class Targets {
  constructor(hud) {
    this.hud = hud;
    this.tag = new Sprite();
    this.multi = new GlyphFont({ chars: '0123456789x', fill: ['#ffffff', '#ffd0d0', '#ff5a5a'], outer: '#2a0000', outerW: 0.16 });
  }

  layout(L) {
    const u = L.u;
    const c = this.tag.begin(140 * u, 40 * u, 70 * u, 34 * u);
    if (c) {
      c.font = font(12 * u, 900, FAM_DISPLAY, 'italic');
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      strokeFill(c, t('hud.target'), 0, -14 * u, '#ff3030', '#ffffff', 3.2 * u);
      c.beginPath();
      c.moveTo(-7 * u, -10 * u);
      c.lineTo(7 * u, -10 * u);
      c.lineTo(0, -1 * u);
      c.closePath();
      c.lineWidth = 2.5 * u;
      c.strokeStyle = '#ffffff';
      c.stroke();
      c.fillStyle = '#ff3030';
      c.fill();
    }
    this.multi.build(12 * u);
  }

  draw(c, s, dt, L, time) {
    const list = s.targets;
    if (!list) return;
    const { W, H, u, k } = L;
    const lockCol = this.hud.colorblind ? '#ffd400' : '#ff2b2b';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.onScreen || e.dead || e.dying) continue;
      const x = (e.sx * 0.5 + 0.5) * W;
      const y = (-e.sy * 0.5 + 0.5) * H;
      const size = targetBoxSize((e.radius || 10) * (e.def?.visScale ?? 1), e.dist || 1000, H, u);
      const half = size / 2;
      // HUD-private animation state on the (pooled) enemy object
      if (e._hudId !== e.id) {
        e._hudId = e.id;
        e._hudLocks = 0;
        e._hudLockT = 9;
      }
      if (e.locks > e._hudLocks) e._hudLockT = 0;
      e._hudLocks = e.locks | 0;
      e._hudLockT += dt;
      let top = y - half;
      if (e.locks > 0) {
        const grow = Math.max(0, 1 - e._hudLockT * 6);
        const d = half * (1 + grow * 0.9) + 3 * u;
        const a = time * 2.4 + (e.id % 7);
        const ca = Math.cos(a) * d, sa = Math.sin(a) * d;
        c.beginPath();
        c.moveTo(x + ca - sa, y + sa + ca);
        c.lineTo(x - ca - sa, y - sa + ca);
        c.lineTo(x - ca + sa, y - sa - ca);
        c.lineTo(x + ca + sa, y + sa - ca);
        c.closePath();
        c.strokeStyle = 'rgba(40, 0, 0, 0.55)';
        c.lineWidth = 4.5 * k;
        c.stroke();
        c.strokeStyle = lockCol;
        c.lineWidth = 2.4 * k;
        c.stroke();
        // inner fixed corner ticks
        const q = half * 0.55;
        c.beginPath();
        c.moveTo(x - q, y - q + 4 * u); c.lineTo(x - q, y - q); c.lineTo(x - q + 4 * u, y - q);
        c.moveTo(x + q, y + q - 4 * u); c.lineTo(x + q, y + q); c.lineTo(x + q - 4 * u, y + q);
        c.lineWidth = 1.6 * k;
        c.stroke();
        if (e.locks > 1) {
          const tx = this.multi.text(c, 'x', x + d + 4 * u, y - d, 0);
          this.multi.number(c, e.locks, tx, y - d, 1, 0);
        }
        top = y - d * 1.42;
      } else if (e.lockable !== false && !e.xMark) {
        // candidate: faint corner brackets
        const d = half + 2 * u, l = Math.max(4 * u, d * 0.4);
        c.beginPath();
        c.moveTo(x - d, y - d + l); c.lineTo(x - d, y - d); c.lineTo(x - d + l, y - d);
        c.moveTo(x + d - l, y - d); c.lineTo(x + d, y - d); c.lineTo(x + d, y - d + l);
        c.moveTo(x + d, y + d - l); c.lineTo(x + d, y + d); c.lineTo(x + d - l, y + d);
        c.moveTo(x - d + l, y + d); c.lineTo(x - d, y + d); c.lineTo(x - d, y + d - l);
        c.strokeStyle = e.tag ? 'rgba(255, 90, 80, 0.75)' : 'rgba(190, 255, 205, 0.5)';
        c.lineWidth = 1.3 * k;
        c.stroke();
        top = y - d;
      }
      if (e.xMark) {
        // red ✕ above the target: a missile is already on its way
        const cx = x, cy = top - 12 * u, r = 6 * u;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r);
        c.moveTo(cx + r, cy - r); c.lineTo(cx - r, cy + r);
        c.strokeStyle = 'rgba(40, 0, 0, 0.7)';
        c.lineWidth = 5.5 * u;
        c.stroke();
        c.strokeStyle = lockCol;
        c.lineWidth = 3 * u;
        c.stroke();
        top = cy - r;
      }
      if (e.rammer) this._rammer(c, x, y, half, u, time);
      if (e.tag) {
        const bob = Math.sin(time * 6) * 2.5 * u;
        this.tag.draw(c, x, top - 4 * u + bob);
      }
      if (e.def && e.def.big) {
        const w = Math.max(56 * u, size * 1.1), h = 5 * u;
        const bx = x - w / 2, by = y + half + 10 * u;
        const f = e.maxHp > 0 ? Math.min(1, Math.max(0, e.hp / e.maxHp)) : 1;
        c.fillStyle = 'rgba(0, 0, 0, 0.55)';
        c.fillRect(bx - 1.5 * u, by - 1.5 * u, w + 3 * u, h + 3 * u);
        c.fillStyle = f > 0.5 ? '#ffd23b' : f > 0.25 ? '#ff8a2a' : '#ff2b2b';
        c.fillRect(bx, by, w * f, h);
        c.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        c.lineWidth = 1 * u;
        c.strokeRect(bx - 1.5 * u, by - 1.5 * u, w + 3 * u, h + 3 * u);
      }
    }
  }

  /** Rammer warning: blinking inward chevrons and a "!" triangle. */
  _rammer(c, x, y, half, u, time) {
    const on = Math.sin(time * 16) > -0.3;
    if (!on) return;
    const slide = ((time * 3) % 1) * 5 * u;
    c.fillStyle = '#ff2b2b';
    c.strokeStyle = 'rgba(40, 0, 0, 0.8)';
    c.lineWidth = 1.5 * u;
    for (const dir of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        const cx = x + dir * (half + 16 * u + j * 8 * u - slide);
        c.beginPath();
        c.moveTo(cx + dir * 4 * u, y - 7 * u);
        c.lineTo(cx - dir * 3 * u, y);
        c.lineTo(cx + dir * 4 * u, y + 7 * u);
        c.lineTo(cx + dir * 1 * u, y);
        c.closePath();
        c.stroke();
        c.fill();
      }
    }
    const ty = y + half + 6 * u;
    c.beginPath();
    c.moveTo(x, ty);
    c.lineTo(x + 9 * u, ty + 15 * u);
    c.lineTo(x - 9 * u, ty + 15 * u);
    c.closePath();
    c.fillStyle = '#ff2b2b';
    c.stroke();
    c.fill();
    c.fillStyle = '#ffffff';
    c.fillRect(x - 1.2 * u, ty + 4.5 * u, 2.4 * u, 6 * u);
    c.fillRect(x - 1.2 * u, ty + 11.5 * u, 2.4 * u, 2 * u);
  }
}
