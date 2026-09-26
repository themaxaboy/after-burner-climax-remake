import { Sprite, GlyphFont, font, FAM_DISPLAY, strokeFill } from './draw.js';
import { MARK, enemyHalfExtent, silhouettePx, markerGeometry } from './layout.js';
import { t } from '../i18n.js';

const FLASH = 0.14; // s, single flash when a lock lands
const POP = 0.15; // s, "pop" when a target comes into lock range

/**
 * Per-target markers, kept small so they never paint over the aircraft:
 * - locked: 4 static corner ticks outside the projected silhouette (one short
 *   flash on lock), "x2" lock count at the lower right;
 * - red ✕ above-right of the box for targets already covered by missiles;
 * - lock candidates in lock range: faint corner dots (a brief pop on entering
 *   range); out of range, big / EO targets only get a tiny chevron;
 * - "!" chevrons on rammers, a small TARGET ▼ on tagged (EO) targets and a
 *   thin health bar under big targets.
 * `e.inLockRange === false` marks targets beyond lock range (undefined = in range).
 */
export class Targets {
  constructor(hud) {
    this.hud = hud;
    this.tag = new Sprite();
    this.multi = new GlyphFont({ chars: '0123456789x', fill: ['#ffffff', '#ffd0d0', '#ff5a5a'], outer: '#2a0000', outerW: 0.16 });
    this._g = {};
  }

  layout(L) {
    const u = L.u;
    const c = this.tag.begin(100 * u, 28 * u, 50 * u, 24 * u);
    if (c) {
      c.font = font(9 * u, 900, FAM_DISPLAY, 'italic');
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      strokeFill(c, t('hud.target'), 0, -8 * u, '#ff3030', '#ffffff', 2.4 * u);
      c.beginPath();
      c.moveTo(-4 * u, -6 * u);
      c.lineTo(4 * u, -6 * u);
      c.lineTo(0, -1 * u);
      c.closePath();
      c.lineWidth = 1.6 * u;
      c.strokeStyle = '#ffffff';
      c.stroke();
      c.fillStyle = '#ff3030';
      c.fill();
    }
    this.multi.build(9 * u);
  }

  draw(c, s, dt, L, time) {
    const list = s.targets;
    if (!list) return;
    const { W, H, u } = L;
    const cb = this.hud.colorblind;
    const lockCol = cb ? '#ffd400' : '#ff2b2b';
    const g = this._g;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.onScreen || e.dead || e.dying) continue;
      const x = (e.sx * 0.5 + 0.5) * W;
      const y = (-e.sy * 0.5 + 0.5) * H;
      const sil = silhouettePx(enemyHalfExtent(e, e.visMul ?? 1), e.dist || 1000, H);
      markerGeometry(x, y, sil, u, H, g);
      const inRange = e.inLockRange !== false;
      // HUD-private animation state on the (pooled) enemy object
      if (e._hudId !== e.id) {
        e._hudId = e.id;
        e._hudLocks = 0;
        e._hudLockT = 9;
        e._hudIn = inRange;
        e._hudPopT = 9;
      }
      if (e.locks > e._hudLocks) e._hudLockT = 0;
      e._hudLocks = e.locks | 0;
      e._hudLockT += dt;
      if (inRange && !e._hudIn) e._hudPopT = 0;
      e._hudIn = inRange;
      e._hudPopT += dt;
      let top = g.top;
      if (e.locks > 0) {
        this._ticks(c, x, y, g, u, lockCol, e._hudLockT);
        if (e.locks > 1) {
          const ly = y + g.half - 3 * u;
          const tx = this.multi.text(c, 'x', x + g.half + 4 * u, ly, 0);
          this.multi.number(c, e.locks, tx, ly, 1, 0);
        }
      } else if (e.lockable !== false && !e.xMark && inRange) {
        this._dots(c, x, y, g, u, e.tag ? 'rgba(255, 110, 90, 1)' : 'rgba(205, 255, 215, 1)', e._hudPopT);
      } else if (!inRange && !e.xMark && (e.tag || e.def?.big)) {
        // out of lock range: a tiny chevron above the silhouette, nothing on it
        const cy = y - sil / 2 - MARK.gap * u - 1 * u, r = MARK.chevron * u;
        c.globalAlpha = 0.7;
        c.beginPath();
        c.moveTo(x - r, cy - r);
        c.lineTo(x, cy);
        c.lineTo(x + r, cy - r);
        c.strokeStyle = e.tag ? '#ff5a4a' : '#e8fff0';
        c.lineWidth = 1.2 * u;
        c.stroke();
        c.globalAlpha = 1;
        top = Math.min(top, cy - r);
      }
      if (e.xMark) this._xMark(c, g, u, lockCol);
      if (e.rammer) this._rammer(c, x, y, g.half, u, time);
      if (e.tag) {
        const bob = Math.sin(time * 6) * 1.5 * u;
        this.tag.draw(c, x, top - 3 * u + bob);
      }
      if (e.def && e.def.big) {
        const w = Math.min(80 * u, Math.max(36 * u, g.side)), h = 3 * u;
        const bx = x - w / 2, by = g.barY;
        const f = e.maxHp > 0 ? Math.min(1, Math.max(0, e.hp / e.maxHp)) : 1;
        c.globalAlpha = 0.85;
        c.fillStyle = 'rgba(0, 0, 0, 0.5)';
        c.fillRect(bx - 1 * u, by - 1 * u, w + 2 * u, h + 2 * u);
        c.fillStyle = f > 0.5 ? '#ffd23b' : f > 0.25 ? '#ff8a2a' : '#ff2b2b';
        c.fillRect(bx, by, w * f, h);
        c.globalAlpha = 1;
      }
    }
  }

  /** Locked: 4 static corner ticks; the first FLASH s after a lock they flash white and settle in. */
  _ticks(c, x, y, g, u, col, lockT) {
    const f = lockT < FLASH ? 1 - lockT / FLASH : 0;
    const d = g.half + f * 3 * u, a = g.arm;
    c.beginPath();
    c.moveTo(x - d, y - d + a); c.lineTo(x - d, y - d); c.lineTo(x - d + a, y - d);
    c.moveTo(x + d - a, y - d); c.lineTo(x + d, y - d); c.lineTo(x + d, y - d + a);
    c.moveTo(x + d, y + d - a); c.lineTo(x + d, y + d); c.lineTo(x + d - a, y + d);
    c.moveTo(x - d + a, y + d); c.lineTo(x - d, y + d); c.lineTo(x - d, y + d - a);
    // faint dark halo keeps the thin ticks readable on a bright sky
    c.globalAlpha = 0.3;
    c.strokeStyle = '#200000';
    c.lineWidth = g.line + 1.5 * u;
    c.stroke();
    c.globalAlpha = 0.85 + 0.15 * f;
    c.strokeStyle = f > 0.5 ? '#ffffff' : col;
    c.lineWidth = g.line;
    c.stroke();
    c.globalAlpha = 1;
  }

  /** Lock candidate in range: faint corner dots; a quick pop (spread + brighter) when it comes into range. */
  _dots(c, x, y, g, u, col, popT) {
    const p = popT < POP ? 1 - popT / POP : 0;
    const d = g.half + p * 4 * u, r = (1.1 + p * 0.6) * u;
    c.globalAlpha = 0.5 + 0.45 * p;
    c.fillStyle = col;
    c.fillRect(x - d - r, y - d - r, r * 2, r * 2);
    c.fillRect(x + d - r, y - d - r, r * 2, r * 2);
    c.fillRect(x + d - r, y + d - r, r * 2, r * 2);
    c.fillRect(x - d - r, y + d - r, r * 2, r * 2);
    c.globalAlpha = 1;
  }

  /** Red ✕ above-right of the box: a missile is already on its way. */
  _xMark(c, g, u, col) {
    const cx = g.xx, cy = g.xy, r = g.xr;
    c.beginPath();
    c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r);
    c.moveTo(cx + r, cy - r); c.lineTo(cx - r, cy + r);
    c.globalAlpha = 0.35;
    c.strokeStyle = '#200000';
    c.lineWidth = 3.2 * u;
    c.stroke();
    c.globalAlpha = 0.8;
    c.strokeStyle = col;
    c.lineWidth = 1.8 * u;
    c.stroke();
    c.globalAlpha = 1;
  }

  /** Rammer warning: blinking inward chevrons and a "!" triangle, outside the box. */
  _rammer(c, x, y, half, u, time) {
    const on = Math.sin(time * 16) > -0.3;
    if (!on) return;
    const slide = ((time * 3) % 1) * 4 * u;
    c.fillStyle = '#ff2b2b';
    c.strokeStyle = 'rgba(40, 0, 0, 0.8)';
    c.lineWidth = 1.2 * u;
    for (const dir of [-1, 1]) {
      for (let j = 0; j < 2; j++) {
        const cx = x + dir * (half + 12 * u + j * 6 * u - slide);
        c.beginPath();
        c.moveTo(cx + dir * 3 * u, y - 5 * u);
        c.lineTo(cx - dir * 2 * u, y);
        c.lineTo(cx + dir * 3 * u, y + 5 * u);
        c.lineTo(cx + dir * 1 * u, y);
        c.closePath();
        c.stroke();
        c.fill();
      }
    }
    const ty = y + half + 5 * u;
    c.beginPath();
    c.moveTo(x, ty);
    c.lineTo(x + 6 * u, ty + 10 * u);
    c.lineTo(x - 6 * u, ty + 10 * u);
    c.closePath();
    c.fillStyle = '#ff2b2b';
    c.stroke();
    c.fill();
    c.fillStyle = '#ffffff';
    c.fillRect(x - 0.9 * u, ty + 3 * u, 1.8 * u, 4 * u);
    c.fillRect(x - 0.9 * u, ty + 7.8 * u, 1.8 * u, 1.4 * u);
  }
}
