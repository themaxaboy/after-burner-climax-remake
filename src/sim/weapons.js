import { Vector3 } from 'three';
import { interceptTime } from '../core/math.js';

const _dir = new Vector3();
const _lead = new Vector3();
const _rel = new Vector3();
const _tmp = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/**
 * M61-style Vulcan: unlimited ammo, bullets simulated as SoA typed arrays,
 * swept-segment hits against enemy spheres, aim-assist magnetism toward the
 * lead-intercept point of the best target near the reticle.
 */
export class Vulcan {
  constructor({ max = 320, hooks = {}, rng }) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.alive = new Uint8Array(max);
    this.count = 0; // packed count for rendering
    this.packedPos = new Float32Array(max * 3);
    this.packedVel = new Float32Array(max * 3);
    this.head = 0;
    this.rate = 32; // rounds / second (visual stream; real M61 is 100/s)
    this.speed = 1500;
    this.damage = 1;
    this.cool = 0;
    this.firing = false;
    this.hooks = hooks;
    this.rng = rng;
    this.assistCone = 5 * (Math.PI / 180);
    this.assistStrength = 0.85;
    this.aimTarget = null;
    this.side = 0;
  }

  reset() {
    this.alive.fill(0);
    this.count = 0;
  }

  /**
   * @param {number} dt world dt
   * @param {object} player
   * @param {Vector3} aimDir unit aim direction (reticle)
   * @param {object|null} assistTarget enemy to magnetise toward
   * @param {boolean} trigger
   * @param {EnemyManager} enemies
   */
  update(dt, player, aimDir, assistTarget, trigger, enemies) {
    this.firing = trigger;
    this.aimTarget = null;
    if (trigger) {
      this.cool -= dt;
      while (this.cool <= 0) {
        this.cool += 1 / this.rate;
        this._fire(player, aimDir, assistTarget);
      }
    } else if (this.cool < 0) this.cool = 0;

    // integrate + collide
    const P = this.pos, V = this.vel, L = this.life, A = this.alive;
    const list = enemies.list;
    for (let i = 0; i < this.max; i++) {
      if (!A[i]) continue;
      const o = i * 3;
      _a.set(P[o], P[o + 1], P[o + 2]);
      P[o] += V[o] * dt;
      P[o + 1] += V[o + 1] * dt;
      P[o + 2] += V[o + 2] * dt;
      L[i] -= dt;
      _b.set(P[o], P[o + 1], P[o + 2]);
      let hit = false;
      for (let k = 0; k < list.length; k++) {
        const e = list[k];
        if (!e.active || e.dead || e.dying) continue;
        const r = e.radius * 0.8;
        // quick reject
        const dx = e.pos.x - _b.x, dy = e.pos.y - _b.y, dz = e.pos.z - _b.z;
        const reach = r + this.speed * dt * 1.5 + 30;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        if (segSphere(_a, _b, e.pos, r)) {
          enemies.damage(e, this.damage, 'gun');
          this.hooks.onBulletHit?.(e, _b);
          hit = true;
          break;
        }
      }
      if (hit || L[i] <= 0 || P[o + 1] < -2) A[i] = 0;
    }
    // pack for rendering
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (!A[i]) continue;
      const o = i * 3, p = n * 3;
      this.packedPos[p] = P[o]; this.packedPos[p + 1] = P[o + 1]; this.packedPos[p + 2] = P[o + 2];
      this.packedVel[p] = V[o]; this.packedVel[p + 1] = V[o + 1]; this.packedVel[p + 2] = V[o + 2];
      n++;
    }
    this.count = n;
  }

  _fire(player, aimDir, target) {
    _dir.copy(aimDir);
    // magnetism: bend toward the lead-intercept point when close to the reticle
    if (target) {
      _rel.subVectors(target.pos, player.pos);
      _tmp.subVectors(target.vel, player.velocity);
      const t = interceptTime(_rel.x, _rel.y, _rel.z, _tmp.x, _tmp.y, _tmp.z, this.speed);
      if (t > 0) {
        _lead.copy(_rel).addScaledVector(_tmp, t).normalize();
        const ang = _lead.angleTo(aimDir);
        if (ang < this.assistCone) {
          const k = (1 - ang / this.assistCone) * this.assistStrength + (1 - this.assistStrength) * 0.3;
          _dir.lerp(_lead, Math.min(1, k)).normalize();
          this.aimTarget = target;
        }
      }
    }
    // small dispersion
    const spread = 0.0035;
    _dir.x += (this.rng.next() - 0.5) * spread;
    _dir.y += (this.rng.next() - 0.5) * spread;
    _dir.z += (this.rng.next() - 0.5) * spread;
    _dir.normalize();
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const o = i * 3;
    // alternate slightly left/right of the nose for a twin-stream look
    this.side = 1 - this.side;
    _c.copy(player.pos).addScaledVector(player.forward, 7);
    this.pos[o] = _c.x;
    this.pos[o + 1] = _c.y;
    this.pos[o + 2] = _c.z;
    const pv = player.velocity;
    this.vel[o] = pv.x + _dir.x * this.speed;
    this.vel[o + 1] = pv.y + _dir.y * this.speed;
    this.vel[o + 2] = pv.z + _dir.z * this.speed;
    this.life[i] = 1.6;
    this.alive[i] = 1;
    this.hooks.onFire?.(_c, _dir);
  }
}

const _d = new Vector3();
const _m = new Vector3();
/** Segment a→b intersects sphere (c, r)? */
export function segSphere(a, b, c, r) {
  _d.subVectors(b, a);
  _m.subVectors(a, c);
  const bq = _m.dot(_d);
  const cq = _m.lengthSq() - r * r;
  if (cq <= 0) return true;
  const aq = _d.lengthSq();
  if (aq < 1e-9) return false;
  const disc = bq * bq - aq * cq;
  if (disc < 0) return false;
  const t = (-bq - Math.sqrt(disc)) / aq;
  return t >= 0 && t <= 1;
}

/** Missile stock with regeneration (arcade: 50 missiles, ~2/s refill). */
export class MissileStock {
  constructor(max = 50, regen = 2) {
    this.max = max;
    this.regen = regen;
    this.count = max;
    this.acc = 0;
    this.infinite = false;
  }
  update(dt) {
    if (this.count >= this.max) {
      this.acc = 0;
      return;
    }
    this.acc += dt * this.regen;
    while (this.acc >= 1 && this.count < this.max) {
      this.count++;
      this.acc -= 1;
    }
  }
  take() {
    if (this.infinite) return true;
    if (this.count <= 0) return false;
    this.count--;
    return true;
  }
}
