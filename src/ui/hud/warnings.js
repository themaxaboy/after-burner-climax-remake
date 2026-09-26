import { Sprite, GlyphFont, font, FAM_DISPLAY, strokeFill, slantRect } from './draw.js';
import { edgePoint } from './layout.js';
import { t, hasString } from '../i18n.js';
import { drawSeconds } from './eoSign.js';

const _edge = { x: 0, y: 0, a: 0 };

/**
 * Warnings: incoming missile (centre plate + arrow on the screen edge toward
 * it; red when `strong`), CAUTION / PULL UP, ENEMY BEHIND, radar warnings,
 * and the stage timer (`s.timer {label, value}`).
 */
export class Warnings {
  constructor(hud) {
    this.hud = hud;
    this.plates = new Map(); // key → Sprite (text plates, built on first use)
    this.radarPlates = new Map(); // radar text → Sprite
    this.timerLabels = new Map(); // timer label → Sprite
    this.arrowRed = new Sprite();
    this.arrowOrange = new Sprite();
    this.clock = new GlyphFont({ chars: '0123456789:.', fill: ['#ffffff', '#fff3c8', '#ffd23b'], outer: '#1a1000', outerW: 0.13 });
    this.clockRed = new GlyphFont({ chars: '0123456789:.', fill: ['#ffffff', '#ffc0b8', '#ff3b30'], outer: '#2a0000', outerW: 0.13 });
    this.L = null;
    this._warnPh = 0; // MISSILE blink phase (rad) since the warning came on
  }

  layout(L) {
    this.L = L;
    this.plates.clear();
    this.radarPlates.clear();
    this.timerLabels.clear();
    const u = L.u;
    for (const [sp, col] of [[this.arrowRed, '#ff2b2b'], [this.arrowOrange, '#ff9a2a']]) {
      const c = sp.begin(70 * u, 60 * u, 50 * u, 30 * u);
      if (!c) continue;
      c.beginPath();
      c.moveTo(16 * u, 0);
      c.lineTo(-18 * u, -22 * u);
      c.lineTo(-10 * u, 0);
      c.lineTo(-18 * u, 22 * u);
      c.closePath();
      c.lineWidth = 5 * u;
      c.strokeStyle = 'rgba(30, 0, 0, 0.85)';
      c.stroke();
      c.fillStyle = col;
      c.fill();
      c.lineWidth = 1.6 * u;
      c.strokeStyle = '#ffffff';
      c.stroke();
      c.beginPath();
      c.moveTo(-26 * u, -12 * u);
      c.lineTo(-38 * u, -20 * u);
      c.moveTo(-26 * u, 12 * u);
      c.lineTo(-38 * u, 20 * u);
      c.strokeStyle = col;
      c.lineWidth = 3 * u;
      c.stroke();
    }
    this.clock.build(26 * u);
    this.clockRed.build(26 * u);
  }

  /** Text plate sprite (cached per key/text and style). */
  _plate(key, text, style, map = this.plates) {
    let sp = map.get(key);
    if (sp) return sp;
    if (map.size > 16) map.clear();
    sp = new Sprite();
    map.set(key, sp);
    const u = this.L.u;
    const probe = sp.begin(4, 4);
    if (!probe) return sp;
    const big = style === 'missile' || style === 'missileRed' || style === 'pullUp';
    const size = (big ? 22 : style === 'label' ? 11 : 15) * u;
    const f = font(size, 900, FAM_DISPLAY, 'italic');
    probe.font = f;
    const tw = probe.measureText(text).width;
    const w = tw + size * (big ? 3.9 : 3), h = size * 1.9;
    const c = sp.begin(w + 10 * u, h + 10 * u, (w + 10 * u) / 2, (h + 10 * u) / 2);
    c.font = f;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (style === 'label') {
      strokeFill(c, text, 0, 0, '#ffe9a8', 'rgba(0, 6, 20, 0.9)', 3 * u);
      return sp;
    }
    const colors = {
      missile: [['rgba(255, 150, 40, 0.92)', 'rgba(170, 50, 0, 0.9)'], '#ffe0a0', '#ffffff'],
      missileRed: [['rgba(255, 60, 50, 0.92)', 'rgba(140, 0, 10, 0.9)'], '#ffd0d0', '#ffffff'],
      pullUp: [['rgba(255, 60, 50, 0.92)', 'rgba(140, 0, 10, 0.9)'], '#ffd0d0', '#ffffff'],
      caution: [['rgba(60, 44, 0, 0.8)', 'rgba(30, 20, 0, 0.8)'], '#ffd21a', '#ffe53b'],
      behind: [['rgba(255, 130, 50, 0.85)', 'rgba(140, 40, 0, 0.85)'], '#ffe0c0', '#ffffff'],
      radar: [['rgba(60, 44, 0, 0.78)', 'rgba(30, 20, 0, 0.78)'], '#ffd21a', '#ffffff'],
      radarRed: [['rgba(255, 60, 50, 0.9)', 'rgba(140, 0, 10, 0.88)'], '#ffd0d0', '#ffffff']
    }[style] || [['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.5)'], '#ffffff', '#ffffff'];
    slantRect(c, -w / 2, -h / 2, w, h, size * 0.5);
    const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, colors[0][0]);
    g.addColorStop(1, colors[0][1]);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 2 * u;
    c.strokeStyle = colors[1];
    c.stroke();
    if (big) {
      // warning triangles at both ends
      for (const d of [-1, 1]) {
        const tx = d * (w / 2 - size * 0.75) + size * 0.12, ty = 0, r = size * 0.42;
        c.beginPath();
        c.moveTo(tx, ty - r);
        c.lineTo(tx + r * 1.05, ty + r * 0.8);
        c.lineTo(tx - r * 1.05, ty + r * 0.8);
        c.closePath();
        c.fillStyle = '#ffe53b';
        c.fill();
        c.fillStyle = '#3a0000';
        c.fillRect(tx - r * 0.1, ty - r * 0.45, r * 0.2, r * 0.7);
        c.fillRect(tx - r * 0.1, ty + r * 0.36, r * 0.2, r * 0.2);
      }
    }
    if (style === 'caution') {
      // hazard stripes on both ends
      c.save();
      slantRect(c, -w / 2, -h / 2, w, h, size * 0.5);
      c.clip();
      c.fillStyle = '#ffd21a';
      for (const d of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const x0 = d * (w / 2 - size * 0.6 - i * size * 0.55);
          c.beginPath();
          c.moveTo(x0, -h / 2);
          c.lineTo(x0 + size * 0.28, -h / 2);
          c.lineTo(x0 - size * 0.2, h / 2);
          c.lineTo(x0 - size * 0.48, h / 2);
          c.closePath();
          c.fill();
        }
      }
      c.restore();
    }
    strokeFill(c, text, size * 0.1, 1 * u, colors[2], 'rgba(20, 0, 0, 0.9)', size * 0.22);
    return sp;
  }

  draw(c, s, dt, L, time, combat, gauges) {
    const u = L.u;
    const x = L.warn.x;
    let y = L.warn.y;
    const th = combat ? s.threat : null;
    // MISSILE plate only while the warning is on (terminal / close missile, see enemyOps);
    // calm blink rate 4 rad/s (8 when urgent; was 12/22), phase from the warning onset so it
    // shows at once
    const warn = !!th && th.warn !== false;
    if (warn) this._warnPh += (dt > 0 ? dt : 0) * (th.urgent ? 8 : 4);
    else this._warnPh = 0;
    if (th) {
      const urgent = warn && th.tgo < 1.5;
      const style = th.strong ? 'missileRed' : 'missile';
      if (warn && Math.cos(this._warnPh) > -0.35) this._plate(style, t('hud.missile'), style).draw(c, x, y);
      if (urgent && Math.sin(time * 9) > -0.5) this._plate('roll', t('hud.roll'), 'label').draw(c, x, y + 26 * u);
      // edge arrow toward the missile
      let dx = th.sx * L.W * 0.5, dy = -th.sy * L.H * 0.5;
      if (th.behind) {
        dx = -dx;
        dy = Math.abs(dy) + L.H * 0.3;
      }
      edgePoint(dx, dy, L.W, L.H, 70 * u, _edge);
      const k = warn ? 1 + 0.15 * Math.sin(this._warnPh) : 1;
      c.save();
      c.translate(_edge.x, _edge.y);
      c.rotate(_edge.a);
      (th.strong ? this.arrowRed : this.arrowOrange).drawScaled(c, 0, 0, k);
      c.restore();
      if (warn) y += 44 * u;
    }
    if (gauges) {
      const pull = s.pullUp || s.caution === 'PULL UP';
      if (pull) {
        if (Math.sin(time * 14) > -0.3) this._plate('pullUp', t('hud.pullUp'), 'pullUp').draw(c, x, y);
        y += 40 * u;
      } else if (s.caution) {
        if (Math.sin(time * 9) > -0.4) this._plate('caution', t('hud.caution'), 'caution').draw(c, x, y);
        y += 36 * u;
      }
      if (s.radarWarning) {
        const txt = s.radarWarning;
        const strong = /LOCK/i.test(txt);
        if (!strong || Math.sin(time * 12) > -0.3) {
          const label = hasString(txt) ? t(txt) : txt;
          this._plate(txt, label, strong ? 'radarRed' : 'radar', this.radarPlates).draw(c, x, y);
        }
        y += 36 * u;
      }
      if (s.timer) this._timer(c, s.timer, L, time);
    }
    // plates occupy the centre column: callouts move up out of their way (Callouts reads this next frame)
    this.columnBusy = y > L.warn.y;
    if (combat && s.enemyBehind && Math.sin(time * 8) > -0.4) {
      const by = L.eo.y - (s.eo ? 52 : 12) * u - 30 * u;
      this._plate('behind', t('hud.enemyBehind'), 'behind').draw(c, x, by);
      // down chevrons
      c.fillStyle = '#ff8a3a';
      const ph = (time * 2) % 1;
      for (let i = 0; i < 2; i++) {
        const cy = by + 20 * u + i * 7 * u + ph * 4 * u;
        c.beginPath();
        c.moveTo(x - 10 * u, cy);
        c.lineTo(x, cy + 6 * u);
        c.lineTo(x + 10 * u, cy);
        c.lineTo(x + 10 * u, cy + 3 * u);
        c.lineTo(x, cy + 9 * u);
        c.lineTo(x - 10 * u, cy + 3 * u);
        c.closePath();
        c.fill();
      }
    }
  }

  _timer(c, tm, L, time) {
    const u = L.u;
    const x = L.timer.x, y = L.timer.y;
    const v = Math.max(0, tm.value || 0);
    const low = v < 15;
    this._plate(tm.label, hasString(tm.label) ? t(tm.label) : tm.label, 'label', this.timerLabels).draw(c, x, y - 18 * u);
    if (low && Math.sin(time * 10) < -0.5) return;
    const g = low ? this.clockRed : this.clock;
    // M:SS.d centred
    const min = Math.floor(v / 60);
    const sec = v - min * 60;
    const colon = g.textWidth(':');
    const secW = g.adv * 3 + g.textWidth('.');
    const minW = g.numberWidth(min, 1);
    const total = minW + colon + secW;
    const x0 = x - total / 2;
    g.number(c, min, x0, y + 6 * u, 1, 0);
    g.text(c, ':', x0 + minW, y + 6 * u, 0);
    drawSeconds(g, c, sec, x0 + total, y + 6 * u);
  }
}

