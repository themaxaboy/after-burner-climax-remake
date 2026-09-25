import { describe, it, expect } from 'vitest';
import { Vector3, PerspectiveCamera } from 'three';
import { MissileSystem, pnAccel, segPointDist2 } from '../../src/sim/missiles.js';
import { segSphere, MissileStock, Vulcan } from '../../src/sim/weapons.js';
import { LockOn, projectPoint } from '../../src/sim/lockon.js';
import { Scoring, comboBonusAt } from '../../src/sim/scoring.js';
import { Climax } from '../../src/sim/climax.js';
import { Director, FORMATIONS } from '../../src/sim/director.js';
import { EnemyManager, BEHAVIORS } from '../../src/sim/enemies.js';
import { ENEMY_TYPES } from '../../src/sim/enemyTypes.js';
import { Rail } from '../../src/sim/rail.js';
import { Player } from '../../src/sim/player.js';
import { Rng } from '../../src/core/rng.js';
import { buildRail } from '../../src/stages/railBuilder.js';
import stage1 from '../../src/stages/stage1_ocean.js';

function weavingTarget(seed) {
  const rng = new Rng(seed);
  const t = { id: 1, active: true, dead: false, pos: new Vector3(rng.range(-300, 300), rng.range(40, 200), -rng.range(900, 2500)), vel: new Vector3(), radius: 8, incoming: 0, ph: rng.range(0, 6) };
  t.lockPos = t.pos;
  t.dir = rng.chance(0.5) ? 1 : -1; // toward (+1: head-on) or away
  return t;
}

describe('missile guidance', () => {
  it('pnAccel is perpendicular-ish and clamped', () => {
    const a = new Vector3();
    pnAccel(new Vector3(), new Vector3(0, 0, -300), new Vector3(100, 0, -1000), new Vector3(0, 0, 0), 4, 50, a);
    expect(a.length()).toBeLessThanOrEqual(50 + 1e-6);
    expect(a.x).toBeGreaterThan(0);
  });

  it('player missiles hit weaving targets >= 99%', () => {
    let hits = 0;
    const N = 200;
    for (let k = 0; k < N; k++) {
      const tgt = weavingTarget(k + 1);
      let hit = false;
      const ms = new MissileSystem({ rng: new Rng(k), hooks: { onHit: () => (hit = true) } });
      ms.launch('player', new Vector3(0, 50, 0), new Vector3(0, -5, -230), tgt);
      const dt = 1 / 120;
      for (let i = 0; i < 120 * 8 && !hit; i++) {
        const tt = i * dt;
        tgt.vel.set(Math.sin(tt * 1.3 + tgt.ph) * 120, Math.cos(tt * 0.9) * 40, 220 * tgt.dir);
        tgt.pos.addScaledVector(tgt.vel, dt);
        ms.update(dt, {});
      }
      if (hit) hits++;
    }
    expect(hits / N).toBeGreaterThanOrEqual(0.99);
  });

  it('enemy missiles can be broken by a roll', () => {
    const player = { id: -1, active: true, pos: new Vector3(0, 60, 0), vel: new Vector3(0, 0, -230), radius: 6 };
    player.lockPos = player.pos;
    let hit = false;
    const ms = new MissileSystem({ rng: new Rng(3), hooks: { onHit: () => (hit = true) } });
    ms.launch('enemy', new Vector3(0, 60, 800), new Vector3(0, 0, -300), player);
    for (let i = 0; i < 120; i++) ms.update(1 / 120, {});
    ms.breakLocks(player.pos, 3000);
    for (let i = 0; i < 120 * 5; i++) {
      player.pos.addScaledVector(player.vel, 1 / 120);
      ms.update(1 / 120, {});
    }
    expect(hit).toBe(false);
  });

  it('segment helpers', () => {
    expect(segSphere(new Vector3(0, 0, -10), new Vector3(0, 0, 10), new Vector3(0, 0.5, 0), 1)).toBe(true);
    expect(segSphere(new Vector3(0, 0, -10), new Vector3(0, 0, 10), new Vector3(0, 5, 0), 1)).toBe(false);
    expect(segPointDist2(new Vector3(0, 0, 0), new Vector3(10, 0, 0), new Vector3(5, 3, 0))).toBeCloseTo(9);
  });
});

describe('missile stock', () => {
  it('regenerates about 2 per second up to 50', () => {
    const s = new MissileStock(50, 2);
    for (let i = 0; i < 10; i++) s.take();
    expect(s.count).toBe(40);
    for (let i = 0; i < 120 * 3; i++) s.update(1 / 120);
    expect(s.count).toBe(46);
    for (let i = 0; i < 120 * 10; i++) s.update(1 / 120);
    expect(s.count).toBe(50);
  });
});

describe('lock-on', () => {
  const cam = new PerspectiveCamera(62, 16 / 9, 1, 30000);
  cam.position.set(0, 0, 0);
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();

  function enemy(id, x, y, z, big = false) {
    const def = { ...ENEMY_TYPES[big ? 'bomberXB' : 'fighterA'] };
    return { id, active: true, lockable: true, dead: false, dying: 0, def, radius: def.radius, locks: 0, pos: new Vector3(x, y, z), lockPos: new Vector3(x, y, z), vel: new Vector3() };
  }

  it('projects points in front and rejects behind', () => {
    const o = new Vector3();
    expect(projectPoint(cam, new Vector3(0, 0, -100), o)).toBe(true);
    expect(o.x).toBeCloseTo(0);
    expect(o.z).toBeCloseTo(100);
    expect(projectPoint(cam, new Vector3(0, 0, 100), o)).toBe(false);
  });

  it('locks targets under the reticle after a short dwell, max 8', () => {
    const lo = new LockOn();
    lo.reticle.x = 0;
    lo.reticle.y = 0;
    const list = [];
    for (let i = 0; i < 12; i++) list.push(enemy(i + 1, (i - 6) * 3, 0, -1500));
    list.push(enemy(99, 900, 0, -1000)); // far off to the side
    const mgr = { list };
    lo.update(0.05, mgr, cam, new Vector3());
    expect(lo.locks.length).toBe(0);
    lo.update(0.06, mgr, cam, new Vector3());
    expect(lo.locks.length).toBe(8);
    expect(list[12].locks).toBe(0);
  });

  it('climax locks instantly with a larger circle and up to 32', () => {
    const lo = new LockOn();
    lo.climax = true;
    lo.reticle.x = 0;
    lo.reticle.y = 0;
    const list = [];
    for (let i = 0; i < 40; i++) list.push(enemy(i + 1, (i % 8 - 4) * 40, (Math.floor(i / 8) - 2) * 30, -1500));
    lo.update(1 / 120, { list }, cam, new Vector3());
    expect(lo.locks.length).toBeGreaterThan(8);
    expect(lo.locks.length).toBeLessThanOrEqual(32);
  });

  it('consume returns locks in order', () => {
    const lo = new LockOn();
    const list = [enemy(1, 0, 0, -1000), enemy(2, 1, 0, -1200)];
    lo.update(0.2, { list }, cam, new Vector3());
    expect(lo.consume().id).toBe(1);
    expect(lo.consume().id).toBe(2);
    expect(lo.consume()).toBe(null);
  });
});

describe('scoring', () => {
  it('combo bonus table matches the arcade rules', () => {
    expect(comboBonusAt(9)).toBe(0);
    expect(comboBonusAt(10)).toBe(5000);
    expect(comboBonusAt(50)).toBe(5000);
    expect(comboBonusAt(60)).toBe(10000);
    expect(comboBonusAt(70)).toBe(0);
    expect(comboBonusAt(80)).toBe(10000);
  });
  it('combo chains, breaks on damage and times out', () => {
    const s = new Scoring();
    const e = { def: { score: 1000 } };
    for (let i = 0; i < 10; i++) s.kill(e);
    expect(s.combo).toBe(10);
    expect(s.stage).toBe(10000 + 5000);
    s.hurt();
    expect(s.combo).toBe(0);
    s.kill(e);
    s.update(5, -1, 0);
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(10);
  });
  it('stars from down rate', () => {
    const s = new Scoring();
    expect(s.stageClear(4, 10).earned).toBe(0);
    expect(s.stageClear(5, 10).earned).toBe(1);
    expect(s.stars).toBe(1);
    s.loseStar();
    expect(s.stars).toBe(0);
    expect(Scoring.rankLetter(96)).toBe('S');
  });
  it('flight score accrues at NEUTRAL and FAST only', () => {
    const s = new Scoring();
    s.update(1, -1, 1000);
    expect(s.stage).toBe(0);
    s.update(1, 0, 1000);
    expect(s.stage).toBe(100);
    s.update(1, 1, 1000);
    expect(s.stage).toBe(350);
  });
});

describe('climax', () => {
  it('fills, activates, drains and caps mash damage at 2x', () => {
    const c = new Climax();
    expect(c.activate()).toBe(false);
    c.gauge = 1;
    expect(c.activate()).toBe(true);
    for (let i = 0; i < 30; i++) c.mash();
    expect(c.damageMul).toBe(2);
    let ended = false;
    for (let i = 0; i < 120 * 6 && !ended; i++) ended = c.update(1 / 120);
    expect(ended).toBe(true);
    expect(c.gauge).toBe(0);
    c.onKill(false, 1);
    expect(c.gauge).toBeGreaterThan(0.05);
  });
});

describe('enemies & director', () => {
  const rail = new Rail({ points: buildRail({ start: [0, 60, 0], segs: [{ len: 20000, turn: 30 }] }) });

  it('every stage-1 timeline spawn uses known types, behaviours and formations', () => {
    for (const ev of stage1.timeline) {
      const sps = ev.spawn ? [ev.spawn] : ev.eo?.spawn ? [].concat(ev.eo.spawn) : [];
      for (const sp of sps) {
        expect(ENEMY_TYPES[sp.type], sp.type).toBeTruthy();
        expect(BEHAVIORS[sp.behavior || 'headOn'], sp.behavior).toBeTruthy();
        if (sp.formation) expect(FORMATIONS[sp.formation], sp.formation).toBeTruthy();
      }
    }
  });

  it('runs the stage-1 timeline headless without errors', () => {
    const rng = new Rng(1);
    const mgr = new EnemyManager({ rng });
    const player = new Player();
    const rail1 = new Rail(stage1.rail);
    player.reset({ s: 100, baseSpeed: 230, box: { x: 70, y: 36 } });
    const events = [];
    const dir = new Director(stage1, {
      spawn: (type, o) => mgr.spawn(type, o),
      cue: (n) => events.push(n),
      radio: () => {},
      message: () => {},
      eoEvent: (k) => events.push('eo:' + k),
      end: () => events.push('end'),
      rank: () => 0,
      worldPoint: (s, x) => {
        const p = rail1.positionAt(s, new Vector3());
        return { x: p.x + x, y: 0, z: p.z };
      },
      railHeading: () => 0
    });
    const ctx = { player, rail: rail1, rng, fireMissile: () => {}, fireGun: () => {}, enemyFlares: () => {} };
    const input = { moveX: 0, moveY: 0, throttleAxis: 0 };
    let maxActive = 0;
    for (let i = 0; i < 120 * 200 && !dir.ended; i++) {
      player.update(1 / 120, input, rail1);
      dir.update(1 / 120, player);
      mgr.update(1 / 120, ctx);
      maxActive = Math.max(maxActive, mgr.list.length);
      for (const e of mgr.list) {
        expect(Number.isFinite(e.pos.x)).toBe(true);
      }
    }
    expect(events).toContain('end');
    expect(events).toContain('eo:start');
    expect(mgr.spawned).toBeGreaterThan(60);
    expect(maxActive).toBeLessThan(40);
  }, 30000);

  it('head-on fighters approach and despawn behind the player', () => {
    const rng = new Rng(2);
    const mgr = new EnemyManager({ rng });
    const player = new Player();
    player.reset({ s: 0, baseSpeed: 230 });
    const e = mgr.spawn('fighterA', { behavior: 'headOn', rs: 3000, rx: 0, ry: 0 });
    const ctx = { player, rail, rng, fireMissile: () => {}, fireGun: () => {} };
    const input = { moveX: 0, moveY: 0, throttleAxis: 0 };
    for (let i = 0; i < 120 * 12; i++) {
      player.update(1 / 120, input, rail);
      mgr.update(1 / 120, ctx);
    }
    expect(e.active).toBe(false);
  });

  /** Fly one enemy against a player; `steer(t, tImpact)` returns stick input. Returns closest approach (m). */
  function closest(behavior, o, steer, seed = 4) {
    const rng = new Rng(seed);
    const mgr = new EnemyManager({ rng });
    const player = new Player();
    player.reset({ s: 1000, baseSpeed: 230, box: { x: 240, y: 100 } });
    player.lateralSpeed = 150;
    player.computePose(rail);
    const e = mgr.spawn('fighterA', { behavior, rs: player.s + o.dist, rx: o.x || 0, ry: o.y || 0 });
    const ctx = { player, rail, rng, fireMissile: () => false, fireGun: () => {} };
    const tImpact = o.dist > 0 ? o.dist / (230 + 215) : 0;
    let minD = Infinity;
    for (let i = 0; i < 120 * 8 && e.active; i++) {
      const t = i / 120;
      player.update(1 / 120, steer ? steer(t, tImpact) : { moveX: 0, moveY: 0, throttleAxis: 0 }, rail);
      mgr.update(1 / 120, ctx);
      if (e.active) minD = Math.min(minD, e.pos.distanceTo(player.pos));
    }
    return { minD, e };
  }

  it('head-on fighters rush in: ~1500 m away, pass within ~4 s', () => {
    const { e } = closest('headOn', { dist: 1500, x: 60 });
    expect(e.b.spd).toBeGreaterThanOrEqual(180);
    expect(e.b.spd).toBeLessThanOrEqual(240);
    expect(e.b.ax).toBeGreaterThanOrEqual(20);
    expect(e.b.ax).toBeLessThanOrEqual(60);
  });

  it('rammers hit a player who holds still and miss one who moves > 45 m in the last 1.5 s', () => {
    const r = ENEMY_TYPES.fighterA.radius + 3;
    for (let k = 0; k < 4; k++) {
      const still = closest('rammer', { dist: 1500, x: 10 * k - 15, y: 5 }, null, 10 + k);
      expect(still.e.rammer).toBe(true);
      expect(still.minD).toBeLessThan(r);
      // stick 0.3 × 150 m/s from rest over 1.5 s ≈ 55 m
      const dodge = closest('rammer', { dist: 1500, x: 10 * k - 15, y: 5 }, (t, ti) => ({ moveX: t > ti - 1.5 ? 0.3 : 0, moveY: 0, throttleAxis: 0 }), 10 + k);
      expect(dodge.minD).toBeGreaterThan(r);
    }
  });

  it('overtakeClose passes 20–40 m from the player, then becomes a target ahead', () => {
    for (let k = 0; k < 4; k++) {
      const { minD, e } = closest('overtakeClose', { dist: -250, x: 40 * (k & 1 ? 1 : -1), y: 5 }, (t) => ({ moveX: Math.sin(t * 2) * 0.5, moveY: 0, throttleAxis: 0 }), 20 + k);
      expect(minD).toBeGreaterThan(18);
      expect(minD).toBeLessThan(45);
      expect(e.behaviorName).toBe('overtake');
    }
  });
});

describe('vulcan', () => {
  it('hits an enemy straight ahead', () => {
    const rng = new Rng(1);
    const mgr = new EnemyManager({ rng });
    const rail = new Rail({ points: buildRail({ start: [0, 60, 0], segs: [{ len: 5000, turn: 0 }] }) });
    const e = mgr.spawn('fighterA', { behavior: 'hover', rs: 500, rx: 0, ry: 0 });
    const player = new Player();
    player.reset({ s: 0, baseSpeed: 230 });
    player.computePose(rail);
    const ctx = { player, rail, rng, fireMissile: () => {}, fireGun: () => {} };
    mgr.update(1 / 120, ctx);
    const v = new Vulcan({ rng });
    let hits = 0;
    v.hooks.onBulletHit = () => hits++;
    for (let i = 0; i < 120; i++) {
      mgr.update(1 / 120, ctx);
      v.update(1 / 120, player, player.forward, e, true, mgr);
    }
    expect(hits).toBeGreaterThan(3);
  });
});
