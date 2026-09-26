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

/** Hidden catch radius (half-height units) per assist level 0/1/2. */
export const LOCK_RADIUS = [0.075, 0.095, 0.115];
export const MAX_LOCKS_PER_TARGET = 4;

/**
 * Lock-on range (m, from the player): fighters/helos 1600, big aircraft and
 * ground/sea units 2400 (`ENEMY_TYPES[type].lockRange` wins). Climax widens
 * every range ×1.5. Nothing is locked closer than `LockOn.minRange`.
 */
export const LOCK_RANGE = { air: 1600, big: 2400 };
export const CLIMAX_RANGE_MUL = 1.5;

/** Base lock range of an enemy type definition (m). */
export function lockRangeOf(def) {
  if (def?.lockRange) return def.lockRange;
  return def && (def.big || def.air === false) ? LOCK_RANGE.big : LOCK_RANGE.air;
}

/**
 * Sweep-to-lock targeting in screen space (After Burner style).
 *
 * Passing the (small) reticle over a target locks it after a short dwell.
 * Each target needs `lockNeed = min(4, ceil(hpLeft / missileDamage))`
 * missiles; it stays lockable while `locks + incoming < lockNeed` (pending
 * locks plus player missiles already in flight, which MissileSystem keeps in
 * `e.incoming`). After each lock the target rests `relockTime` before it can
 * take another one, so tough targets collect several locks while one-shot
 * targets never get a second lock or a second missile. `e.xMark` is set once
 * the missiles in flight cover the need (the HUD draws a red ✕).
 *
 * `consume()` hands out the oldest valid pending lock (FIFO). Climax widens
 * the circle, removes the dwell and raises the cap to `climaxMax`.
 *
 * Range: a target locks (and can be the assist target for unlocked shots)
 * only between `minRange` and its type's lock range (×1.5 in Climax);
 * `e.inLockRange` / `e.lockRange` are refreshed every step for the HUD. A
 * pending lock is dropped once its target is beyond 1.2× the range it was
 * locked at (Climax locks keep the Climax range through the salvo).
 */
export class LockOn {
  constructor() {
    this.locks = []; // pending lock entries (enemies, oldest first)
    this.lockIds = []; // enemy ids at lock time (pool slots get reused)
    this.lockMuls = []; // range multiplier at lock time (Climax locks survive the salvo)
    this.max = 6; // per-jet capacity (PLAYER_JETS[id].lockCap)
    this.climaxMax = 64;
    this.reticle = { x: 0, y: -0.05 }; // NDC centre of the drawn reticle
    this.reticleSize = 0.032; // drawn bracket, fraction of screen height
    this.reticleWorld = new Vector3();
    this.radius = LOCK_RADIUS[2]; // current catch radius (NDC-Y / half-height units)
    this.climaxRadius = 0.45;
    this.climax = false;
    this.assist = 2;
    this.minRange = 80;
    this.maxRange = 4200; // hard cap on any lock range (m)
    this.climaxRangeMul = CLIMAX_RANGE_MUL;
    this.missileDamage = 12;
    this.dwellTime = 0.06; // s under the reticle before a lock
    this.relockTime = 0.3; // s rest between two locks on the same target
    this.climaxRelock = 0.1;
    this.offscreenDrop = 1.2; // s off screen before a pending lock is dropped
    this.assistTarget = null; // best target near the reticle (vulcan, dumb-fire)
    this.newLocks = 0; // locks acquired this step (for sfx)
    this.aspect = 16 / 9;
    this._s = new Vector3();
  }

  reset() {
    for (let i = 0; i < this.locks.length; i++) if (this.locks[i].id === this.lockIds[i]) this.locks[i].locks = 0;
    this.locks.length = 0;
    this.lockIds.length = 0;
    this.lockMuls.length = 0;
    this.assistTarget = null;
  }

  /** Current valid locks as {e, id} pairs. */
  snapshot(out = []) {
    out.length = 0;
    for (let i = 0; i < this.locks.length; i++) out.push({ e: this.locks[i], id: this.lockIds[i] });
    return out;
  }

  get count() {
    return this.locks.length;
  }

  get capacity() {
    return this.climax ? this.climaxMax : this.max;
  }

  lockRadius() {
    return this.climax ? this.climaxRadius : LOCK_RADIUS[this.assist] ?? LOCK_RADIUS[2];
  }

  /** Current lock range of `e` (m): its type's range, ×1.5 in Climax (or `mul`), capped at maxRange. */
  rangeOf(e, mul = this.climax ? this.climaxRangeMul : 1) {
    return Math.min(this.maxRange, lockRangeOf(e.def) * mul);
  }

  /** Missiles needed to destroy `e` from its current hp (1..4). */
  lockNeed(e) {
    const hp = e.hp != null ? e.hp : this.missileDamage;
    return Math.max(1, Math.min(MAX_LOCKS_PER_TARGET, Math.ceil(hp / this.missileDamage)));
  }

  /** Alive, lockable and not yet covered by pending locks + missiles in flight. */
  canTarget(e) {
    if (!e || !e.active || e.dead || e.dying || !e.lockable) return false;
    return (e.locks || 0) + (e.incoming || 0) < this.lockNeed(e);
  }

  /** Refresh the per-enemy lock bookkeeping (need, ✕ mark). */
  refresh(e) {
    const need = (e.lockNeed = this.lockNeed(e));
    const inc = e.incoming || 0;
    e.xMark = inc > 0 && (e.locks || 0) + inc >= need;
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
    const cap = this.capacity;
    const rx = this.reticle.x, ry = this.reticle.y;
    const aspect = this.aspect;
    const projK = 1 / Math.tan(((camera.fov || 60) * Math.PI) / 360); // metres/depth → half-height units
    const dwellNeed = this.climax ? 0 : this.dwellTime;
    const relock = this.climax ? this.climaxRelock : this.relockTime;
    const mul = this.climax ? this.climaxRangeMul : 1;
    let best = null, bestScore = Infinity;
    const list = enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e._lkId !== e.id) {
        // fresh enemy (or a recycled pool slot)
        e._lkId = e.id;
        e.dwell = 0;
        e.relockT = 0;
        e.offT = 0;
        e.xMark = false;
      }
      if (e.relockT > 0) e.relockT -= dt;
      this.refresh(e);
      if (!e.active || !e.lockable || e.dead || e.dying) {
        e.onScreen = false;
        e.inLockRange = false;
        e.dwell = 0;
        continue;
      }
      const onScreen = projectPoint(camera, e.lockPos, this._s);
      const dist = e.lockPos.distanceTo(playerPos);
      const range = this.rangeOf(e, mul);
      e.dist = dist;
      e.lockRange = range;
      e.inLockRange = dist >= this.minRange && dist <= range;
      e.onScreen = onScreen && Math.abs(this._s.x) < 1.05 && Math.abs(this._s.y) < 1.05;
      e.sx = this._s.x;
      e.sy = this._s.y;
      e.offT = e.onScreen ? 0 : e.offT + dt;
      if (!e.onScreen || !e.inLockRange) {
        e.dwell = 0;
        continue;
      }
      // screen distance in half-height units (x scaled by aspect)
      const dx = (this._s.x - rx) * aspect, dy = this._s.y - ry;
      const d = Math.hypot(dx, dy);
      // projected size helps big targets lock more easily
      const projR = Math.min(0.2, (e.radius / Math.max(this._s.z, 1)) * projK);
      const reach = R + projR;
      e.screenD = d;
      const lockable = (e.locks || 0) + (e.incoming || 0) < e.lockNeed;
      if (d < reach) {
        e.dwell += dt;
        if (lockable && e.relockT <= 0 && e.dwell >= dwellNeed && this.locks.length < cap) {
          e.locks = (e.locks || 0) + 1;
          this.locks.push(e);
          this.lockIds.push(e.id);
          this.lockMuls.push(mul);
          this.newLocks++;
          e.relockT = relock;
          e.dwell = 0;
          this.refresh(e);
        }
      } else e.dwell = 0;
      // assist target: closest to the reticle, prefer threats / EO targets and
      // targets that still need missiles
      const score = d / reach + (dist / range) * 0.3 - (e.def.threat || 0) * 0.15 - (e.tag ? 0.5 : 0) + (lockable ? 0 : 0.6);
      if (d < reach * 2 && score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.assistTarget = best;
    // drop invalid locks
    for (let i = this.locks.length - 1; i >= 0; i--) {
      const e = this.locks[i];
      const same = e.id === this.lockIds[i];
      const far = same && e.dist > this.rangeOf(e, Math.max(mul, this.lockMuls[i] ?? 1)) * 1.2;
      if (!same || !e.active || e.dead || e.dying || !e.lockable || far || e.offT > this.offscreenDrop) {
        if (same) {
          e.locks = Math.max(0, e.locks - 1);
          this.refresh(e);
        }
        this.locks.splice(i, 1);
        this.lockIds.splice(i, 1);
        this.lockMuls.splice(i, 1);
      }
    }
  }

  /**
   * Oldest valid pending lock → its enemy (moved from `locks` to about-to-fire:
   * the caller launches a missile at it right away, which bumps `e.incoming`),
   * or null when there is none.
   */
  consume() {
    while (this.locks.length) {
      const e = this.locks.shift();
      const id = this.lockIds.shift();
      this.lockMuls.shift();
      if (e.id !== id) continue; // slot was recycled
      e.locks = Math.max(0, e.locks - 1);
      if (e.active && !e.dead && !e.dying) return e;
    }
    return null;
  }

  isLocked(e) {
    return e.locks > 0;
  }
}
