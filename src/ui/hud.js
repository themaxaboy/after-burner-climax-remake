import { formatScore, clamp } from '../core/math.js';

const TAU = Math.PI * 2;

/**
 * Canvas2D arcade HUD, drawn every rendered frame.
 * Layout follows After Burner Climax: combo top-left (under score), rank stars
 * top-right, armor bottom-right, Climax gauge bottom-left, missiles + throttle
 * bottom-centre, lock markers on targets, reticle in front of the jet.
 */
export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.messages = []; // {text, sub, t, dur, style}
    this.popups = []; // {x, y, text, t}
    this.radioLines = []; // {who, text, t, dur}
    this.visible = true;
    this.lang = 'en';
    this.flashArmor = 0;
    this.colorblind = false;
    this._lastScore = -1;
    this._scoreStr = '';
    this.eo = null;
  }

  message(text, { sub = '', dur = 2.5, style = 'top', color = null } = {}) {
    this.messages.push({ text, sub, t: 0, dur, style, color });
  }

  clearMessages() {
    this.messages.length = 0;
  }

  popup(x, y, text, color = '#ffe08a') {
    if (this.popups.length > 24) this.popups.shift();
    this.popups.push({ x, y, text, t: 0, color });
  }

  radio(who, text, dur = 3.5) {
    this.radioLines.push({ who, text, t: 0, dur });
    if (this.radioLines.length > 3) this.radioLines.shift();
  }

  /**
   * @param {number} dt real dt
   * @param {object} s hud state snapshot from the stage
   */
  draw(dt, s, scale) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!this.visible || !s) return;
    this.t += dt;
    const k = scale; // device pixels per css px
    const u = Math.min(W / k / 1280, H / k / 720) * k; // layout unit
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (s.showCombatHud) {
      this._targets(c, s, W, H, u);
      this._reticle(c, s, W, H, u);
      this._threats(c, s, W, H, u);
    }
    if (s.showGauges) {
      this._score(c, s, W, H, u);
      this._stars(c, s, W, H, u);
      this._climax(c, s, W, H, u);
      this._armor(c, s, W, H, u);
      this._missiles(c, s, W, H, u);
      this._eo(c, s, W, H, u);
      this._warnings(c, s, W, H, u);
    }
    this._popups(c, dt, u);
    this._radio(c, dt, W, H, u);
    this._messages(c, dt, W, H, u);
    c.restore();
  }

  _font(size, weight = 700, fam = 'Orbitron') {
    return `${weight} ${size}px ${fam}, Rajdhani, 'Noto Sans Thai', sans-serif`;
  }

  _glowText(c, text, x, y, color, size, align = 'left', weight = 700, fam = 'Orbitron') {
    c.font = this._font(size, weight, fam);
    c.textAlign = align;
    c.textBaseline = 'alphabetic';
    c.shadowColor = color;
    c.shadowBlur = size * 0.5;
    c.fillStyle = color;
    c.fillText(text, x, y);
    c.shadowBlur = 0;
  }

  _reticle(c, s, W, H, u) {
    const r = s.reticle;
    if (!r) return;
    const x = (r.x * 0.5 + 0.5) * W;
    const y = (-r.y * 0.5 + 0.5) * H;
    const R = s.lockRadius * H * 0.5;
    const climax = s.climax;
    const col = climax ? '#5fd4ff' : s.assistActive ? '#ffb347' : '#8dffbf';
    c.strokeStyle = col;
    c.shadowColor = col;
    c.shadowBlur = 8 * u;
    c.lineWidth = 2 * u;
    const spin = this.t * (climax ? 2.2 : 0.6);
    // segmented outer ring
    const segs = climax ? 12 : 4;
    for (let i = 0; i < segs; i++) {
      const a0 = spin + (i / segs) * TAU + 0.12;
      const a1 = a0 + TAU / segs - 0.24;
      c.beginPath();
      c.arc(x, y, R, a0, a1);
      c.stroke();
    }
    // inner ticks
    const ri = Math.min(R * 0.35, 22 * u);
    c.lineWidth = 2.2 * u;
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      c.moveTo(x + Math.cos(a) * ri * 0.55, y + Math.sin(a) * ri * 0.55);
      c.lineTo(x + Math.cos(a) * ri, y + Math.sin(a) * ri);
    }
    c.stroke();
    c.beginPath();
    c.arc(x, y, 2.2 * u, 0, TAU);
    c.fillStyle = col;
    c.fill();
    c.shadowBlur = 0;
    // lock count next to reticle
    if (s.lockCount > 0) {
      this._glowText(c, `${s.lockCount}`, x + R * 0.72 + 6 * u, y - R * 0.72, '#ff5a4a', 16 * u, 'left');
    }
    if (climax) {
      this._glowText(c, 'CLIMAX', x, y + R + 22 * u, '#5fd4ff', 14 * u, 'center', 900);
    }
  }

  _targets(c, s, W, H, u) {
    const list = s.targets;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.onScreen || e.dead) continue;
      const x = (e.sx * 0.5 + 0.5) * W;
      const y = (-e.sy * 0.5 + 0.5) * H;
      const size = clamp((e.radius / Math.max(e.dist, 1)) * H * 1.2, 10 * u, 90 * u);
      if (e.locks > 0) {
        // locked: rotating red diamond + LOCK tag
        const lockCol = this.colorblind ? '#ffd400' : '#ff3b30';
        c.save();
        c.translate(x, y);
        c.rotate(Math.PI / 4 + Math.sin(this.t * 6 + e.id) * 0.15);
        c.strokeStyle = lockCol;
        c.shadowColor = lockCol;
        c.shadowBlur = 10 * u;
        c.lineWidth = 2.4 * u;
        const d = size + 10 * u;
        c.strokeRect(-d, -d, d * 2, d * 2);
        c.restore();
        this._glowText(c, e.locks > 1 ? `LOCK x${e.locks}` : 'LOCK', x + size + 14 * u, y - size - 6 * u, lockCol, 11 * u, 'left');
      } else {
        // candidate: corner brackets
        const col = e.tag ? `rgba(255, 220, 90, ${0.6 + 0.4 * Math.sin(this.t * 8)})` : 'rgba(141,255,191,0.55)';
        c.strokeStyle = col;
        c.lineWidth = 1.6 * u;
        const d = size + 4 * u, l = Math.max(6 * u, d * 0.35);
        c.beginPath();
        c.moveTo(x - d, y - d + l); c.lineTo(x - d, y - d); c.lineTo(x - d + l, y - d);
        c.moveTo(x + d - l, y - d); c.lineTo(x + d, y - d); c.lineTo(x + d, y - d + l);
        c.moveTo(x + d, y + d - l); c.lineTo(x + d, y + d); c.lineTo(x + d - l, y + d);
        c.moveTo(x - d + l, y + d); c.lineTo(x - d, y + d); c.lineTo(x - d, y + d - l);
        c.stroke();
        if (e.tag) this._glowText(c, 'TARGET', x, y - d - 8 * u, '#ffd84a', 11 * u, 'center');
      }
      // health bar for big targets
      if (e.def.big || e.tag) {
        const w = 70 * u, h = 5 * u;
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(x - w / 2, y + size + 12 * u, w, h);
        c.fillStyle = '#ffcc55';
        c.fillRect(x - w / 2, y + size + 12 * u, w * clamp(e.hp / e.maxHp, 0, 1), h);
      }
    }
  }

  _threats(c, s, W, H, u) {
    const th = s.threat;
    if (!th) return;
    // arrow at the screen edge toward the incoming missile
    const blink = Math.sin(this.t * 20) > 0;
    const cx = W / 2, cy = H / 2;
    let dx = th.sx, dy = -th.sy;
    if (th.behind) {
      dx = -dx;
      dy = Math.abs(dy) + 0.4;
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const rr = Math.min(W, H) * 0.36;
    const ax = cx + dx * rr, ay = cy + dy * rr;
    c.save();
    c.translate(ax, ay);
    c.rotate(Math.atan2(dy, dx));
    c.fillStyle = blink ? '#ff3b30' : '#ff8a70';
    c.shadowColor = '#ff3b30';
    c.shadowBlur = 16 * u;
    c.beginPath();
    c.moveTo(26 * u, 0);
    c.lineTo(-12 * u, -16 * u);
    c.lineTo(-4 * u, 0);
    c.lineTo(-12 * u, 16 * u);
    c.closePath();
    c.fill();
    c.restore();
  }

  _score(c, s, W, H, u) {
    if (s.score !== this._lastScore) {
      this._lastScore = s.score;
      this._scoreStr = formatScore(s.score);
    }
    const x = 28 * u, y = 44 * u;
    this._glowText(c, 'SCORE', x, y - 22 * u, 'rgba(255,255,255,0.75)', 11 * u);
    this._glowText(c, this._scoreStr, x, y + 4 * u, '#ffffff', 26 * u, 'left', 700);
    if (s.combo > 1) {
      const pulse = 1 + Math.max(0, 0.25 - (s.comboAge || 0)) * 1.2;
      this._glowText(c, `${s.combo}`, x, y + 44 * u, '#ffd27a', 30 * u * pulse, 'left', 900);
      c.font = this._font(30 * u * pulse, 900);
      const w = c.measureText(`${s.combo}`).width;
      this._glowText(c, 'COMBO', x + w + 8 * u, y + 44 * u, '#ffb347', 13 * u, 'left');
      // combo timer bar
      c.fillStyle = 'rgba(255,180,70,0.8)';
      c.fillRect(x, y + 52 * u, 120 * u * clamp(s.comboTimer / 4, 0, 1), 3 * u);
    }
    if (s.stageName) {
      this._glowText(c, s.stageName, x, y + (s.combo > 1 ? 80 : 44) * u, 'rgba(200,230,255,0.65)', 10 * u, 'left', 500);
    }
  }

  _stars(c, s, W, H, u) {
    const n = 5;
    const size = 11 * u;
    for (let i = 0; i < n; i++) {
      const x = W - 36 * u - i * 28 * u, y = 38 * u;
      const on = i < s.stars;
      const shine = s.shining && on;
      c.save();
      c.translate(x, y);
      c.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 === 0 ? size : size * 0.45;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath();
      if (on) {
        c.fillStyle = shine ? `hsl(${(this.t * 120 + i * 40) % 360}, 90%, 70%)` : '#ffd35a';
        c.shadowColor = '#ffb020';
        c.shadowBlur = 12 * u;
        c.fill();
      } else {
        c.strokeStyle = 'rgba(255,255,255,0.35)';
        c.lineWidth = 1.2 * u;
        c.stroke();
      }
      c.restore();
    }
  }

  _climax(c, s, W, H, u) {
    const x = 34 * u, y = this.touchLayout ? 118 * u : H - 46 * u;
    const w = 230 * u, h = 12 * u;
    const v = clamp(s.climaxGauge, 0, 1);
    const ready = v >= 1 && !s.climax;
    this._glowText(c, 'CLIMAX', x, y - 12 * u, ready ? `rgba(95,212,255,${0.6 + 0.4 * Math.sin(this.t * 8)})` : '#5fd4ff', 13 * u, 'left', 900);
    if (ready) this._glowText(c, 'READY', x + 104 * u, y - 12 * u, '#ffffff', 12 * u, 'left', 700);
    c.fillStyle = 'rgba(4,16,30,0.6)';
    c.fillRect(x, y, w, h);
    const g = c.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#1d7cff');
    g.addColorStop(1, '#7ff0ff');
    c.fillStyle = g;
    c.shadowColor = '#3fb6ff';
    c.shadowBlur = ready ? 18 * u : 8 * u;
    c.fillRect(x, y, w * v, h);
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(127,240,255,0.7)';
    c.lineWidth = 1.2 * u;
    c.strokeRect(x, y, w, h);
    // segment ticks
    c.beginPath();
    for (let i = 1; i < 10; i++) {
      c.moveTo(x + (w * i) / 10, y);
      c.lineTo(x + (w * i) / 10, y + h);
    }
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.stroke();
  }

  _armor(c, s, W, H, u) {
    const w = 230 * u, h = 12 * u;
    const x = W - 34 * u - w, y = this.touchLayout ? 78 * u : H - 46 * u;
    const v = clamp(s.armor / 100, 0, 1);
    const low = v < 0.3;
    const col = low ? (Math.sin(this.t * 12) > 0 ? '#ff3b30' : '#ff8a70') : v < 0.6 ? '#ffc93b' : '#7dffb0';
    this._glowText(c, 'ARMOR', x + w, y - 12 * u, col, 13 * u, 'right', 900);
    this._glowText(c, `${Math.ceil(s.armor)}%`, x + w - 86 * u, y - 12 * u, '#fff', 12 * u, 'right', 700);
    c.fillStyle = 'rgba(30,6,6,0.6)';
    c.fillRect(x, y, w, h);
    c.fillStyle = col;
    c.shadowColor = col;
    c.shadowBlur = 8 * u;
    c.fillRect(x + w * (1 - v), y, w * v, h);
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 1.2 * u;
    c.strokeRect(x, y, w, h);
    // lives
    for (let i = 0; i < s.lives; i++) {
      const lx = x + i * 18 * u, ly = y + h + 16 * u;
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath();
      c.moveTo(lx + 6 * u, ly - 8 * u);
      c.lineTo(lx + 12 * u, ly + 2 * u);
      c.lineTo(lx + 6 * u, ly - 1 * u);
      c.lineTo(lx, ly + 2 * u);
      c.closePath();
      c.fill();
    }
  }

  _missiles(c, s, W, H, u) {
    const x = W / 2, y = this.touchLayout ? 96 * u : H - 30 * u;
    this._glowText(c, `MSL ${String(s.missiles).padStart(2, '0')}`, x - 70 * u, y, s.missiles > 0 ? '#ffffff' : '#ff5a4a', 16 * u, 'center', 700);
    const th = s.throttle;
    const label = th > 0 ? 'FAST' : th < 0 ? 'SLOW' : 'NORMAL';
    const col = th > 0 ? '#ffb347' : th < 0 ? '#8fd0ff' : '#8dffbf';
    this._glowText(c, label, x + 70 * u, y, col, 14 * u, 'center', 900);
    // speed / altitude (Top Gun-style HUD numerics)
    this._glowText(c, `${Math.round(s.speedKt)} KT`, x - 70 * u, y - 22 * u, 'rgba(141,255,191,0.75)', 10 * u, 'center', 500);
    this._glowText(c, `${Math.round(s.altFt)} FT`, x + 70 * u, y - 22 * u, 'rgba(141,255,191,0.75)', 10 * u, 'center', 500);
    if (s.gLoad > 4.5) this._glowText(c, `${s.gLoad.toFixed(1)} G`, x, y - 22 * u, '#ffcf6a', 12 * u, 'center', 700);
  }

  _eo(c, s, W, H, u) {
    const eo = s.eo;
    if (!eo && s.timer) {
      const tm = s.timer;
      const v = Math.max(0, tm.value);
      const txt = `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}.${String(Math.floor((v * 10) % 10))}`;
      this._glowText(c, tm.label, W / 2, 30 * u, 'rgba(255,220,120,0.85)', 11 * u, 'center', 700);
      this._glowText(c, txt, W / 2, 58 * u, v < 15 ? '#ff5a4a' : '#ffffff', 26 * u, 'center', 900);
      return;
    }
    if (!eo) return;
    const x = W / 2, y = 34 * u;
    const active = eo.status === 'active';
    const col = active ? '#ffd84a' : eo.status === 'cleared' ? '#7dffb0' : '#ff5a4a';
    this._glowText(c, 'EMERGENCY ORDER', x, y, col, 13 * u, 'center', 900);
    this._glowText(c, eo.title, x, y + 20 * u, '#ffffff', 12 * u, 'center', 600, 'Rajdhani');
    if (active && eo.timeLimit) {
      const left = Math.max(0, eo.timeLimit - eo.t);
      this._glowText(c, left.toFixed(1), x, y + 44 * u, left < 5 ? '#ff5a4a' : '#ffd84a', 20 * u, 'center', 900);
    }
    if (!active) this._glowText(c, eo.status === 'cleared' ? 'CLEAR' : 'FAILED', x, y + 44 * u, col, 18 * u, 'center', 900);
  }

  _warnings(c, s, W, H, u) {
    const blink = Math.sin(this.t * 14) > -0.2;
    let y = H * 0.25;
    if (s.threat && blink) {
      this._glowText(c, s.threat.tgo < 2 ? 'BREAK! BREAK!' : 'MISSILE ALERT', W / 2, y, '#ff3b30', 22 * u, 'center', 900);
      y += 30 * u;
    }
    if (s.enemyBehind && blink) {
      this._glowText(c, 'BANDIT ON YOUR SIX', W / 2, y, '#ff8a4a', 15 * u, 'center', 700);
      y += 24 * u;
    }
    if (s.pullUp && blink) {
      this._glowText(c, 'PULL UP', W / 2, y, '#ffcf3b', 20 * u, 'center', 900);
      y += 26 * u;
    }
    if (s.radarWarning && blink) {
      this._glowText(c, s.radarWarning, W / 2, y, '#ffcf3b', 15 * u, 'center', 900);
    }
  }

  _popups(c, dt, u) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      if (p.t > 1.1) {
        this.popups.splice(i, 1);
        continue;
      }
      const a = 1 - Math.max(0, p.t - 0.6) / 0.5;
      c.globalAlpha = a;
      this._glowText(c, p.text, p.x, p.y - p.t * 40 * u, p.color, 14 * u, 'center', 900);
      c.globalAlpha = 1;
    }
  }

  _radio(c, dt, W, H, u) {
    let y = H - 96 * u;
    for (let i = this.radioLines.length - 1; i >= 0; i--) {
      const r = this.radioLines[i];
      r.t += dt;
      if (r.t > r.dur) {
        this.radioLines.splice(i, 1);
        continue;
      }
      const a = Math.min(1, r.t * 4, (r.dur - r.t) * 2);
      c.globalAlpha = a;
      c.font = this._font(15 * u, 600, 'Rajdhani');
      const text = r.who ? `${r.who}: ${r.text}` : r.text;
      const tw = c.measureText(text).width;
      c.fillStyle = 'rgba(0,10,20,0.55)';
      c.fillRect(W / 2 - tw / 2 - 12 * u, y - 18 * u, tw + 24 * u, 26 * u);
      c.textAlign = 'center';
      c.fillStyle = '#d8f3ff';
      if (r.who) {
        c.textAlign = 'left';
        const whoText = `${r.who}: `;
        const ww = c.measureText(whoText).width;
        c.fillStyle = '#7dd8ff';
        c.fillText(whoText, W / 2 - tw / 2, y);
        c.fillStyle = '#ffffff';
        c.fillText(r.text, W / 2 - tw / 2 + ww, y);
      } else c.fillText(text, W / 2, y);
      c.globalAlpha = 1;
      y -= 32 * u;
    }
  }

  _messages(c, dt, W, H, u) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      m.t += dt;
      if (m.t > m.dur) {
        this.messages.splice(i, 1);
        continue;
      }
    }
    const m = this.messages[this.messages.length - 1];
    if (!m) return;
    const inA = Math.min(1, m.t * 3), outA = Math.min(1, (m.dur - m.t) * 2.5);
    const a = Math.min(inA, outA);
    const y = m.style === 'center' ? H * 0.5 : H * 0.3;
    c.globalAlpha = a;
    const col = m.color || '#ffffff';
    const scaleIn = 1 + (1 - inA) * 0.25;
    this._glowText(c, m.text, W / 2, y, col, 34 * u * scaleIn, 'center', 900);
    if (m.sub) this._glowText(c, m.sub, W / 2, y + 34 * u, '#ffd27a', 16 * u, 'center', 700);
    // accent lines
    c.fillStyle = col;
    const lw = 180 * u * inA;
    c.fillRect(W / 2 - lw, y + (m.sub ? 50 : 16) * u, lw * 2, 1.5 * u);
    c.globalAlpha = 1;
  }
}
