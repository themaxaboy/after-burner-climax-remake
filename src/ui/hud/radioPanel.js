import { Sprite, font, FAM_DISPLAY, FAM_UI, roundRect } from './draw.js';

/**
 * Radio subtitles: a translucent rounded panel top-centre showing one line at
 * a time ("CALLSIGN  text"), fed from a queue (`hud.radioLines`, item 0 is
 * on air). Each line is pre-rendered once into a sprite; lines fade in/out and
 * are cut shorter while others are waiting.
 */
export class RadioPanel {
  constructor(hud) {
    this.hud = hud;
    this.sprite = new Sprite();
    this.cur = null;
    this.L = null;
  }

  layout(L) {
    this.L = L;
    this.cur = null; // rebuild the sprite at the new size
  }

  _build(line) {
    const L = this.L;
    const u = L.u;
    const maxW = L.radio.maxW;
    const probe = this.sprite.ctx || this.hud.ctx;
    const whoFont = font(11.5 * u, 900, FAM_DISPLAY, 'italic');
    let size = 19 * u;
    let textFont = font(size, 700, FAM_UI);
    probe.font = whoFont;
    const who = (line.who || '').toUpperCase();
    const whoW = who ? probe.measureText(who).width + 26 * u : 0;
    const padX = 16 * u, barX = 18 * u;
    const avail = maxW - whoW - padX * 2 - barX;
    // wrap into at most two lines, shrinking if still too long
    let lines = [line.text];
    probe.font = textFont;
    let tw = probe.measureText(line.text).width;
    if (tw > avail) {
      lines = wrap(probe, line.text, avail);
      if (lines.length > 2) {
        size *= 0.86;
        textFont = font(size, 700, FAM_UI);
        probe.font = textFont;
        lines = wrap(probe, line.text, avail / 0.92);
        if (lines.length > 2) lines = [lines[0], lines.slice(1).join(' ')];
      }
      tw = 0;
      for (const l of lines) tw = Math.max(tw, probe.measureText(l).width);
    }
    const lh = size * 1.18;
    const w = Math.min(maxW, padX * 2 + barX + whoW + tw), h = Math.max(34 * u, lines.length * lh + 14 * u);
    const c = this.sprite.begin(w + 8 * u, h + 8 * u, w / 2 + 4 * u, 4 * u);
    if (!c) return;
    const x = -w / 2;
    roundRect(c, x, 0, w, h, 9 * u);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(14, 28, 56, 0.74)');
    g.addColorStop(1, 'rgba(4, 10, 26, 0.66)');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = 'rgba(160, 220, 255, 0.45)';
    c.lineWidth = 1.2 * u;
    c.stroke();
    // accent bar
    c.fillStyle = '#5fe3ff';
    c.fillRect(x + 6 * u, 7 * u, 3 * u, h - 14 * u);
    let tx = x + padX + barX;
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    if (who) {
      c.font = whoFont;
      c.fillStyle = '#6fe0ff';
      c.fillText(who, tx, h / 2 + 0.5 * u);
      tx += whoW;
    }
    c.font = textFont;
    c.fillStyle = '#ffffff';
    const y0 = h / 2 - ((lines.length - 1) * lh) / 2;
    for (let i = 0; i < lines.length; i++) c.fillText(lines[i], tx, y0 + i * lh);
    this.barX = x + padX;
    this.h = h;
  }

  draw(c, dt, L, time) {
    const q = this.hud.radioLines;
    if (!q.length) {
      this.cur = null;
      return;
    }
    const line = q[0];
    if (line !== this.cur) {
      this.cur = line;
      this._build(line);
    }
    line.t += dt;
    const dur = q.length > 1 ? Math.min(line.dur, Math.max(1.6, line.dur * 0.6)) : line.dur;
    if (line.t >= dur) {
      q.shift();
      return;
    }
    const a = Math.min(1, line.t / 0.18, (dur - line.t) / 0.25);
    const u = L.u;
    const x = L.radio.x, y = L.radio.y - this.h / 2;
    c.globalAlpha = Math.max(0, a);
    this.sprite.draw(c, x, y - (1 - Math.min(1, line.t / 0.18)) * 6 * u);
    // "on air" level bars
    c.fillStyle = '#5fe3ff';
    const bx = x + this.barX + 1 * u;
    for (let i = 0; i < 3; i++) {
      const lv = 0.35 + 0.65 * Math.abs(Math.sin(time * (11 + i * 4) + i * 1.7));
      const bh = 12 * u * lv;
      c.fillRect(bx + i * 4 * u, y + this.h / 2 - bh / 2, 2.4 * u, bh);
    }
    c.globalAlpha = 1;
  }
}

function wrap(c, text, maxW) {
  // Thai has no spaces between words: fall back to character wrapping
  const words = text.includes(' ') ? text.split(' ') : Array.from(text);
  const sep = text.includes(' ') ? ' ' : '';
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + sep + w : w;
    if (cur && c.measureText(next).width > maxW) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
