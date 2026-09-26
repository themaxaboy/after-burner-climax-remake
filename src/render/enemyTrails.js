import { Vector3 } from 'three';
import { drawScaleOf } from './enemyRenderer.js';

const _p = new Vector3();
const _back = new Vector3();
const _cam = new Vector3();
const _fw = new Vector3();

/**
 * Short thin contrails on the nearest fast enemy aircraft (medium quality and
 * up): they draw the enemy's flight path, so a dark jet reads as a moving
 * aircraft even when it is only a few pixels.
 *
 * Uses the FX ribbon-trail pool (`fx.createTrail({kind: 'contrail'})`), at
 * most `max` trails at once and only while the pool keeps `reserve` free slots
 * for missile trails; when missiles need the room the farthest enemy trail is
 * stopped first. Trails are stopped (they fade out and return to the pool)
 * when their enemy dies, leaves or falls out of the nearest set.
 *
 * Wiring (StageState): `update(enemies, camera, alpha)` every rendered frame,
 * `clear()` on respawn, `dispose()` on exit. Safe with the FX stub (no-op).
 */
export const ENEMY_TRAILS = {
  max: 6,
  reserve: 12, // free FX trail slots kept for missiles
  minSpeed: 120, // m/s world speed
  startDist: 1500, // m from the camera: a new trail starts inside this
  dropDist: 2100, // m: an existing trail stops beyond this
  width: 0.45,
  life: 1.2,
  opacity: 0.5,
  endOn: 0.5, // no trail on aircraft flying away along the view (cos of the angle): it would cover them
  qualities: ['medium', 'high', 'ultra']
};

export class EnemyTrails {
  /** @param {object} fx FX instance (or FX_STUB) */
  constructor(fx, opts = {}) {
    this.fx = fx;
    this.cfg = { ...ENEMY_TRAILS, ...opts };
    const q = fx?.Q?.name ?? fx?.quality;
    this.enabled = !!fx?.createTrail && this.cfg.qualities.includes(q);
    this.recs = []; // {e, id, trail}
    this._pool = [];
  }

  /** Free trail slots in the FX pool (capacity − active). */
  _free() {
    const cap = this.fx.Q?.trails ?? 0;
    const active = this.fx.trails?.active ?? 0;
    return cap - active;
  }

  _stop(i) {
    const r = this.recs[i];
    r.trail?.stop?.();
    r.trail = null;
    r.e = null;
    this._pool.push(r);
    this.recs[i] = this.recs[this.recs.length - 1];
    this.recs.pop();
  }

  _tail(e, alpha, d, out) {
    out.lerpVectors(e.prevPos, e.pos, alpha);
    _back.set(0, 0, 1).applyQuaternion(e.quat);
    return out.addScaledVector(_back, (e.def.size ?? 8) * 0.85 * drawScaleOf(e.def, d));
  }

  _eligible(e) {
    return e.active && e.visible && !e.dead && !(e.dying > 0) && e.def.air && !e.def.big && e.vel.lengthSq() > this.cfg.minSpeed * this.cfg.minSpeed;
  }

  /** Flying away along the line of sight (`_p` = e.pos − camera, `d` its length): the trail would be seen end-on over the jet. */
  _receding(e, d) {
    const v = e.vel.length();
    return v > 1 && _p.dot(e.vel) / (v * Math.max(d, 1)) > this.cfg.endOn;
  }

  /**
   * @param {EnemyManager} enemies
   * @param {Camera} camera
   * @param {number} [alpha=1] sim interpolation (matches the enemy renderer)
   */
  update(enemies, camera, alpha = 1) {
    if (!this.enabled || !camera) return;
    const c = this.cfg;
    _cam.copy(camera.position);
    camera.getWorldDirection(_fw);
    // keep, extend or stop the current trails
    let farI = -1, farD = -1;
    for (let i = this.recs.length - 1; i >= 0; i--) {
      const r = this.recs[i];
      const e = r.e;
      if (e.id !== r.id || !this._eligible(e) || !r.trail.alive) {
        this._stop(i);
        continue;
      }
      _p.subVectors(e.pos, _cam);
      const d = _p.length();
      if (d > c.dropDist || _p.dot(_fw) < -150 || this._receding(e, d)) {
        this._stop(i);
        continue;
      }
      r.trail.push(this._tail(e, alpha, d, _p));
      if (d > farD) {
        farD = d;
        farI = i;
      }
    }
    const free = this._free();
    if (free < c.reserve / 2 && farI >= 0) {
      this._stop(farI); // missiles need the room
      return;
    }
    if (this.recs.length >= c.max || free <= c.reserve) return;
    // start one trail per frame on the nearest eligible enemy without one
    let best = null, bestD = c.startDist;
    const list = enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!this._eligible(e)) continue;
      _p.subVectors(e.pos, _cam);
      const d = _p.length();
      if (d >= bestD || _p.dot(_fw) < 0 || this._receding(e, d)) continue;
      let has = false;
      for (const r of this.recs) if (r.e === e && r.id === e.id) has = true;
      if (has) continue;
      best = e;
      bestD = d;
    }
    if (!best) return;
    const trail = this.fx.createTrail({ kind: 'contrail', width: c.width, life: c.life, opacity: c.opacity });
    if (!trail || !trail.alive) return;
    const r = this._pool.pop() || { e: null, id: 0, trail: null };
    r.e = best;
    r.id = best.id;
    r.trail = trail;
    this.recs.push(r);
    trail.push(this._tail(best, alpha, bestD, _p));
  }

  /** Stop every enemy trail (respawn / stage end). */
  clear() {
    for (let i = this.recs.length - 1; i >= 0; i--) this._stop(i);
  }

  dispose() {
    this.clear();
    this._pool.length = 0;
    this.fx = null;
    this.enabled = false;
  }

  get count() {
    return this.recs.length;
  }
}
