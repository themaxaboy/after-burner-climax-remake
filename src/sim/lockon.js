import { Vector3, Vector4 } from 'three';

const _v4 = new Vector4();

/**
 * Project a world point with a camera. Writes NDC x/y into out.x/out.y,
 * view depth (metres in front of the camera) into out.z. Returns false when
 * behind the camera.
 */
export function projectPoint(camera, p, out) {
  _v4.set(p.x, p.y, p.z, 1).applyMatrix4(camera.matrixWorldInverse);
  const depth = -_v4.z;
  _v4.applyMatrix4(camera.projectionMatrix);
  if (_v4.w <= 1e-4) return false;
  out.x = _v4.x / _v4.w;
  out.y = _v4.y / _v4.w;
  out.z = depth;
  return depth > 0;
}

/**
 * Sweep-to-lock targeting in screen space (After Burner style):
 * targets that stay inside the lock circle around the reticle for a short
 * dwell are added to the lock list (max 8; up to 32 in Climax, instant).
 * Missile presses consume locks in order; each lock remembers how many
 * missiles are already in flight toward it.
 */
export class LockOn {
  constructor() {
    this.locks = []; // enemies
    this.max = 8;
    this.reticle = { x: 0, y: -0.05 }; // NDC
    this.reticleWorld = new Vector3();
    this.radius = 0.1; // in NDC-Y units (fraction of half-height)
    this.climax = false;
    this.assist = 2;
    this.minRange = 120;
    this.maxRange = 4200;
    this.assistTarget = null; // best target for vulcan magnetism
    this.newLocks = 0; // locks acquired this step (for sfx)
    this.aspect = 16 / 9;
    this._s = new Vector3();
  }

  reset() {
    for (const e of this.locks) e.locks = 0;
    this.locks.length = 0;
    this.assistTarget = null;
  }

  lockRadius() {
    const base = 0.105 * (1 + 0.35 * this.assist);
    return this.climax ? base * 3.6 : base;
  }

  /**
   * @param {number} dt real dt (aiming is not slowed by Climax)
   * @param {EnemyManager} enemies
   * @param {Camera} camera last rendered camera
   * @param {Vector3} playerPos
   */
  update(dt, enemies, camera, playerPos) {
    this.newLocks = 0;
    const R = this.lockRadius();
    this.radius = R;
    const max = this.climax ? 32 : this.max;
    const rx = this.reticle.x, ry = this.reticle.y;
    const aspect = this.aspect;
    let best = null, bestScore = Infinity;
    const list = enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.active || !e.lockable || e.dead || e.dying) {
        e.onScreen = false;
        continue;
      }
      const onScreen = projectPoint(camera, e.lockPos, this._s);
      const dist = e.lockPos.distanceTo(playerPos);
      e.dist = dist;
      e.onScreen = onScreen && Math.abs(this._s.x) < 1.05 && Math.abs(this._s.y) < 1.05;
      e.sx = this._s.x;
      e.sy = this._s.y;
      if (!e.onScreen || dist < this.minRange || dist > this.maxRange) {
        e.dwell = 0;
        continue;
      }
      // screen distance in half-height units (x scaled by aspect)
      const dx = (this._s.x - rx) * aspect, dy = this._s.y - ry;
      const d = Math.hypot(dx, dy);
      // projected size helps big targets lock more easily
      const projR = Math.min(0.2, (e.radius / Math.max(this._s.z, 1)) * 1.6);
      const inside = d < R + projR;
      e.screenD = d;
      if (inside) {
        e.dwell = (e.dwell || 0) + dt;
        const maxPer = e.def.big ? 4 : 1;
        const need = this.climax ? 0 : 0.09;
        if (e.dwell >= need && e.locks < maxPer && this.locks.length < max) {
          e.locks++;
          e.lockT = 0;
          this.locks.push(e);
          this.newLocks++;
          if (e.def.big) e.dwell = need - 0.25; // re-lock big targets after a pause
        }
      } else e.dwell = 0;
      // assist target for the vulcan: closest to reticle, prefer threats / EO targets
      const score = d / (R + projR) + dist / this.maxRange * 0.3 - (e.def.threat || 0) * 0.15 - (e.tag ? 0.5 : 0);
      if (d < R * 2 && score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.assistTarget = best;
    // drop invalid locks
    for (let i = this.locks.length - 1; i >= 0; i--) {
      const e = this.locks[i];
      if (!e.active || e.dead || e.dying || !e.lockable || (e.dist > this.maxRange * 1.2) || (!e.onScreen && (e.lockT = (e.lockT || 0) + dt) > 1.2)) {
        e.locks = Math.max(0, e.locks - 1);
        this.locks.splice(i, 1);
      }
    }
  }

  /** Next lock to fire at (FIFO); removes it from the list. */
  consume() {
    if (!this.locks.length) return null;
    const e = this.locks.shift();
    e.locks = Math.max(0, e.locks - 1);
    return e;
  }

  isLocked(e) {
    return e.locks > 0;
  }
}

