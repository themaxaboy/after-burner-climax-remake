import { Matrix4, Quaternion, Vector3 } from 'three';
import { ENEMY_TYPES } from './enemyTypes.js';
import { clamp, dampTo, lerp, smoothstep } from '../core/math.js';
import { makeFrame } from './rail.js';

const _f = makeFrame();
const _v = new Vector3();
const _fw = new Vector3();
const _rt = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _z = new Vector3(0, 0, 1);

let NEXT_ID = 1;

/**
 * Behaviour tunables (see CONTRACTS §5 and src/sim/waves.js).
 *  headOn: closing speed on top of the player's (m/s), weave amplitude (m), share that dodges a ram
 *  rammer: lateral acceleration cap (m/s²) and lead (0..1) — a sideways move of > ~45 m in the last
 *          1.5 s before impact makes it miss
 *  overtakeClose: relative speed (m/s) and lateral pass distance from the player (m)
 *  chaser: hold distance behind the player (m), gun burst interval (s), time before overtaking (s)
 */
export const ENEMY_TUNING = {
  headOn: { spd: [180, 240], weave: [20, 60], dodgeShare: 0.5, fire: [650, 1600] },
  rammer: { spd: [190, 240], accel: 28, gain: 3, lead: 0.5 },
  overtakeClose: { vrel: [170, 195], pass: [20, 40], handover: 380 },
  swarmPass: { fire: [450, 1300] },
  chaser: { hold: -300, gun: [2.6, 3.8], dur: [8, 11] },
  passBehind: -320 // rail-anchored passers are removed this far behind the player
};

// behaviours whose aircraft end up behind the player for good: despawn early (off screen)
const PASSERS = new Set(['headOn', 'rammer', 'swarmPass', 'crossing', 'strafe', 'formation', 'hover']);

export class Enemy {
  constructor() {
    this.id = 0;
    this.active = false;
    this.pos = new Vector3();
    this.prevPos = new Vector3();
    this.vel = new Vector3();
    this.quat = new Quaternion();
    this.prevQuat = new Quaternion();
    this.lockPos = new Vector3(); // point used for lock-on / missiles
    this.fallVel = new Vector3();
    this.spin = new Vector3();
    this.b = {}; // behaviour scratch state
  }
}

/**
 * Owns every enemy: spawning from the stage director, behaviour updates in
 * rail-relative space (so authored patterns follow the stage path), dying
 * sequences and world-space pose for rendering / collisions.
 */
export class EnemyManager {
  constructor({ max = 96, hooks = {}, rng }) {
    this.pool = Array.from({ length: max }, () => new Enemy());
    this.list = []; // active enemies (dense)
    this.hooks = hooks;
    this.rng = rng;
    this.spawned = 0; // total counted for down rate
    this.killed = 0;
    this.escaped = 0;
    this.difficulty = { aggression: 1, fireRate: 1 };
  }

  reset() {
    for (const e of this.list) e.active = false;
    this.list.length = 0;
    this.spawned = this.killed = this.escaped = 0;
  }

  /**
   * @param {string} type key of ENEMY_TYPES
   * @param {object} o {behavior, rs, rx, ry, world:{x,y,z}, heading, tag, delay, params}
   */
  spawn(type, o) {
    const def = ENEMY_TYPES[type];
    if (!def) throw new Error(`unknown enemy type ${type}`);
    const e = this.pool.find((p) => !p.active);
    if (!e) return null;
    e.id = NEXT_ID++;
    e.active = true;
    e.type = type;
    e.def = def;
    e.hp = def.hp * (o.hpMul || 1);
    e.maxHp = e.hp;
    e.radius = def.radius * (def.scale || 1);
    e.behavior = BEHAVIORS[o.behavior || 'headOn'];
    if (!e.behavior) throw new Error(`unknown behavior ${o.behavior}`);
    e.behaviorName = o.behavior || 'headOn';
    e.anchor = def.anchor || o.anchor || 'rail';
    e.tag = o.tag || null;
    e.t = 0;
    e.rs = o.rs || 0;
    e.rx = o.rx || 0;
    e.ry = o.ry || 0;
    e.rvs = 0;
    e.bank = 0;
    e.dying = 0;
    e.dead = false;
    e.flash = 0;
    e.locks = 0;
    e.incoming = 0;
    e.fireCd = 0.6 + this.rng.next() * 1.2;
    e.shotsFired = 0;
    e.rammer = false;
    e.noseLight = 0; // 0|1 blinking warning light (rammers) for the renderer
    e.nearD = Infinity; // closest approach to the player (enemyOps near-miss)
    e.nearDone = false;
    e.countable = o.countable !== false;
    e.params = o.params || {};
    e.lockable = def.lockable;
    e.visible = def.model !== 'none';
    e.invuln = !!o.invuln;
    e.smoke = null;
    e.onScreen = false;
    e.escapeTimer = o.timeLimit || 0;
    e.escaped = false;
    e.heading = o.heading || 0;
    e._railS = undefined;
    for (const k in e.b) delete e.b[k];
    if (e.anchor === 'world' && o.world) e.pos.set(o.world.x, o.world.y, o.world.z);
    const par = o.params?.parent;
    if (par && o.params.local) {
      const l = o.params.local;
      e.pos.set(l[0], l[1], l[2]).applyQuaternion(par.quat).add(par.pos);
    }
    e.prevPos.copy(e.pos);
    e.vel.set(0, 0, 0);
    this.list.push(e);
    if (e.countable) this.spawned++;
    this.hooks.onSpawn?.(e);
    return e;
  }

  despawn(e, escaped = false) {
    if (!e.active) return;
    e.active = false;
    if (escaped) {
      e.escaped = true;
      this.escaped++;
      this.hooks.onEscape?.(e);
    }
    this.hooks.onDespawn?.(e);
    const i = this.list.indexOf(e);
    if (i >= 0) {
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
    }
  }

  /** Apply damage; returns true when this hit destroyed the enemy. */
  damage(e, amount, source = 'gun') {
    if (!e.active || e.dying || e.dead) return false;
    if (e.invuln) {
      e.flash = 0.4;
      this.hooks.onDeflect?.(e, amount, source);
      return false;
    }
    e.hp -= amount;
    e.flash = 1;
    this.hooks.onHit?.(e, amount, source);
    if (e.hp <= 0) {
      this.kill(e, source);
      return true;
    }
    return false;
  }

  kill(e, source) {
    if (e.dead) return;
    e.dead = true;
    e.lockable = false;
    if (e.countable) this.killed++;
    const big = e.def.big;
    // fighters: 35% chance of a burning fall before exploding
    if (e.def.air && !big && this.rng.next() < 0.35) {
      e.dying = 1.1 + this.rng.next() * 0.6;
      e.fallVel.copy(e.vel).multiplyScalar(0.8);
      e.spin.set(this.rng.range(-2, 2), this.rng.range(-1, 1), this.rng.range(4, 9) * this.rng.sign());
      this.hooks.onKill?.(e, source, 'fall');
    } else if (big) {
      e.dying = 2.4;
      e.fallVel.copy(e.vel).multiplyScalar(0.9);
      e.spin.set(0.2, 0, 0.6 * this.rng.sign());
      this.hooks.onKill?.(e, source, 'big');
    } else {
      this.hooks.onKill?.(e, source, 'instant');
      this.hooks.onExplode?.(e, e.def.sea ? 'water' : e.def.ground ? 'ground' : 'air');
      this.despawn(e);
    }
  }

  update(dt, ctx) {
    this.stepCount = (this.stepCount || 0) + 1;
    const list = this.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.prevPos.copy(e.pos);
      e.prevQuat.copy(e.quat);
      e.t += dt;
      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 8);
      if (e.dying > 0) {
        this._updateDying(e, dt, ctx);
        continue;
      }
      e.behavior(e, dt, ctx, this);
      if (!e.active) continue;
      if (e.anchor === 'rail') {
        ctx.rail.frameAt(e.rs, _f);
        e.pos.copy(_f.pos).addScaledVector(_f.R, e.rx).addScaledVector(_f.U, e.ry);
        _up.copy(_f.U);
      } else {
        _up.set(0, 1, 0);
      }
      // velocity (smoothed finite difference) and orientation
      if (e.t > dt * 1.5) {
        _v.subVectors(e.pos, e.prevPos).divideScalar(Math.max(dt, 1e-4));
        e.vel.lerp(_v, 0.35);
      }
      this._orient(e, dt, _up);
      if (e.t <= dt * 1.01) {
        // first step for this (pooled) slot: no interpolation from the previous occupant
        e.prevPos.copy(e.pos);
        e.prevQuat.copy(e.quat);
      }
      const lo = e.def.lockOffset;
      if (lo) e.lockPos.set(e.pos.x + lo[0], e.pos.y + lo[1], e.pos.z + lo[2]);
      else e.lockPos.copy(e.pos);
      // escape / despawn when far behind the player or far ahead
      // (attached sub-parts are removed with their parent; grace period after spawning)
      if (e.behaviorName !== 'attached' && e.t > 1.5) {
        const rel = this.relS(e, ctx);
        if (rel < -900 || rel > 9000 || (rel < ENEMY_TUNING.passBehind && e.anchor === 'rail' && PASSERS.has(e.behaviorName))) {
          this.despawn(e, e.def.big || e.tag != null);
        }
      }
    }
  }

  /** Rail-relative distance ahead of the player. */
  relS(e, ctx) {
    if (e.anchor === 'rail') return e.rs - ctx.player.s;
    if (e.b.railS === undefined || (this.stepCount + e.id) % 30 === 0) {
      e.b.railS = ctx.rail.project(e.pos, e.b.railS ?? ctx.player.s + 1500, e.b.railS === undefined ? 8000 : 600);
    }
    return e.b.railS - ctx.player.s;
  }

  _orient(e, dt, up) {
    if (e.def.air === false) {
      // ground/sea units: heading only
      _fw.set(Math.sin(e.heading), 0, -Math.cos(e.heading));
      _rt.crossVectors(_fw, up).normalize();
      _up.crossVectors(_rt, _fw);
      _m.makeBasis(_rt, _up, _fw.negate());
      e.quat.setFromRotationMatrix(_m);
      return;
    }
    const sp = e.vel.length();
    if (sp < 1) return;
    _fw.copy(e.vel).divideScalar(sp);
    // bank from lateral acceleration (turn) = derivative of heading
    const prevFw = e.b.pf || (e.b.pf = new Vector3().copy(_fw));
    _v.crossVectors(prevFw, _fw);
    const turn = _v.dot(up) / Math.max(dt, 1e-4);
    prevFw.copy(_fw);
    const bankTarget = clamp(-turn * 1.4, -1.3, 1.3) + (e.b.bankBias || 0);
    e.bank = dampTo(e.bank, bankTarget, 4, dt);
    _rt.crossVectors(_fw, up);
    if (_rt.lengthSq() < 1e-6) _rt.set(1, 0, 0);
    _rt.normalize();
    _up.crossVectors(_rt, _fw).normalize();
    _m.makeBasis(_rt, _up, _v.copy(_fw).negate());
    e.quat.setFromRotationMatrix(_m);
    _q.setFromAxisAngle(_z, -e.bank - (e.b.roll || 0));
    e.quat.multiply(_q);
  }

  _updateDying(e, dt, ctx) {
    e.dying -= dt;
    e.fallVel.y -= 9.81 * dt * 2.2;
    e.fallVel.multiplyScalar(1 - 0.25 * dt);
    e.pos.addScaledVector(e.fallVel, dt);
    const ang = e.spin.length() * dt;
    if (ang > 0) {
      _q.setFromAxisAngle(_v.copy(e.spin).normalize(), ang);
      e.quat.multiply(_q);
    }
    e.lockPos.copy(e.pos);
    this.hooks.onDyingTick?.(e, dt);
    const seaHit = ctx.groundHeight ? e.pos.y < ctx.groundHeight(e.pos.x, e.pos.z, e) + 2 : e.pos.y < 2;
    if (e.dying <= 0 || seaHit) {
      e.dying = 0;
      this.hooks.onExplode?.(e, seaHit ? (ctx.groundHeight ? 'ground' : 'water') : e.def.big ? 'big' : 'air');
      this.despawn(e);
    }
  }

  forEachLockable(fn) {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.active && e.lockable && !e.dead) fn(e);
    }
  }

  findByTag(tag) {
    return this.list.find((e) => e.tag === tag && e.active) || null;
  }
}

// ---------------------------------------------------------------- behaviours
// Each behaviour mutates rail-space state (rs, rx, ry) or world pos, may fire.
// ctx: {player, rail, rng, fireMissile(e, target?), fireGun(e), difficulty}

function tryFire(e, dt, ctx, mgr, minRel, maxRel) {
  const rel = e.anchor === 'rail' ? e.rs - ctx.player.s : mgr.relS(e, ctx);
  e.fireCd -= dt * mgr.difficulty.fireRate;
  if (e.fireCd > 0 || rel < minRel || rel > maxRel || e.dead) return;
  const r = ctx.rng.next();
  const def = e.def;
  const agg = mgr.difficulty.aggression;
  const pm = def.missile * 0.7 * agg;
  if (r < pm) {
    // enemy missiles are capped globally (count + spacing): fall back to the gun
    if (!ctx.fireMissile(e) && def.gun > 0) ctx.fireGun(e);
  } else if (r < pm + def.gun * 0.6 * agg) ctx.fireGun(e);
  e.shotsFired++;
  e.fireCd = 2.2 + ctx.rng.next() * 2.5;
}

/**
 * Smooth weave around (x0, y0) that starts from the current position (no
 * jump). Formation members share `params.ph`, so a group weaves in step.
 */
function weave(e, dt, ampX, ampY, freq) {
  const b = e.b;
  if (b.ph === undefined) b.ph = e.params.ph ?? (e.id * 2.39996) % 6.2832;
  if (b.x0 === undefined) {
    b.x0 = e.rx;
    b.y0 = e.ry;
    b.wt0 = e.t;
  } else if (b.wt0 === undefined) b.wt0 = e.t;
  const t = e.t - b.wt0;
  e.rx = b.x0 + (Math.sin(t * freq + b.ph) - Math.sin(b.ph)) * ampX;
  e.ry = b.y0 + (Math.cos(t * freq * 0.7 + b.ph) - Math.cos(b.ph)) * ampY;
}

/** Aircraft overtaking from behind never ram the player unseen: keep `sep` m of lateral clearance. */
function keepClear(e, p, rel, sep, dt) {
  if (rel < -120 || rel > 50) return;
  const dx = e.rx - p.x, dy = e.ry - p.y;
  if (dx * dx + dy * dy >= sep * sep) return;
  const sx = dx === 0 ? (e.id & 1 ? 1 : -1) : Math.sign(dx);
  const sy = dy >= 0 ? 1 : -0.5;
  e.rx += sx * 90 * dt;
  e.ry += sy * 30 * dt;
  if (e.b.x0 !== undefined) {
    e.b.x0 += sx * 90 * dt;
    e.b.y0 += sy * 30 * dt;
  }
}

/** Switch to `overtake` holding ahead of the player (phase 1: weave, then break or loop back). */
function toOvertakeAhead(e, ctx) {
  e.behavior = BEHAVIORS.overtake;
  e.behaviorName = 'overtake';
  const b = e.b;
  for (const k in b) if (k !== 'pf') delete b[k];
  b.init = 1;
  b.phase = 1;
  b.pt = 0;
  b.loop = ctx.rng.next() < 0.45;
  b.x0 = e.rx;
  b.y0 = e.ry;
}

export const BEHAVIORS = {
  /**
   * Oncoming fighter: rushes at the player (+180–240 m/s on top of the
   * player's speed from 1300–1800 m: ~3.5 s on screen), weaves 20–60 m, may
   * fire once, passes. Only half of them sidestep a ram.
   */
  headOn(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    const T = ENEMY_TUNING.headOn;
    if (!b.init) {
      b.init = 1;
      const pr = e.params;
      b.spd = pr.spd ?? (T.spd[0] + ctx.rng.next() * (T.spd[1] - T.spd[0])) * (e.def.speed / 210);
      b.ax = pr.ax ?? T.weave[0] + ctx.rng.next() * (T.weave[1] - T.weave[0]);
      b.fq = pr.fq ?? 0.5 + ctx.rng.next() * 0.6;
      b.dodge = ctx.rng.next() < T.dodgeShare;
    }
    e.rs -= b.spd * dt;
    const rel = e.rs - p.s;
    // the weave calms down near the pass so the closest approach reads clearly
    const k = clamp(rel / 600, 0.35, 1);
    weave(e, dt, b.ax * k, b.ax * 0.4 * k, b.fq);
    if (b.dodge && rel < 260 && rel > -50) {
      const dx = e.rx - p.x, dy = e.ry - p.y;
      const r = e.radius + 10;
      if (Math.abs(dx) < r && Math.abs(dy) < r * 0.75) b.x0 += Math.sign(dx || 1) * 70 * dt;
    }
    tryFire(e, dt, ctx, mgr, T.fire[0], T.fire[1]);
  },

  /**
   * Kamikaze: charges head-on at the player's predicted position with a
   * limited lateral acceleration, so a late sideways move dodges it (or shoot
   * it first). `e.rammer` flags it for the HUD, `e.noseLight` blinks.
   */
  rammer(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    const T = ENEMY_TUNING.rammer;
    if (!b.init) {
      b.init = 1;
      b.spd = e.params.spd ?? T.spd[0] + ctx.rng.next() * (T.spd[1] - T.spd[0]);
      b.vx = 0;
      b.vy = 0;
      b.armed = true;
      e.rammer = true;
    }
    e.rs -= b.spd * dt;
    const rel = e.rs - p.s;
    if (b.armed && rel > 0) {
      const tgo = Math.max(rel / Math.max(p.speed + b.spd, 50), 0.05);
      const tx = p.x + p.vx * tgo * T.lead, ty = p.y + p.vy * tgo * T.lead;
      let ax = ((tx - e.rx) / tgo - b.vx) * T.gain;
      let ay = ((ty - e.ry) / tgo - b.vy) * T.gain;
      const a = Math.hypot(ax, ay);
      if (a > T.accel) {
        ax *= T.accel / a;
        ay *= T.accel / a;
      }
      b.vx += ax * dt;
      b.vy += ay * dt;
    } else b.armed = false;
    e.rx += b.vx * dt;
    e.ry += b.vy * dt;
    b.roll = clamp(b.vx * 0.02, -0.6, 0.6);
    e.noseLight = (e.t * 5) % 1 < 0.5 ? 1 : 0;
  },

  /**
   * Comes up from ~250 m behind at +180 m/s relative and passes 20–40 m from
   * the player (big on screen), then settles ahead as a normal target.
   */
  overtakeClose(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    const T = ENEMY_TUNING.overtakeClose;
    if (!b.init) {
      b.init = 1;
      b.vrel = e.params.vrel ?? T.vrel[0] + ctx.rng.next() * (T.vrel[1] - T.vrel[0]);
      b.ox = e.rx - p.x;
      b.oy = e.ry - p.y;
      const side = Math.sign(b.ox) || (e.id & 1 ? 1 : -1);
      const pass = e.params.pass ?? T.pass[0] + ctx.rng.next() * (T.pass[1] - T.pass[0]);
      b.passX = side * pass * 0.92;
      b.passY = pass * 0.38;
      b.rel0 = Math.min(e.rs - p.s, -60);
      b.phase = 0;
    }
    const rel = e.rs - p.s;
    e.rs += (p.speed + b.vrel) * dt;
    if (b.phase === 0) {
      // track the player's offset: the pass distance is guaranteed (never an unseen ram)
      const k = smoothstep(b.rel0, -30, rel);
      e.rx = p.x + lerp(b.ox, b.passX, k);
      e.ry = p.y + lerp(b.oy, b.passY, k);
      if (rel > 40) {
        b.phase = 1;
        b.dx = e.rx - p.x * 0.3;
        b.dy = e.ry - p.y * 0.3;
      }
    } else {
      // pulled ahead: drift out a little, then become a regular target ahead
      b.dx += Math.sign(b.passX) * 10 * dt;
      b.dy += 6 * dt;
      e.rx = p.x * 0.3 + b.dx;
      e.ry = p.y * 0.3 + b.dy;
      if (rel > T.handover) toOvertakeAhead(e, ctx);
    }
  },

  /** One of a stream crossing the view diagonally (8–12 aircraft, see waves.swarmPass). */
  swarmPass(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    if (!b.init) {
      b.init = 1;
      const pr = e.params;
      const side = pr.side ?? (Math.sign(e.rx) || 1);
      b.vx = -side * (pr.vx ?? 150);
      b.vy = pr.vy ?? 0;
      b.close = pr.close ?? 190;
      b.bankBias = -side * 0.35;
    }
    e.rs += (p.speed - b.close) * dt;
    e.rx += b.vx * dt;
    e.ry += (b.vy + Math.sin(e.t * 2.2 + e.id) * 6) * dt;
    if (Math.abs(e.rx) > 1100) {
      mgr.despawn(e, false);
      return;
    }
    tryFire(e, dt, ctx, mgr, ENEMY_TUNING.swarmPass.fire[0], ENEMY_TUNING.swarmPass.fire[1]);
  },

  /** Comes from behind at high speed, passes, flies ahead weaving, then breaks or loops back. */
  overtake(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    if (!b.init) {
      b.init = 1;
      b.phase = 0;
      b.pt = 0;
      b.loop = ctx.rng.next() < 0.45;
    }
    const rel = e.rs - p.s;
    b.pt += dt;
    if (b.phase === 0) {
      e.rs += (p.speed + 170) * dt;
      e.ry = dampTo(e.ry, (e.params.y || 10), 1.2, dt);
      keepClear(e, p, rel, e.radius + 14, dt);
      if (rel > 420) { b.phase = 1; b.pt = 0; b.x0 = e.rx; b.y0 = e.ry; }
    } else if (b.phase === 1) {
      const target = 520 + Math.sin(e.t) * 60;
      e.rs += (p.speed + (target - rel) * 0.8) * dt;
      weave(e, dt, 28, 14, 1.1);
      if (b.pt > 5.5) { b.phase = b.loop ? 3 : 2; b.pt = 0; b.vs = p.speed; b.ry0 = e.ry; }
    } else if (b.phase === 2) {
      // break away: accelerate and climb
      b.vs += 90 * dt;
      e.rs += b.vs * dt;
      e.ry += (30 + b.pt * 40) * dt;
      e.b.roll = Math.min(1, b.pt) * Math.PI * 0.9 * Math.sign(e.rx || 1);
    } else if (b.phase === 3) {
      // half loop (Immelmann) to come back head-on
      const T = 2.4;
      const k = Math.min(b.pt / T, 1);
      const ang = k * Math.PI;
      const v = p.speed + 40;
      e.rs += (p.speed + Math.cos(ang) * v * 0.5 - (1 - Math.cos(ang)) * v * 0.5) * dt;
      e.ry = b.ry0 + Math.sin(ang) * 130;
      if (k >= 1) {
        e.behavior = BEHAVIORS.headOn;
        e.behaviorName = 'headOn';
        e.b.init = 0;
        e.b.x0 = undefined;
      }
    }
  },

  /** Crosses the screen laterally ahead of the player. */
  crossing(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    if (!b.init) {
      b.init = 1;
      b.dir = e.params.dir ?? (e.rx < 0 ? 1 : -1);
      b.v = e.params.v ?? 150 + ctx.rng.next() * 60;
    }
    e.rs += p.speed * 0.45 * dt;
    e.rx += b.dir * b.v * dt;
    e.ry += Math.sin(e.t * 2) * 6 * dt;
    if (Math.abs(e.rx) > 900) {
      mgr.despawn(e, false);
      return;
    }
    tryFire(e, dt, ctx, mgr, 500, 1600);
  },

  /** Enemies flying the same direction, slower: the player catches up to them. */
  formation(e, dt, ctx, mgr) {
    const p = ctx.player;
    if (!e.b.init) {
      e.b.init = 1;
      e.b.closing = 55 + ctx.rng.next() * 30;
    }
    e.rs += (p.speed - e.b.closing) * dt;
    weave(e, dt, 14, 8, 0.9);
    const rel = e.rs - p.s;
    if (rel < 60) {
      // break outward as we pass
      e.b.x0 += Math.sign(e.rx || 1) * 90 * dt;
      e.b.y0 += 30 * dt;
    }
  },

  /**
   * Sits on the player's six (−300 m), fires AAMs (they overtake and curl
   * back) and gun bursts, then overtakes and becomes a target ahead.
   */
  chaser(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    const T = ENEMY_TUNING.chaser;
    if (!b.init) {
      b.init = 1;
      b.fired = 0;
      b.hold = e.params.hold ?? T.hold;
      b.dur = e.params.dur ?? T.dur[0] + ctx.rng.next() * (T.dur[1] - T.dur[0]);
      b.gunCd = 1.2 + ctx.rng.next() * 1.2;
      e.fireCd = 1.2 + ctx.rng.next() * 0.8;
    }
    const rel = e.rs - p.s;
    e.rs += (p.speed + (b.hold - rel) * 0.7) * dt;
    weave(e, dt, 25, 12, 0.7);
    const fr = mgr.difficulty.fireRate;
    e.fireCd -= dt * fr;
    if (e.fireCd <= 0 && b.fired < 2) {
      if (ctx.fireMissile(e)) {
        b.fired++;
        e.fireCd = 3.5;
      } else e.fireCd = 0.6; // missile cap reached: try again shortly
    }
    b.gunCd -= dt * fr;
    if (b.gunCd <= 0 && rel > b.hold - 120) {
      ctx.fireGun(e);
      b.gunCd = T.gun[0] + ctx.rng.next() * (T.gun[1] - T.gun[0]);
    }
    if (e.t > b.dur) {
      e.behavior = BEHAVIORS.overtake;
      e.behaviorName = 'overtake';
      for (const k in b) if (k !== 'pf') delete b[k];
    }
  },

  /** Diving gun run from high ahead. */
  strafe(e, dt, ctx, mgr) {
    const p = ctx.player;
    if (!e.b.init) {
      e.b.init = 1;
      e.b.spd = e.def.speed;
    }
    e.rs -= e.b.spd * dt;
    const rel = e.rs - p.s;
    e.ry = dampTo(e.ry, p.y + 15, 0.9, dt);
    e.rx = dampTo(e.rx, p.x + (e.params.side || 0) * 30, 0.6, dt);
    if (rel < 1300 && rel > 400) {
      e.fireCd -= dt;
      if (e.fireCd <= 0) {
        ctx.fireGun(e);
        e.fireCd = 0.9;
      }
    }
    if (rel < 200) e.ry += 60 * dt;
  },

  /** Large bomber: overtakes into view, cruises ahead, escapes if time runs out. */
  bomber(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    if (!b.init) {
      b.init = 1;
      b.phase = 0;
      b.escT = e.escapeTimer || 40;
    }
    const rel = e.rs - p.s;
    if (b.phase < 2) b.escT -= dt;
    if (b.phase === 0) {
      e.rs += (p.speed + 120) * dt;
      e.ry = dampTo(e.ry, e.params.y ?? 45, 0.5, dt);
      keepClear(e, p, rel, e.radius + 14, dt);
      if (rel > 650) { b.phase = 1; b.x0 = e.rx; b.y0 = e.ry; }
    } else if (b.phase === 1) {
      const want = 700 + Math.sin(e.t * 0.3) * 120;
      e.rs += (p.speed + (want - rel) * 0.5) * dt;
      weave(e, dt, 30, 10, 0.35);
      if (b.escT <= 0) { b.phase = 2; b.vs = p.speed; }
      tryFire(e, dt, ctx, mgr, -100, 2000);
    } else {
      b.vs += 70 * dt;
      e.rs += b.vs * dt;
      e.ry += 35 * dt;
      if (rel > 3500) mgr.despawn(e, true);
    }
  },

  /** Hovering / slow helicopter group ahead. */
  hover(e, dt, ctx, mgr) {
    e.rs += (e.def.speed || 50) * dt;
    weave(e, dt, 6, 3, 0.5);
  },

  /** Dogfight ace: aggressive, stays ahead, dodges, sometimes gets on your six. */
  ace(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    if (!b.init) {
      b.init = 1;
      b.phase = 0;
      b.pt = 0;
      b.flares = 2;
      b.x0 = e.rx;
      b.y0 = e.ry;
      e.fireCd = 2;
    }
    b.pt += dt;
    const rel = e.rs - p.s;
    if (b.phase === 0) {
      // jink ahead of the player
      const want = 420 + Math.sin(e.t * 0.7) * 150;
      e.rs += (p.speed + (want - rel) * 0.9) * dt;
      b.x0 = dampTo(b.x0, Math.sin(e.t * 0.5) * 55, 0.8, dt);
      b.y0 = dampTo(b.y0, 10 + Math.cos(e.t * 0.37) * 25, 0.8, dt);
      e.rx = b.x0 + Math.sin(e.t * 2.3) * 12;
      e.ry = b.y0 + Math.cos(e.t * 1.9) * 7;
      if (b.pt > 9) { b.phase = 1; b.pt = 0; }
    } else if (b.phase === 1) {
      // pull up and over, drop behind the player (you hear the missile tone)
      const k = Math.min(b.pt / 2.6, 1);
      e.rs += (p.speed - 260 * Math.sin(k * Math.PI)) * dt;
      e.ry = b.y0 + Math.sin(k * Math.PI) * 140;
      if (k >= 1) { b.phase = 2; b.pt = 0; e.fireCd = 0.8; b.x0 = e.rx; b.y0 = e.ry; b.wt0 = undefined; }
    } else if (b.phase === 2) {
      // on our six: fire, then overshoot back in front
      const want = -380;
      e.rs += (p.speed + (want - rel) * 0.7) * dt;
      weave(e, dt, 30, 15, 0.9);
      e.fireCd -= dt;
      if (e.fireCd <= 0) { ctx.fireMissile(e); e.fireCd = 3.2; }
      if (b.pt > 7) { b.phase = 3; b.pt = 0; }
    } else {
      e.rs += (p.speed + 190) * dt;
      keepClear(e, p, rel, e.radius + 14, dt);
      if (rel > 380) { b.phase = 0; b.pt = 0; }
    }
    // react to incoming missiles with flares (breaks locks)
    if (e.incoming > 0 && b.flares > 0 && ctx.rng.next() < dt * 1.5) {
      b.flares--;
      ctx.enemyFlares(e);
    }
  },

  /** Heavy bomber boss: slides in from behind, holds ahead, tail gun + missiles. */
  bossBomber(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    if (!b.init) {
      b.init = 1;
      b.phase = 0;
      e.fireCd = 3;
    }
    const rel = e.rs - p.s;
    if (b.phase === 0) {
      e.rs += (p.speed + 140) * dt;
      e.ry = dampTo(e.ry, e.params.y ?? 60, 0.6, dt);
      if (rel > 420) {
        b.phase = 1;
        b.x0 = e.rx;
        b.y0 = e.ry;
      }
    } else {
      const want = 470 + Math.sin(e.t * 0.23) * 140;
      e.rs += (p.speed + (want - rel) * 0.6) * dt;
      b.x0 = dampTo(b.x0, Math.sin(e.t * 0.17) * 45, 0.5, dt);
      b.y0 = dampTo(b.y0, (e.params.y ?? 60) + Math.sin(e.t * 0.13) * 25, 0.5, dt);
      e.rx = b.x0 + Math.sin(e.t * 0.9) * 6;
      e.ry = b.y0 + Math.cos(e.t * 0.7) * 4;
      e.b.bankBias = Math.sin(e.t * 0.17) * 0.12;
      e.fireCd -= dt * mgr.difficulty.fireRate;
      if (e.fireCd <= 0) {
        if (ctx.rng.next() < 0.7) ctx.fireGun(e);
        else ctx.fireMissile(e);
        e.fireCd = 1.4 + ctx.rng.next() * 1.4;
      }
    }
  },

  /** Sub-part locked to a parent enemy (boss engines, weak points). */
  attached(e, dt, ctx, mgr) {
    const par = e.params.parent;
    if (!par || !par.active || par.dead) {
      mgr.despawn(e);
      return;
    }
    const l = e.params.local;
    e.pos.set(l[0], l[1], l[2]).applyQuaternion(par.quat).add(par.pos);
    e.vel.copy(par.vel);
  },

  /** World-anchored sea/ground unit; fires SAMs when the player is in range. */
  static(e, dt, ctx, mgr) {
    if (e.def.speed > 0) {
      e.pos.x += Math.sin(e.heading) * e.def.speed * dt;
      e.pos.z -= Math.cos(e.heading) * e.def.speed * dt;
    }
    if (e.def.sea && ctx.seaHeight) e.pos.y = ctx.seaHeight(e.pos.x, e.pos.z) * 0.6;
    tryFire(e, dt, ctx, mgr, 350, 3200);
  }
};
