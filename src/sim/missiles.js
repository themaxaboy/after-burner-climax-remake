import { Vector3 } from 'three';

const _R = new Vector3();
const _Vr = new Vector3();
const _W = new Vector3();
const _a = new Vector3();
const _t = new Vector3();
const _seg = new Vector3();
const _w = new Vector3();

/**
 * True proportional navigation acceleration (world units).
 *   Ω = (R × Vr) / |R|²      (line-of-sight rotation rate)
 *   a = N · (Ω × Vm)
 * Returns acceleration in `out`, clamped to maxAccel.
 */
export function pnAccel(mPos, mVel, tPos, tVel, N, maxAccel, out) {
  _R.subVectors(tPos, mPos);
  _Vr.subVectors(tVel, mVel);
  const r2 = Math.max(_R.lengthSq(), 1);
  _W.crossVectors(_R, _Vr).divideScalar(r2);
  out.crossVectors(_W, mVel).multiplyScalar(N);
  const l = out.length();
  if (l > maxAccel) out.multiplyScalar(maxAccel / l);
  return out;
}

/** Distance from point c to segment ab (squared). */
export function segPointDist2(a, b, c) {
  _seg.subVectors(b, a);
  const len2 = _seg.lengthSq();
  let t = len2 > 0 ? _w.subVectors(c, a).dot(_seg) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = a.x + _seg.x * t - c.x, y = a.y + _seg.y * t - c.y, z = a.z + _seg.z * t - c.z;
  return x * x + y * y + z * z;
}

class Missile {
  constructor() {
    this.pos = new Vector3();
    this.prevPos = new Vector3();
    this.vel = new Vector3();
    this.active = false;
  }
}

/**
 * Pool of guided missiles for both sides.
 *  - player missiles: PN N=4, 30→60 g, boost 300→950 m/s, cinematic weave, 6–8 m fuse
 *  - enemy missiles: PN N=3, 18 g, slower; can be broken by a barrel roll or flares
 */
export class MissileSystem {
  constructor({ max = 96, hooks = {}, rng }) {
    this.pool = Array.from({ length: max }, () => new Missile());
    this.list = [];
    this.hooks = hooks;
    this.rng = rng;
    this.decoys = []; // {pos, vel, t, life}
    for (let i = 0; i < 16; i++) this.decoys.push({ pos: new Vector3(), vel: new Vector3(), t: 0, life: 0, active: false, owner: '' });
  }

  _alloc() {
    let m = this.pool.find((p) => !p.active);
    if (!m) {
      // recycle the oldest
      m = this.list.shift();
      this._dropIncoming(m);
      this.hooks.onEnd?.(m, 'recycle');
    }
    m.active = true;
    this.list.push(m);
    return m;
  }

  /**
   * @param {'player'|'enemy'} owner
   * @param {Vector3} pos launch position
   * @param {Vector3} vel launch velocity (parent velocity + ejection)
   * @param {object|null} target entity with pos/vel/active (enemy) or the player
   */
  launch(owner, pos, vel, target, opts = {}) {
    const m = this._alloc();
    m.owner = owner;
    m.pos.copy(pos);
    m.prevPos.copy(pos);
    m.vel.copy(vel);
    m.target = target;
    m.targetId = target ? target.id : -1;
    m.t = 0;
    m.life = owner === 'player' ? 6 : 7.5;
    m.damage = opts.damage ?? (owner === 'player' ? 12 : 1);
    m.boostFrom = vel.length();
    m.maxSpeed = owner === 'player' ? 950 : 480 + (opts.speedBonus || 0);
    m.N = owner === 'player' ? 4 : 3;
    m.g = owner === 'player' ? 30 : 18;
    m.fuse = owner === 'player' ? 7 : 9;
    m.seed = this.rng.next() * 100;
    m.decoyed = null;
    m.lost = false;
    m.dropT = owner === 'player' ? 0.18 : 0.1;
    m.id = (Missile.nextId = (Missile.nextId || 0) + 1);
    m._railS = undefined;
    if (target && owner === 'player') target.incoming = (target.incoming || 0) + 1;
    this.hooks.onLaunch?.(m);
    return m;
  }

  /** Flares: create decoys near `pos`; enemy missiles tracking `ownerTarget` may divert. */
  flares(pos, vel, owner, chance = 0.85) {
    let n = 0;
    for (const d of this.decoys) {
      if (d.active) continue;
      d.active = true;
      d.owner = owner;
      d.pos.copy(pos);
      d.vel.copy(vel).multiplyScalar(0.6).add(_t.set(this.rng.range(-40, 40), -25 - this.rng.range(0, 20), this.rng.range(-20, 20)));
      d.t = 0;
      d.life = 2.5;
      if (++n >= 4) break;
    }
    for (const m of this.list) {
      if (!m.active || m.decoyed) continue;
      const tracksOwner = owner === 'player' ? m.owner === 'enemy' : m.owner === 'player' && m.target && m.target.id === owner;
      if (tracksOwner && this.rng.next() < chance) {
        m.decoyed = this.decoys.find((d) => d.active) || null;
        if (m.decoyed) this.hooks.onDecoyed?.(m);
      }
    }
  }

  /** A barrel roll inside the evade window breaks enemy locks within `radius`. */
  breakLocks(playerPos, radius = 160) {
    let n = 0;
    for (const m of this.list) {
      if (!m.active || m.owner !== 'enemy' || m.lost) continue;
      if (m.pos.distanceToSquared(playerPos) < radius * radius) {
        m.lost = true;
        n++;
        this.hooks.onDecoyed?.(m);
      }
    }
    return n;
  }

  update(dt, ctx) {
    for (const d of this.decoys) {
      if (!d.active) continue;
      d.t += dt;
      d.vel.y -= 9.81 * dt;
      d.pos.addScaledVector(d.vel, dt);
      if (d.t > d.life) d.active = false;
    }
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const m = list[i];
      m.prevPos.copy(m.pos);
      m.t += dt;
      const tgt = m.target;
      // target lost?
      if (tgt && m.owner === 'player' && (!tgt.active || tgt.id !== m.targetId || tgt.dead)) {
        m.target = null;
        m.lost = true;
      }
      // boost profile
      const sp = m.vel.length();
      const boostK = Math.min(1, Math.max(0, (m.t - m.dropT) / 0.7));
      const targetSpeed = m.t < m.dropT ? sp : m.boostFrom + (m.maxSpeed - m.boostFrom) * boostK;
      let newSp = sp + (targetSpeed - sp) * Math.min(1, dt * 6);
      if (m.t < m.dropT) {
        m.vel.y -= 9.81 * 2.2 * dt; // ejection drop
      } else {
        // guidance
        let tPos = null, tVel = null;
        if (m.decoyed && m.decoyed.active) {
          tPos = m.decoyed.pos;
          tVel = m.decoyed.vel;
        } else if (!m.lost && tgt) {
          tPos = m.owner === 'player' ? tgt.lockPos || tgt.pos : tgt.pos;
          tVel = tgt.vel;
        }
        if (tPos) {
          const gRamp = m.owner === 'player' ? m.g + Math.min(1, m.t / 2) * 30 : m.g * (ctx.enemyMissileG || 1);
          const nEff = m.owner === 'enemy' ? m.N * (ctx.enemyN || 1) : m.N;
          pnAccel(m.pos, m.vel, tPos, tVel, nEff, gRamp * 9.81, _a);
          // terminal pure-pursuit blend so player missiles effectively never miss
          if (m.owner === 'player') {
            const d = m.pos.distanceTo(tPos);
            const tgo = d / Math.max(newSp, 1);
            if (tgo < 1.2 || m.t > 3.5) {
              _t.subVectors(tPos, m.pos).normalize().multiplyScalar(newSp);
              m.vel.lerp(_t, Math.min(1, dt * (m.t > 3.5 ? 12 : 5)));
            } else {
              // cinematic weave while far
              const w = 22 * Math.min(1, (tgo - 1.2) / 1.5);
              _t.set(Math.sin(m.t * 7 + m.seed), Math.cos(m.t * 6.1 + m.seed * 1.3), 0).multiplyScalar(w);
              _a.add(_t);
            }
          }
          m.vel.addScaledVector(_a, dt);
          // fuse
          const fuseR = m.fuse + (tgt && tgt.radius ? tgt.radius * 0.5 : 0);
          if (!m.decoyed && !m.lost && tgt && segPointDist2(m.prevPos, _t.copy(m.pos).addScaledVector(m.vel, dt), tPos) < fuseR * fuseR) {
            m.pos.copy(tPos);
            this._hit(m, tgt);
            continue;
          }
          if (m.decoyed && m.pos.distanceToSquared(tPos) < 100) {
            this._end(m, 'decoy');
            continue;
          }
        }
      }
      m.vel.setLength(newSp);
      m.pos.addScaledVector(m.vel, dt);
      if (ctx.groundHeight && (m.t * 120) % 3 < 1 && m.pos.y < ctx.groundHeight(m.pos.x, m.pos.z, m)) {
        this._end(m, 'ground');
        continue;
      }
      if (m.pos.y < 0 && !ctx.groundHeight) {
        this._end(m, 'water');
        continue;
      }
      if (m.t > m.life) this._end(m, 'timeout');
    }
  }

  _hit(m, tgt) {
    this.hooks.onHit?.(m, tgt);
    this._end(m, 'hit');
  }

  _dropIncoming(m) {
    if (m.owner === 'player' && m.target && m.target.id === m.targetId && m.target.incoming > 0) m.target.incoming--;
    m.target = null;
  }

  _end(m, reason) {
    if (!m.active) return;
    m.active = false;
    this._dropIncoming(m);
    this.hooks.onEnd?.(m, reason);
    const i = this.list.indexOf(m);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** Closest enemy missile threat to the player: {m, tgo} or null. */
  threat(playerPos, playerVel) {
    let best = null, bestT = Infinity;
    for (const m of this.list) {
      if (!m.active || m.owner !== 'enemy' || m.lost || m.decoyed || m.t < m.dropT) continue;
      _R.subVectors(playerPos, m.pos);
      const d = _R.length();
      _Vr.subVectors(m.vel, playerVel);
      const closing = _Vr.dot(_R) / Math.max(d, 1);
      if (closing <= 0) continue;
      const tgo = d / closing;
      if (tgo < bestT) {
        bestT = tgo;
        best = m;
      }
    }
    if (!best) return null;
    const r = (this._threat ||= { m: null, tgo: 0 });
    r.m = best;
    r.tgo = bestT;
    return r;
  }

  count(owner) {
    let n = 0;
    for (const m of this.list) if (m.active && m.owner === owner) n++;
    return n;
  }

  reset() {
    for (const m of this.list) {
      m.active = false;
      this._dropIncoming(m);
      this.hooks.onEnd?.(m, 'reset');
    }
    this.list.length = 0;
    for (const d of this.decoys) d.active = false;
  }
}
