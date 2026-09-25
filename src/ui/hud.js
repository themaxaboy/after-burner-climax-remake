import { getLang, t } from './i18n.js';
import { hudLayout } from './hud/layout.js';
import { FrameLine } from './hud/frame.js';
import { ScoreBlock } from './hud/score.js';
import { StageRank } from './hud/stageRank.js';
import { Reticle } from './hud/reticle.js';
import { Targets } from './hud/targets.js';
import { Gauges } from './hud/gauges.js';
import { Armor } from './hud/armor.js';
import { RadioPanel } from './hud/radioPanel.js';
import { Callouts, calloutVariant } from './hud/callouts.js';
import { EoSign } from './hud/eoSign.js';
import { Warnings } from './hud/warnings.js';
import { RouteArrows } from './hud/routeArrows.js';
import { Popups } from './hud/popups.js';

// faces the canvas uses; loading them early avoids fallback glyphs in cached layers
const FACES = [
  ['700 16px Orbitron', 'A0'],
  ['900 16px Orbitron', 'A0'],
  ['500 16px Rajdhani', 'A0'],
  ['700 16px Rajdhani', 'A0'],
  ['400 16px "Noto Sans Thai"', 'ก'],
  ['700 16px "Noto Sans Thai"', 'ก']
];

/**
 * Canvas2D arcade HUD (After Burner Climax layout), drawn every rendered
 * frame from the stage's snapshot (`hudBridge`, CONTRACTS §8). This class is
 * the compositor; each block lives in `src/ui/hud/*`. Static parts (frame,
 * badges, labels, gauge frames) are cached in offscreen sprites rebuilt on
 * resize / language / touch-layout changes; numbers come from glyph atlases.
 *
 * Public API used by other modules: message(), callout(), popup(), radio(),
 * clearMessages(), popups, radioLines, messages, eo, visible, lowFx,
 * touchLayout, colorblind.
 */
export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.t = 0;
    this.messages = []; // {text, sub, t, dur, style, color, variant}
    this.popups = []; // {x, y, text, t, color}
    this.radioLines = []; // queue, [0] is on air: {who, text, t, dur}
    this.visible = true;
    this.flashArmor = 0;
    this.colorblind = false;
    this.lowFx = false;
    this.touchLayout = false;
    this.eo = null;
    this.L = null;
    this._w = 0;
    this._h = 0;
    this._k = 0;
    this._touch = false;
    this._lang = '';
    this._fontGen = 0;
    this._builtGen = -1;
    this.frame = new FrameLine(this);
    this.score = new ScoreBlock(this);
    this.stageRank = new StageRank(this);
    this.reticle = new Reticle(this);
    this.targets = new Targets(this);
    this.gauges = new Gauges(this);
    this.armor = new Armor(this);
    this.radioPanel = new RadioPanel(this);
    this.callouts = new Callouts(this);
    this.eoSign = new EoSign(this);
    this.warnings = new Warnings(this);
    this.routeArrows = new RouteArrows(this);
    this.popupLayer = new Popups(this);
    this.modules = [this.frame, this.score, this.stageRank, this.reticle, this.targets, this.gauges, this.armor, this.radioPanel, this.callouts, this.eoSign, this.warnings, this.routeArrows, this.popupLayer];
    this._loadFonts();
  }

  _loadFonts() {
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!fonts?.load) return;
    const bump = () => this._fontGen++;
    for (const [f, text] of FACES) fonts.load(f, text).then(bump, () => {});
    fonts.addEventListener?.('loadingdone', bump);
  }

  /** Force the cached layers to rebuild on the next frame. */
  invalidate() {
    this._fontGen++;
  }

  // ------------------------------------------------------------------ API
  /**
   * Screen message. style: 'top' (default) | 'center' | 'callout' (big skewed
   * banner; variant 'red' | 'gold' | 'cyan' | 'green', else picked from color).
   */
  message(text, { sub = '', dur = 2.5, style = 'top', color = null, delay = 0, variant = null, size = null, y = null } = {}) {
    if (style === 'top' && (text === t('ui.missionComplete') || text === t('hud.engage'))) {
      style = 'callout';
      variant ??= text === t('hud.engage') ? 'red' : 'gold';
    }
    const m = { text, sub, t: -delay, dur, style, color, variant: style === 'callout' ? calloutVariant(variant, color) : null, size, sprite: null, w: 0, y };
    this.messages.push(m);
    if (this.messages.length > 12) this.messages.shift();
    return m;
  }

  /** Big banner: ENGAGE, MISSION COMPLETE, CLIMAX, ALL DOWN, EVADED… */
  callout(text, opts = {}) {
    return this.message(text, { dur: 2, ...opts, style: 'callout' });
  }

  clearMessages() {
    this.messages.length = 0;
  }

  /** Drop every transient item (messages, popups, radio queue, EO sign). */
  reset() {
    this.messages.length = 0;
    this.popups.length = 0;
    this.radioLines.length = 0;
    this.eo = null;
  }

  popup(x, y, text, color = '#ffe08a') {
    if (this.popups.length > 24) this.popups.shift();
    this.popups.push({ x, y, text, t: 0, color });
  }

  /**
   * Radio subtitle (one line at a time, top-centre).
   * opts.interrupt: cut the current line short and play this one next.
   */
  radio(who, text, dur = 3.5, opts = null) {
    const q = this.radioLines;
    const last = q[q.length - 1];
    if (last && last.text === text && last.who === who) return;
    const line = { who, text, t: 0, dur };
    if (opts?.interrupt && q.length) {
      q.splice(1, 0, line);
      q[0].dur = Math.min(q[0].dur, q[0].t + 0.25);
    } else q.push(line);
    while (q.length > 4) q.splice(1, 1);
  }

  // ----------------------------------------------------------------- draw
  _ensureLayout(W, H, k) {
    const lang = getLang();
    if (W === this._w && H === this._h && k === this._k && this.touchLayout === this._touch && lang === this._lang && this._fontGen === this._builtGen) return;
    this._w = W;
    this._h = H;
    this._k = k;
    this._touch = this.touchLayout;
    this._lang = lang;
    this._builtGen = this._fontGen;
    this.L = hudLayout(W, H, k, this.touchLayout);
    for (const m of this.modules) m.layout(this.L);
  }

  /**
   * @param {number} dt real dt
   * @param {object|null} s HUD snapshot (see makeHudState in states/stage/hudBridge.js)
   * @param {number} scale device pixels per CSS pixel
   */
  draw(dt, s, scale = 1) {
    const c = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    if (!this.visible || !s) return;
    this.t += dt;
    const time = this.t;
    this._ensureLayout(W, H, scale || 1);
    const L = this.L;
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.miterLimit = 2;
    const combat = !!s.showCombatHud, gauges = !!s.showGauges;
    if (gauges) this.frame.draw(c);
    if (combat) {
      this.targets.draw(c, s, dt, L, time);
      this.reticle.draw(c, s, dt, L, time);
    }
    if (gauges) {
      this.score.draw(c, s, dt, L, time);
      this.stageRank.draw(c, s, dt, L, time);
      this.gauges.draw(c, s, dt, L, time);
      this.armor.draw(c, s, dt, L, time);
      this.eoSign.draw(c, s, dt, L, time);
    }
    this.routeArrows.draw(c, s, dt, L, time);
    this.warnings.draw(c, s, dt, L, time, combat, gauges);
    this.popupLayer.draw(c, dt, L);
    this.radioPanel.draw(c, dt, L, time);
    this.callouts.draw(c, dt, L, time);
  }
}
