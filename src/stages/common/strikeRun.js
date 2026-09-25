import { Vector3 } from 'three';
import { makeFrame } from '../../sim/rail.js';
import { corridorX, groundPoint, launchSam } from './util.js';

const _f = makeFrame();
const _v = new Vector3();

/**
 * Low-level strike run: a time-to-target clock from `clockFrom`, a pop-up
 * (cue 'popup'), the fortified target placed at the bottom of the dive
 * (cue 'strikeTarget' starts the strike Emergency Order), forced slow-motion
 * Climax as the target fills the sight (cue 'strike') and a high-G pull-out
 * through a SAM volley (cue 'pullup'). The 'strikeTarget' / 'strike' /
 * 'pullup' cues are re-timed in init() around the real bottom of the dive.
 *
 * opts: { targetS (approx. rail metres of the dive bottom), clockFrom, time
 *         (seconds on the clock), eo {id, title, bonus}, radio {hit, sams, late} }
 */
export class StrikeRun {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = opts;
    this.hud = { hideCombat: false, hideGauges: false, timer: null };
    this.timeToTarget = opts.time ?? 45;
    this.clockRunning = false;
    this.struck = false;
    this.gOverride = 0;
  }

  async init() {
    const st = this.stage;
    const approx = this.opts.targetS;
    // locate the bottom of the dive on the real (arc-length) rail and retime the strike cues
    let best = approx, bestY = Infinity;
    for (let s = approx - 600; s < approx + 900; s += 10) {
      const y = st.rail.positionAt(s, _v).y;
      if (y < bestY - 0.01) {
        bestY = y;
        best = s;
      }
    }
    this.targetS = best - 150; // middle of the low pass over the basin
    const retime = { strikeTarget: -1900, strike: -1050, pullup: 230 };
    for (const ev of st.director.distEvents) if (ev.cue && retime[ev.cue] != null) ev.at = this.targetS + retime[ev.cue];
    st.director.distEvents.sort((a, b) => a.at - b.at);
  }

  preUpdate(dt) {
    if (this.gOverride > 0) {
      this.gOverride -= dt;
      const p = this.stage.player;
      p.gOverride = Math.min(1, this.gOverride / 2);
      p.gLoad = Math.max(p.gLoad, 8.5);
    } else if (this._g) {
      this._g = false;
      this.stage.player.gOverride = 0;
    }
  }

  update(dt, wdt) {
    const st = this.stage;
    const p = st.player;
    if (!this.clockRunning && p.s > (this.opts.clockFrom ?? 0)) this.clockRunning = true;
    const on = this.clockRunning && !this.struck;
    if (on) this.timeToTarget = Math.max(0, this.timeToTarget - wdt);
    this.hud.timer = on ? { label: 'TIME TO TARGET', value: this.timeToTarget } : null;
    if (on && this.timeToTarget <= 0 && !this._late) {
      this._late = true;
      st.hud.message('TIME OVER', { sub: 'TARGET DEFENCES ALERTED', color: '#ff5a4a' });
      st.enemies.difficulty.fireRate *= 1.6;
      if (this.opts.radio?.late) st._radio(this.opts.radio.late);
    }
  }

  cue(name) {
    const st = this.stage;
    const g = this.game;
    if (name === 'strikeTarget') {
      const s = this.targetS;
      st.rail.frameAt(s, _f);
      const x = corridorX(st, s);
      groundPoint(st, s, x, 1, _v);
      const e = st.enemies.spawn('target', {
        behavior: 'static',
        world: { x: _v.x, y: _v.y, z: _v.z },
        heading: Math.atan2(_f.T.x, -_f.T.z),
        tag: 'strike',
        countable: false,
        hpMul: 1
      });
      this.target = e;
      const eo = this.opts.eo || {};
      st.director.eo = null;
      st.director._eoStart({ id: eo.id || 'strike', title: eo.title || 'DESTROY THE TARGET', kind: 'destroy', tags: ['strike'], count: 1, bonus: eo.bonus ?? 100000 }, st.player);
      if (e) st.director.eo.remaining = 1;
    } else if (name === 'popup') {
      g.rig.fovKick = 6;
      st.hud.message('POP UP!', { dur: 1.6, color: '#ffd27a' });
    } else if (name === 'strike') {
      // time slows as the target fills the sight
      st.climax.gauge = Math.max(st.climax.gauge, 1);
      st._activateClimax();
      st.hud.message('STRIKE!', { sub: 'LOCK ON AND FIRE', dur: 2.2, color: '#ff8a4a', style: 'center' });
    } else if (name === 'pullup') {
      this.struck = true;
      this.gOverride = 3.2;
      this._g = true;
      g.rig.addTrauma(0.6);
      g.audio?.play('gLoad');
      if (this.target && !this.target.dead && this.target.active) st.director.failEO();
      else if (this.opts.radio?.hit) st._radio(this.opts.radio.hit);
      if (this.opts.radio?.sams) st.schedule(1.2, () => st._radio(this.opts.radio.sams));
      // SAM volley from the basin
      for (let i = 0; i < 4; i++) st.schedule(0.4 + i * 0.55, () => this._samVolley());
    }
  }

  _samVolley() {
    const st = this.stage;
    if (!st.player.alive || st.finished) return;
    const p = st.player;
    for (let k = 0; k < 2; k++) {
      const s = Math.max(0, p.s + st.rng.range(-600, 900));
      const l = st.rng.range(-900, 900);
      groundPoint(st, s, l, 3, _v);
      launchSam(st, _v, 220, 40);
    }
  }
}

export const strikeRun = (opts) => (stage) => new StrikeRun(stage, opts);
