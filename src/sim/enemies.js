import { Matrix4, Quaternion, Vector3 } from 'three';
import { ENEMY_TYPES } from './enemyTypes.js';
import { clamp, dampTo } from '../core/math.js';
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
    e.countable = o.countable !== false;
    e.params = o.params || {};
    e.lockable = def.lockable;
    e.visible = true;
    e.smoke = null;
    e.onScreen = false;
    e.escapeTimer = o.timeLimit || 0;
    e.escaped = false;
    e.heading = o.heading || 0;
    for (const k in e.b) delete e.b[k];
    if (e.anchor === 'world' && o.world) e.pos.set(o.world.x, o.world.y, o.world.z);
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
      const lo = e.def.lockOffset;
      if (lo) e.lockPos.set(e.pos.x + lo[0], e.pos.y + lo[1], e.pos.z + lo[2]);
      else e.lockPos.copy(e.pos);
      // escape / despawn when far behind the player or far ahead
      const rel = this.relS(e, ctx);
      if (rel < -700 || rel > 9000) this.despawn(e, e.def.big || e.tag != null);
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
    const seaHit = ctx.groundHeight ? e.pos.y < ctx.groundHeight(e.pos.x, e.pos.z) + 2 : e.pos.y < 2;
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
  if (r < def.missile * 0.55 * agg) ctx.fireMissile(e);
  else if (r < (def.missile * 0.55 + def.gun * 0.6) * agg) ctx.fireGun(e);
  e.shotsFired++;
  e.fireCd = 2.2 + ctx.rng.next() * 2.5;
}

function weave(e, dt, ampX, ampY, freq) {
  const b = e.b;
  if (b.ph === undefined) b.ph = (e.id * 2.39996) % 6.2832;
  if (b.x0 === undefined) {
    b.x0 = e.rx;
    b.y0 = e.ry;
  }
  e.rx = b.x0 + Math.sin(e.t * freq + b.ph) * ampX;
  e.ry = b.y0 + Math.cos(e.t * freq * 0.7 + b.ph) * ampY;
}

export const BEHAVIORS = {
  /** Oncoming fighter: flies toward the player, weaves, may fire once, passes. */
  headOn(e, dt, ctx, mgr) {
    const p = ctx.player;
    if (!e.b.init) {
      e.b.init = 1;
      e.b.spd = e.def.speed * (0.85 + ctx.rng.next() * 0.3);
      e.b.ax = 8 + ctx.rng.next() * 18;
      e.b.fq = 0.6 + ctx.rng.next() * 0.8;
    }
    e.rs -= e.b.spd * dt;
    weave(e, dt, e.b.ax, e.b.ax * 0.5, e.b.fq);
    // keep separation when very close so collisions are avoidable but tense
    const rel = e.rs - p.s;
    if (rel < 250 && rel > -50) {
      const dx = e.rx - p.x, dy = e.ry - p.y;
      if (Math.abs(dx) < 16 && Math.abs(dy) < 12) e.b.x0 += Math.sign(dx || 1) * 60 * dt;
    }
    tryFire(e, dt, ctx, mgr, 650, 1900);
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
      b.dir = e.rx < 0 ? 1 : -1;
      b.v = 150 + ctx.rng.next() * 60;
    }
    e.rs += p.speed * 0.45 * dt;
    e.rx += b.dir * b.v * dt;
    e.ry += Math.sin(e.t * 2) * 6 * dt;
    if (Math.abs(e.rx) > 900) mgr.despawn(e, false);
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

  /** Sits on the player's six and fires missiles, then overtakes. */
  chaser(e, dt, ctx, mgr) {
    const p = ctx.player;
    const b = e.b;
    if (!b.init) {
      b.init = 1;
      b.fired = 0;
      e.fireCd = 1.6;
    }
    const rel = e.rs - p.s;
    const want = -520;
    e.rs += (p.speed + (want - rel) * 0.6) * dt;
    weave(e, dt, 25, 12, 0.7);
    e.fireCd -= dt;
    if (e.fireCd <= 0 && b.fired < 2) {
      ctx.fireMissile(e);
      b.fired++;
      e.fireCd = 4.5;
    }
    if (e.t > 11) {
      e.behavior = BEHAVIORS.overtake;
      e.behaviorName = 'overtake';
      e.b = { init: 0 };
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
    if (b.phase === 0) {
      e.rs += (p.speed + 120) * dt;
      e.ry = dampTo(e.ry, e.params.y ?? 45, 0.5, dt);
      if (rel > 650) { b.phase = 1; b.x0 = e.rx; b.y0 = e.ry; }
    } else if (b.phase === 1) {
      const want = 700 + Math.sin(e.t * 0.3) * 120;
      e.rs += (p.speed + (want - rel) * 0.5) * dt;
      weave(e, dt, 30, 10, 0.35);
      b.escT -= dt;
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
      if (k >= 1) { b.phase = 2; b.pt = 0; e.fireCd = 0.8; }
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
      if (rel > 380) { b.phase = 0; b.pt = 0; }
    }
    // react to incoming missiles with flares (breaks locks)
    if (e.incoming > 0 && b.flares > 0 && ctx.rng.next() < dt * 1.5) {
      b.flares--;
      ctx.enemyFlares(e);
    }
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
