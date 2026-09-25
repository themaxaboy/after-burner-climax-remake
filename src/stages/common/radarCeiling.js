import { Vector3 } from 'three';
import { groundAt } from './compose.js';
import { corridorX, groundPoint, launchSam, sectionAt } from './util.js';

const _v = new Vector3();
const _sec = { width: 0, depth: 0, floor: 0 };

/**
 * Radar ceiling over a terrain run: fly higher than `agl` metres above the
 * corridor floor between `from` and `to` (rail metres) and, after a short
 * grace, SAM sites on the rims start firing until you get low again.
 *
 * opts: { from, to, agl = 95, radio: key spoken the first time you are painted }
 */
export class RadarCeiling {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = { agl: 95, ...opts };
    this.radarWarning = null;
    this.radarT = 0;
    this.samCd = 0;
    this.enabled = true;
  }

  cue(name) {
    if (name === 'radarOff') this.enabled = false;
  }

  update(dt) {
    const st = this.stage;
    const p = st.player;
    const o = this.opts;
    this.radarWarning = null;
    if (!this.enabled || !p.alive || st.dead || st.finished || p.s < o.from || p.s > o.to) {
      this.radarT = 0;
      return;
    }
    const floor = groundAt(st, p.s, corridorX(st, p.s));
    const agl = p.pos.y - floor;
    if (agl > o.agl) {
      this.radarT += dt;
      this.radarWarning = this.radarT > 1 ? 'RADAR LOCK — GET LOW!' : 'RADAR CEILING';
      if (this.radarT > 1.2) {
        this.samCd -= dt;
        if (this.samCd <= 0) {
          this.samCd = 2.3;
          this._samFromRim();
          if (!this._told && o.radio) {
            this._told = true;
            st._radio(o.radio);
          }
        }
      }
    } else {
      this.radarT = Math.max(0, this.radarT - dt * 2);
      this.samCd = Math.max(this.samCd, 0.6);
    }
  }

  /** Enemy SAM launched from the canyon rim ahead of the player. */
  _samFromRim() {
    const st = this.stage;
    const p = st.player;
    const s = p.s + 900 + st.rng.next() * 700;
    const side = st.rng.sign();
    sectionAt(st.def.terrain?.sections, s, _sec);
    const l = corridorX(st, s) + side * (_sec.width + _sec.depth * 0.5 + 40);
    groundPoint(st, s, l, 4, _v);
    launchSam(st, _v, 180, 60);
  }
}

export const radarCeiling = (opts) => (stage) => new RadarCeiling(stage, opts);
