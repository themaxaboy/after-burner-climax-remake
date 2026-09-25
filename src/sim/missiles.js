import { Vector3 } from 'three';
import { makeFrame } from './rail.js';
import { clamp, dampTo } from '../core/math.js';

const _R = new Vector3();
const _Vr = new Vector3();
const _W = new Vector3();
const _a = new Vector3();
const _t = new Vector3();
const _seg = new Vector3();
const _w = new Vector3();
const _f = makeFrame();
const TAU = Math.PI * 2;
// chase camera sits ~17 m behind the player; the view at depth r spans about
// ±SCR_X·r horizontally and ±SCR_Y·r vertically (conservative for narrow screens)
const CAM_BACK = 17;
const SCR_X = 0.8;
const SCR_Y = 0.55;

/**
 * Enemy missile ("cinematic homing") tuning. Enemy missiles aimed at the
 * player fly in player-relative rail space (ds, x, y):
 *  1. arc (arcMin..arcMax s): cubic Bezier from the launch offset (behind /
 *     beside / ahead / below) to an entry point entryMin..entryMax m ahead,
 *     within ±entryJitter m of the player, plus a decaying helix (amplitude
 *     helix m, ω rad/s, envelope exp(-t/helixDecay)) so it swirls across the
 *     screen trailing smoke. It cannot hit during the arc.
 *  2. terminal: closes at `closing` m/s relative (≈1.1 s on screen) with
 *     zero-effort-miss guidance capped at `g` (strong: `gStrong`) g; FAST
 *     throttle cuts the cap by `fastCut`. A barrel roll with
 *     `player.evadeWindow > 0` within `evadeRange` m makes it 'lost'.
 *  3. miss / lost: flies past and self-destructs after `destructAfter` s.
 * Caps: at most `cap` (low quality: `capLow`) alive, `gap` s between launches.
 */
export const ENEMY_MISSILE = {
  arcMin: 2.0,
  arcMax: 2.8,
  entryMin: 420,
  entryMax: 520,
  entryJitter: 30,
  helixMin: 120,
  helixMax: 220,
  omegaMin: 2.2,
  omegaMax: 3.4,
  helixDecay: 1.1,
  helixRamp: 0.3,
  closing: 400,
  closingStrong: 450,
  N: 3,
  g: 18,
  gStrong: 26,
  fastCut: 0.7,
  evadeRange: 260,
  fuse: 8,
  destructAfter: 0.6,
  lostDrift: 70,
  cap: 6,
  capLow: 4,
  gap: 1.0,
  radius: 4,
  life: 9
};

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

/** Squared distance from the origin to the segment (a → b) given as components. */
function segOriginDist2(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? -(ax * dx + ay * dy + az * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
  return x * x + y * y + z * z;
}

class Missile {
  constructor() {
    this.pos = new Vector3();
    this.prevPos = new Vector3();
    this.vel = new Vector3();
    this.active = false;
    this.bz = new Float64Array(12); // cinematic arc control points P0..P3 as (ds, dx, dy)
  }
}

/**
 * Pool of guided missiles for both sides.
 *  - player missiles: PN N=4, 30→60 g, boost 300→950 m/s, cinematic weave, 6–8 m fuse
 *  - enemy missiles at the player: cinematic arc + helix, then terminal homing
 *    (see ENEMY_MISSILE); broken by a barrel roll, flares or the vulcan.
 *    Without a rail/player in ctx they fall back to PN N=3, 18 g.
 */
export class MissileSystem {
  constructor({ max = 96, hooks = {}, rng }) {
    this.pool = Array.from({ length: max }, () => new Missile());
    this.list = [];
    this.hooks = hooks;
    this.rng = rng;
    this.decoys = []; // {pos, vel, t, life}
    for (let i = 0; i < 16; i++) this.decoys.push({ pos: new Vector3(), vel: new Vector3(), t: 0, life: 0, active: false, owner: '' });
    this.time = 0;
    this.enemyCap = ENEMY_MISSILE.cap;
    this.enemyGap = ENEMY_MISSILE.gap;
    this._lastEnemy = -1e9;
    /** enemy missiles made 'lost' by the evade window since the last read (enemyOps emits `evade`) */
    this.evaded = 0;
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

  /** May an enemy launch now? (alive cap + global spacing) */
  canLaunchEnemy() {
    return this.time - this._lastEnemy >= this.enemyGap - 1e-9 && this.count('enemy') < this.enemyCap;
  }

  /**
   * @param {'player'|'enemy'} owner
   * @param {Vector3} pos launch position
   * @param {Vector3} vel launch velocity (parent velocity + ejection)
   * @param {object|null} target entity with pos/vel/active (enemy) or the player
   * @param {object} opts {damage, speedBonus, strong, shooter (enemy id), rs (launcher rail s), force (ignore caps)}
   * @returns the missile, or null when an enemy launch is capped
   */
  launch(owner, pos, vel, target, opts = {}) {
    if (owner === 'enemy' && !opts.force && !this.canLaunchEnemy()) return null;
    const m = this._alloc();
    m.owner = owner;
    m.pos.copy(pos);
    m.prevPos.copy(pos);
    m.vel.copy(vel);
    m.target = target;
    m.targetId = target ? target.id : -1;
    m.t = 0;
    m.life = owner === 'player' ? 6 : ENEMY_MISSILE.life;
    m.damage = opts.damage ?? (owner === 'player' ? 12 : 1);
    m.boostFrom = vel.length();
    m.maxSpeed = owner === 'player' ? 950 : 480 + (opts.speedBonus || 0);
    m.N = owner === 'player' ? 4 : 3;
    m.g = owner === 'player' ? 30 : 18;
    m.fuse = owner === 'player' ? 7 : ENEMY_MISSILE.fuse;
    m.radius = ENEMY_MISSILE.radius;
    m.seed = this.rng.next() * 100;
    m.decoyed = null;
    m.lost = false;
    m.missed = false;
    m.strong = owner === 'enemy' && !!opts.strong;
    m.shooter = opts.shooter ?? null;
    m.speedBonus = opts.speedBonus || 0;
    m.dropT = owner === 'player' ? 0.18 : 0.1;
    m.id = (Missile.nextId = (Missile.nextId || 0) + 1);
    m._railS = undefined;
    // cinematic model: 1 = set up on the first update (needs ctx.rail/player), 2 = running, 0 = world PN
    m.cine = owner === 'enemy' && opts.cine !== false ? 1 : 0;
    m.hintS = opts.rs ?? NaN;
    m.phase = 0;
    m.endT = 0;
    m.ct = 0;
    m.lostT = 0;
    if (owner === 'enemy') this._lastEnemy = this.time;
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
      if (!m.active || m.decoyed || m.lost || m.missed) continue;
      const tracksOwner = owner === 'player' ? m.owner === 'enemy' : m.owner === 'player' && m.target && m.target.id === owner;
      if (tracksOwner && this.rng.next() < chance) {
        m.decoyed = this.decoys.find((d) => d.active) || null;
        if (m.decoyed) {
          m.cine = 0; // hand over to world guidance toward the decoy
          this.hooks.onDecoyed?.(m);
        }
      }
    }
  }

  /** A barrel roll inside the evade window breaks enemy locks within `radius`. */
  breakLocks(playerPos, radius = 160) {
    let n = 0;
    for (const m of this.list) {
      if (!m.active || m.owner !== 'enemy' || m.lost) continue;
      if (m.pos.distanceToSquared(playerPos) < radius * radius) {
        this._lose(m);
        n++;
        this.hooks.onDecoyed?.(m);
      }
    }
    return n;
  }

  /** Enemy missiles the vulcan can shoot (each has pos, vel, radius, active). */
  shootables(out = []) {
    out.length = 0;
    for (const m of this.list) if (m.active && m.owner !== 'player' && m.t >= m.dropT) out.push(m);
    return out;
  }

  /** Destroy an enemy missile (vulcan hit): onEnd reason 'shot'. */
  shootDown(m) {
    if (!m || !m.active || m.owner === 'player') return false;
    this._end(m, 'shot');
    return true;
  }

  _lose(m) {
    if (m.lost) return;
    m.lost = true;
    m.lostT = m.ct;
    if (m.cine === 2 && m.phase === 0) this._toTerminal(m);
    else if (!m.cine) m.life = Math.min(m.life, m.t + 2.5);
  }

  update(dt, ctx) {
    this.time += dt;
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
      if (!m) continue; // (an earlier end may have shortened the list)
      m.prevPos.copy(m.pos);
      m.t += dt;
      if (m.cine && this._cinematic(m, dt, ctx)) continue;
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
      if (m.t > m.life) this._end(m, m.lost && m.owner === 'enemy' ? 'lost' : 'timeout');
    }
  }

  // ------------------------------------------------------ cinematic homing
  /**
   * One step of an enemy missile in player-relative rail space.
   * Returns false to fall back to world guidance (no rail/player, decoyed).
   */
  _cinematic(m, dt, ctx) {
    const p = ctx.player, rail = ctx.rail;
    if (!p || !rail || m.target !== p || m.decoyed) {
      m.cine = 0;
      return false;
    }
    if (m.cine === 1) this._cineInit(m, p, rail);
    const E = ENEMY_MISSILE;
    m.ct += dt;
    // previous player-relative position (for the fuse sweep)
    const pds = m.ds, pdx = m.dx, pdy = m.dy;
    if (m.phase === 0) {
      const u = Math.min(m.ct / m.arcT, 1);
      const bz = m.bz;
      const iu = 1 - u;
      const b0 = iu * iu * iu, b1 = 3 * iu * iu * u, b2 = 3 * iu * u * u, b3 = u * u * u;
      let ds, dx, dy;
      if (m.scr) {
        // screen-space arc: bz = [ds0..ds3, qx0..qx3, qy0..qy3], q = fraction of the view at that depth
        ds = b0 * bz[0] + b1 * bz[1] + b2 * bz[2] + b3 * bz[3];
        const r = ds + CAM_BACK;
        dx = (b0 * bz[4] + b1 * bz[5] + b2 * bz[6] + b3 * bz[7]) * SCR_X * r;
        dy = (b0 * bz[8] + b1 * bz[9] + b2 * bz[10] + b3 * bz[11]) * SCR_Y * r;
      } else {
        ds = b0 * bz[0] + b1 * bz[3] + b2 * bz[6] + b3 * bz[9];
        dx = b0 * bz[1] + b1 * bz[4] + b2 * bz[7] + b3 * bz[10];
        dy = b0 * bz[2] + b1 * bz[5] + b2 * bz[8] + b3 * bz[11];
      }
      // decaying helix; its radius is given at 400 m and scales with the distance from the
      // camera so the swirl covers a similar part of the screen near and far. It fades out
      // completely by the end of the arc so the terminal phase starts clean.
      const tt = m.ct;
      const kf = u > 0.5 ? (u - 0.5) * 2 : 0;
      const fade = 1 - kf * kf * (3 - 2 * kf);
      const env =
        m.hA * (1 - Math.exp(-tt / E.helixRamp)) * Math.exp(-tt / E.helixDecay) * clamp((ds + CAM_BACK) / 400, 0.15, 3) * fade;
      const ang = m.hW * tt + m.hPh;
      dx += Math.cos(ang) * env;
      dy += Math.sin(ang) * env * 0.6;
      m.vds = (ds - m.ds) / dt;
      m.vdx = (dx - m.dx) / dt;
      m.vdy = (dy - m.dy) / dt;
      m.ds = ds;
      m.dx = dx;
      m.dy = dy;
      m.px = p.x;
      m.py = p.y;
      m.pvx = p.vx || 0;
      m.pvy = p.vy || 0;
      if (u >= 1) this._toTerminal(m);
    } else {
      const cl = m.strong ? E.closingStrong : E.closing;
      if (!m.lost && !m.missed) {
        m.vds = dampTo(m.vds, -cl, 3, dt);
        // zero-effort-miss guidance toward the (constant-velocity) predicted player position
        const tgo = Math.max(m.ds, 1) / Math.max(-m.vds, 60);
        const zx = m.x - p.x + (m.vx - p.vx) * tgo;
        const zy = m.y - p.y + (m.vy - p.vy) * tgo;
        let ax = (-E.N * zx) / (tgo * tgo);
        let ay = (-E.N * zy) / (tgo * tgo);
        const cap = (m.strong ? E.gStrong : E.g) * 9.81 * (ctx.enemyMissileG || 1) * (p.throttle > 0 ? E.fastCut : 1);
        const a = Math.hypot(ax, ay);
        if (a > cap) {
          ax *= cap / a;
          ay *= cap / a;
        }
        m.vx += ax * dt;
        m.vy += ay * dt;
      } else if (m.lost) {
        // broke lock: veer away from the player
        let ox = m.x - p.x, oy = m.y - p.y;
        const l = Math.hypot(ox, oy);
        if (l < 1) {
          ox = m.seed > 50 ? 1 : -1;
          oy = 0.3;
        } else {
          ox /= l;
          oy /= l;
        }
        m.vx += ox * E.lostDrift * dt;
        m.vy += oy * E.lostDrift * dt;
      }
      m.ds += m.vds * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.dx = m.x - p.x;
      m.dy = m.y - p.y;
    }

    // world position: rail frame at the player's s + ds, offset by the lateral coordinates
    rail.frameAt(p.s + m.ds, _f);
    const lx = m.phase === 0 ? p.x + m.dx : m.x;
    const ly = m.phase === 0 ? p.y + m.dy : m.y;
    m.pos.copy(_f.pos).addScaledVector(_f.R, lx).addScaledVector(_f.U, ly);
    // stay above the ground / sea
    const floor = (ctx.groundHeight ? ctx.groundHeight(m.pos.x, m.pos.z, m) : 0) + 6;
    if (m.pos.y < floor) {
      const lift = floor - m.pos.y;
      m.pos.y = floor;
      if (m.phase !== 0) {
        m.y += lift;
        m.dy += lift;
        if (m.vy < 0) m.vy = 0;
      }
    }
    if (m.t > dt * 1.5) m.vel.subVectors(m.pos, m.prevPos).divideScalar(Math.max(dt, 1e-4));

    // barrel roll inside the evade window: lock broken
    if (!m.lost && !m.missed && p.evadeWindow > 0) {
      const r = E.evadeRange;
      if (m.ds * m.ds + m.dx * m.dx + m.dy * m.dy < r * r) {
        this._lose(m);
        this.evaded++;
        this.hooks.onEvade?.(m);
      }
    }
    // fuse (terminal only: the arc never hits) — sweep in player-relative space
    if (m.phase === 1 && !m.lost && !m.missed && p.alive !== false) {
      const fr = m.fuse;
      if (segOriginDist2(pds, pdx, pdy, m.ds, m.dx, m.dy) < fr * fr) {
        this._hit(m, p);
        return true;
      }
    }
    // overshoot → self-destruct shortly after
    if (m.phase === 1 && !m.missed && m.ds < -12) {
      m.missed = true;
      m.endT = E.destructAfter;
    }
    if (m.lost && !m.missed && m.ct - m.lostT > 1.6) {
      m.missed = true;
      m.endT = E.destructAfter;
    }
    if (m.missed) {
      m.endT -= dt;
      if (m.endT <= 0) {
        this._end(m, m.lost ? 'lost' : 'timeout');
        return true;
      }
    }
    if (m.t > m.life) this._end(m, m.lost ? 'lost' : 'timeout');
    return true;
  }

  _cineInit(m, p, rail) {
    const E = ENEMY_MISSILE;
    const rng = this.rng;
    // launch point in rail space
    const s = Number.isFinite(m.hintS) ? m.hintS : rail.project(m.pos, p.s, 6000);
    rail.frameAt(s, _f);
    _t.subVectors(m.pos, _f.pos);
    const ds0 = s - p.s;
    const dx0 = _t.dot(_f.R) - p.x;
    const dy0 = _t.dot(_f.U) - p.y;
    // launch velocity relative to the player, in rail axes
    const vds0 = m.vel.dot(_f.T) - p.speed;
    const vdx0 = m.vel.dot(_f.R) - (p.vx || 0);
    const vdy0 = m.vel.dot(_f.U) - (p.vy || 0);
    const cl = m.strong ? E.closingStrong : E.closing;
    const dsE = rng.range(E.entryMin, E.entryMax);
    const T = clamp(E.arcMin + Math.abs(ds0 - dsE) / 3000 + rng.next() * 0.35, E.arcMin, E.arcMax) * (m.strong ? 0.94 : 1);
    const J = E.entryJitter;
    const jx = rng.range(-J, J), jy = rng.range(-J, J) * 0.6;
    const side = dx0 > 25 ? 1 : dx0 < -25 ? -1 : rng.sign();
    const k3 = T / 3;
    const bz = m.bz;
    // the end tangent comes back at the camera at the terminal closing speed
    const ds2 = dsE + cl * k3 * rng.range(0.8, 1.0);
    m.scr = ds0 > 60;
    if (m.scr) {
      // launched in front of the camera: design the path in screen space (fractions of the
      // view at each depth) so it always swings wide across the screen, loops back through the
      // centre and enters just ahead of the player
      const r0 = ds0 + CAM_BACK, rE = dsE + CAM_BACK;
      const qx0 = clamp(dx0 / (SCR_X * r0), -1.4, 1.4), qy0 = clamp(dy0 / (SCR_Y * r0), -1.4, 1.4);
      const qxE = jx / (SCR_X * rE), qyE = jy / (SCR_Y * rE);
      bz[0] = ds0;
      bz[1] = ds0 > dsE + 150 ? rng.range(650, 900) + (ds0 - 800) * rng.range(0.05, 0.2) : Math.max(ds0, dsE) + rng.range(120, 260);
      bz[2] = ds2;
      bz[3] = dsE;
      bz[4] = qx0;
      // usually swing out to the far side so the missile crosses the whole screen
      const sw = Math.abs(qx0) > 0.1 && rng.next() < 0.6 ? -Math.sign(qx0) : side;
      bz[5] = qx0 * 0.3 + sw * rng.range(1.1, 1.7);
      bz[6] = qxE - sw * rng.range(0.04, 0.1);
      bz[7] = qxE;
      bz[8] = qy0;
      bz[9] = Math.max(qy0 * 0.3, 0) + rng.range(0.45, 0.95);
      bz[10] = qyE + rng.range(0.02, 0.08);
      bz[11] = qyE;
    } else {
      // from behind: overtake first (on the launcher's side, climbing), then curl back in
      bz[0] = ds0;
      bz[1] = dx0;
      bz[2] = dy0;
      bz[3] = vds0 * k3 * 0.5 + rng.range(150, 300); // just past the player
      bz[4] = dx0 + vdx0 * k3 * 0.5 + side * rng.range(50, 120);
      bz[5] = dy0 + vdy0 * k3 * 0.5 + rng.range(20, 70) + (dy0 < -40 ? rng.range(120, 220) : 0);
      bz[6] = ds2;
      bz[7] = jx + rng.sign() * rng.range(30, 70);
      bz[8] = jy + rng.range(15, 45);
      bz[9] = dsE;
      bz[10] = jx;
      bz[11] = jy;
    }
    m.arcT = T;
    m.dsE = dsE;
    m.hA = rng.range(E.helixMin, E.helixMax) * (m.strong ? 1.15 : 1);
    m.hW = rng.range(E.omegaMin, E.omegaMax) * rng.sign();
    m.hPh = rng.next() * TAU;
    m.ds = ds0;
    m.dx = dx0;
    m.dy = dy0;
    m.vds = vds0;
    m.vdx = vdx0;
    m.vdy = vdy0;
    m.x = p.x + dx0;
    m.y = p.y + dy0;
    m.vx = vdx0 + (p.vx || 0);
    m.vy = vdy0 + (p.vy || 0);
    m.px = p.x;
    m.py = p.y;
    m.pvx = p.vx || 0;
    m.pvy = p.vy || 0;
    m.ct = 0;
    m.lostT = 0;
    m.phase = 0;
    m.cine = 2;
  }

  /** Arc → terminal: switch to absolute lateral coordinates (the player can now dodge it). */
  _toTerminal(m) {
    m.phase = 1;
    m.x = m.px + m.dx;
    m.y = m.py + m.dy;
    m.vx = m.vdx + m.pvx;
    m.vy = m.vdy + m.pvy;
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

  /** Time until an enemy missile reaches the player (s), or Infinity when it is no threat. */
  timeToGo(m, playerPos, playerVel) {
    if (!m.active || m.owner === 'player' || m.lost || m.missed || m.decoyed || m.t < m.dropT) return Infinity;
    if (m.cine === 2) {
      const E = ENEMY_MISSILE;
      const cl = m.strong ? E.closingStrong : E.closing;
      if (m.phase === 0) return m.arcT - m.ct + m.dsE / cl;
      return m.ds > 0 ? m.ds / Math.max(-m.vds, 60) : Infinity;
    }
    _R.subVectors(playerPos, m.pos);
    const d = _R.length();
    _Vr.subVectors(m.vel, playerVel);
    const closing = _Vr.dot(_R) / Math.max(d, 1);
    return closing > 0 ? d / closing : Infinity;
  }

  /** Closest enemy missile threat to the player: {m, tgo, strong} or null. */
  threat(playerPos, playerVel) {
    let best = null, bestT = Infinity;
    for (const m of this.list) {
      if (m.owner === 'player') continue;
      const tgo = this.timeToGo(m, playerPos, playerVel);
      if (tgo < bestT) {
        bestT = tgo;
        best = m;
      }
    }
    if (!best) return null;
    const r = (this._threat ||= { m: null, tgo: 0, strong: false });
    r.m = best;
    r.tgo = bestT;
    r.strong = !!best.strong;
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
    this.evaded = 0;
  }
}
