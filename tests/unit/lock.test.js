import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { LockOn, LOCK_RADIUS, LOCK_RANGE, lockRangeOf } from '../../src/sim/lockon.js';
import { MissileSystem } from '../../src/sim/missiles.js';
import { MissileStock } from '../../src/sim/weapons.js';
import { Climax } from '../../src/sim/climax.js';
import { Scoring } from '../../src/sim/scoring.js';
import { Player } from '../../src/sim/player.js';
import { Rail } from '../../src/sim/rail.js';
import { ENEMY_TYPES } from '../../src/sim/enemyTypes.js';
import { PLAYER_JETS } from '../../src/models/aircraftBuilder.js';
import { Events } from '../../src/core/events.js';
import { Rng } from '../../src/core/rng.js';
import { buildRail } from '../../src/stages/railBuilder.js';
import { Combat, COMBAT } from '../../src/states/stage/combat.js';

const DT = 1 / 120;
const cam = new PerspectiveCamera(58, 16 / 9, 1, 30000);
cam.updateMatrixWorld();
cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
let NEXT = 1;

function enemy(type, x, y, z) {
  const def = ENEMY_TYPES[type];
  const p = new Vector3(x, y, z);
  return { id: NEXT++, type, active: true, lockable: true, dead: false, dying: 0, def, radius: def.radius, hp: def.hp, locks: 0, incoming: 0, pos: p, lockPos: p, vel: new Vector3() };
}

function lockon(max = 6) {
  const lo = new LockOn();
  lo.max = max;
  lo.reticle.x = 0;
  lo.reticle.y = 0;
  return lo;
}

function run(lo, list, sec, each) {
  const mgr = { list };
  for (let t = 0; t < sec; t += DT) {
    lo.update(DT, mgr, cam, new Vector3());
    each?.();
  }
}

describe('lock-on rules', () => {
  it('hidden catch radius by assist level, tiny drawn reticle', () => {
    const lo = new LockOn();
    expect(lo.reticleSize).toBeCloseTo(0.032);
    for (const a of [0, 1, 2]) {
      lo.assist = a;
      expect(lo.lockRadius()).toBeCloseTo(LOCK_RADIUS[a]);
    }
    expect(LOCK_RADIUS).toEqual([0.075, 0.095, 0.115]);
    lo.climax = true;
    expect(lo.lockRadius()).toBeCloseTo(0.45);
  });

  it('a locked + fired one-shot target is never locked or fired at again', () => {
    const lo = lockon();
    const ms = new MissileSystem({ rng: new Rng(1) });
    const e = enemy('fighterA', 0, 0, -1500);
    run(lo, [e], 0.1);
    expect(e.locks).toBe(1);
    expect(e.lockNeed).toBe(1);
    const tgt = lo.consume();
    expect(tgt).toBe(e);
    ms.launch('player', new Vector3(0, 0, 0), new Vector3(0, 0, -230), tgt);
    expect(e.incoming).toBe(1);
    // keep the reticle on it for 1.5 s: no new locks, no second missile
    let relocks = 0;
    run(lo, [e], 1.5, () => (relocks += lo.newLocks));
    expect(relocks).toBe(0);
    expect(lo.locks.length).toBe(0);
    expect(lo.consume()).toBe(null);
    expect(e.xMark).toBe(true);
    expect(lo.canTarget(e)).toBe(false);
  });

  it('✕ marks targets whose missiles in flight cover the need; tough targets get need slots', () => {
    const lo = lockon();
    const ms = new MissileSystem({ rng: new Rng(2) });
    const b = enemy('stealthB', 0, 0, -1500); // 16 hp → 2 missiles
    run(lo, [b], 0.1);
    expect(b.lockNeed).toBe(2);
    expect(b.locks).toBe(1);
    // relock rest: no second lock within 0.3 s
    run(lo, [b], 0.2);
    expect(b.locks).toBe(1);
    run(lo, [b], 0.3);
    expect(b.locks).toBe(2);
    run(lo, [b], 1);
    expect(b.locks).toBe(2); // never more than the need
    expect(b.xMark).toBe(false); // nothing in flight yet
    ms.launch('player', new Vector3(), new Vector3(0, 0, -230), lo.consume());
    lo.refresh(b);
    expect(b.xMark).toBe(true); // one in flight + one pending cover the need
    ms.launch('player', new Vector3(), new Vector3(0, 0, -230), lo.consume());
    lo.refresh(b);
    expect(b.xMark).toBe(true);
    expect(b.incoming).toBe(2);
    run(lo, [b], 1);
    expect(b.locks).toBe(0);

    const big = enemy('bomberXB', 0, 0, -2000); // 220 hp → capped at 4
    run(lo, [big], 2);
    expect(big.lockNeed).toBe(4);
    expect(big.locks).toBe(4);
  });

  it('re-locks a target after its missile is lost', () => {
    const lo = lockon();
    const ms = new MissileSystem({ rng: new Rng(3) });
    const e = enemy('fighterA', 0, 0, -1500);
    run(lo, [e], 0.1);
    const m = ms.launch('player', new Vector3(), new Vector3(0, 0, -230), lo.consume());
    run(lo, [e], 0.5);
    expect(e.locks).toBe(0);
    ms._end(m, 'decoy'); // missile lost to flares
    expect(e.incoming).toBe(0);
    run(lo, [e], 0.2);
    expect(e.locks).toBe(1);
    expect(e.xMark).toBe(false);
  });

  it('capacity comes from the jet', () => {
    const caps = Object.fromEntries(PLAYER_JETS.map((j) => [j.id, j.lockCap]));
    expect(caps).toEqual({ f14d: 6, fa18e: 6, f15e: 8 });
    for (const j of PLAYER_JETS) {
      const lo = lockon(j.lockCap);
      const list = [];
      for (let i = 0; i < 12; i++) list.push(enemy('fighterA', (i - 6) * 3, 0, -1500));
      run(lo, list, 0.2);
      expect(lo.locks.length).toBe(j.lockCap);
    }
  });

  it('drops locks of dead and long off-screen targets; consume skips them', () => {
    const lo = lockon();
    const a = enemy('fighterA', 0, 0, -1500);
    const b = enemy('fighterA', 2, 0, -1450);
    run(lo, [a, b], 0.1);
    expect(lo.locks.length).toBe(2);
    a.dead = true;
    b.pos.set(0, 0, 500); // behind the camera
    run(lo, [a, b], 0.5);
    expect(lo.locks.length).toBe(1);
    run(lo, [a, b], 1);
    expect(lo.locks.length).toBe(0);
    expect(b.locks).toBe(0);
    expect(lo.consume()).toBe(null);
  });
});

describe('lock-on range', () => {
  it('per-type ranges: air 1600 m, big / ground / sea 2400 m, min 80 m', () => {
    expect(LOCK_RANGE).toEqual({ air: 1600, big: 2400 });
    for (const ty of ['fighterA', 'stealthB', 'ace', 'heloCH47', 'cruiseMissile']) expect(ENEMY_TYPES[ty].lockRange, ty).toBe(1600);
    for (const ty of ['bomberXB', 'bomberB52', 'destroyer', 'samBoat', 'samSite', 'aaGun', 'target', 'bossPod']) expect(ENEMY_TYPES[ty].lockRange, ty).toBe(2400);
    expect(lockRangeOf({ air: true })).toBe(1600);
    expect(lockRangeOf({ air: true, big: true })).toBe(2400);
    expect(lockRangeOf({ air: false })).toBe(2400);
    expect(new LockOn().minRange).toBe(80);
  });

  it('refuses targets beyond their range and accepts them inside it; flags e.inLockRange', () => {
    const lo = lockon();
    const far = enemy('fighterA', 0, 0, -1700);
    const bigFar = enemy('bomberXB', 30, 0, -2600);
    run(lo, [far, bigFar], 0.5);
    expect(lo.locks.length).toBe(0);
    expect(far.inLockRange).toBe(false);
    expect(bigFar.inLockRange).toBe(false);
    expect(far.onScreen).toBe(true);
    expect(lo.assistTarget).toBe(null); // unlocked shots do not reach out of range either
    far.pos.z = -1550;
    bigFar.pos.z = -2300;
    run(lo, [far, bigFar], 0.1);
    expect(far.inLockRange).toBe(true);
    expect(bigFar.inLockRange).toBe(true);
    expect(far.locks).toBe(1);
    expect(bigFar.locks).toBeGreaterThanOrEqual(1);
    expect(far.lockRange).toBe(1600);
    expect(bigFar.lockRange).toBe(2400);
  });

  it('nothing closer than the minimum range', () => {
    const lo = lockon();
    const e = enemy('fighterA', 0, 0, -60);
    run(lo, [e], 0.3);
    expect(e.inLockRange).toBe(false);
    expect(e.locks).toBe(0);
    expect(lo.assistTarget).toBe(null);
  });

  it('the assist target (unlocked missile shots) follows the range', () => {
    const lo = lockon();
    lo.dwellTime = 10; // never lock
    const e = enemy('fighterA', 0, 0, -1750);
    run(lo, [e], 0.1);
    expect(lo.assistTarget).toBe(null);
    e.pos.z = -1400;
    run(lo, [e], 0.1);
    expect(lo.assistTarget).toBe(e);
  });

  it('Climax widens every range ×1.5; its locks survive the salvo', () => {
    const lo = lockon();
    lo.climax = true;
    const e = enemy('fighterA', 0, 0, -2300);
    run(lo, [e], 0.05);
    expect(e.lockRange).toBe(2400);
    expect(e.locks).toBe(1);
    lo.climax = false; // salvo: the lock taken at 2300 m is kept (1.2 × 2400)
    run(lo, [e], 0.2);
    expect(lo.locks.length).toBe(1);
    expect(e.inLockRange).toBe(false);
  });

  it('drops a pending lock once the target is beyond 1.2× its range', () => {
    const lo = lockon();
    const e = enemy('fighterA', 0, 0, -1500);
    run(lo, [e], 0.1);
    expect(lo.locks.length).toBe(1);
    e.pos.z = -1900; // < 1920: kept
    run(lo, [e], 0.1);
    expect(lo.locks.length).toBe(1);
    e.pos.z = -1950;
    run(lo, [e], 0.02);
    expect(lo.locks.length).toBe(0);
    expect(e.locks).toBe(0);
  });
});

// ---------------------------------------------------------------- Combat glue
function makeStage({ jet = 'fa18e', settings = {} } = {}) {
  const rail = new Rail({ points: buildRail({ start: [0, 300, 0], segs: [{ len: 20000, turn: 0 }] }) });
  const player = new Player();
  player.reset({ s: 100, baseSpeed: 230 });
  player.computePose(rail);
  const camera = new PerspectiveCamera(58, 16 / 9, 1, 30000);
  camera.position.copy(player.pos);
  camera.lookAt(player.pos.clone().add(player.forward));
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const input = { pressed: {}, released: {}, hold: {}, lastDevice: 'keyboard' };
  const game = {
    settings: { autoFire: false, ...settings },
    audio: null,
    input,
    rig: { camera, fovKick: 0, addTrauma() {} },
    clock: { timeScale: 1, scaleTo(v) { this.timeScale = v; } },
    dynres: { locked: false },
    session: { jet, stats: { missilesFired: 0, climaxUsed: 0 } }
  };
  const fired = new Map();
  const missiles = new MissileSystem({ rng: new Rng(9), hooks: { onLaunch: (m) => m.target && fired.set(m.target.id, (fired.get(m.target.id) || 0) + 1) } });
  const stage = {
    game, rail, player, input, fired, time: 0, touchMode: false,
    events: new Events(),
    enemies: { list: [] },
    missiles,
    vulcan: { update() {} },
    lockon: new LockOn(),
    stock: new MissileStock(50, 2), // what StageState builds today; Combat reconfigures it
    climax: new Climax(),
    scoring: new Scoring(),
    jet: { group: { position: player.pos }, nextHardpoint: (out) => out.copy(player.pos) },
    fx: {},
    models: { PLAYER_JETS }
  };
  stage.lockon.reticle.x = 0;
  stage.lockon.reticle.y = 0;
  stage.combat = new Combat(stage);
  stage.spawn = (type, x, y, d) => {
    const e = enemy(type, 0, 0, 0);
    e.pos.copy(player.pos).addScaledVector(player.forward, d).add(new Vector3(x, y, 0));
    stage.enemies.list.push(e);
    return e;
  };
  stage.step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const wdt = DT * game.clock.timeScale;
      stage.combat.preUpdate(DT, wdt, input, true);
      stage.combat.update(DT, wdt, input, true);
      missiles.update(wdt, {});
      stage.combat.postUpdate(DT);
      stage.time += DT;
      for (const k in input.pressed) input.pressed[k] = false;
      for (const k in input.released) input.released[k] = false;
    }
  };
  stage.press = (a) => {
    input.pressed[a] = true;
    input.hold[a] = true;
  };
  stage.release = (a) => {
    input.hold[a] = false;
    input.released[a] = true;
  };
  return stage;
}

describe('combat: missiles', () => {
  it('configures the rack (8 ready) and the lock cap from the jet', () => {
    const st = makeStage({ jet: 'f15e' });
    st.step();
    expect(st.stock.max).toBe(COMBAT.stockMax);
    expect(st.stock.ready).toBe(8);
    expect(st.lockon.max).toBe(8);
  });

  it('one missile per press at the oldest lock; never twice at the same one-shot target', () => {
    const st = makeStage();
    const a = st.spawn('fighterA', 0, 0, 1500);
    const b = st.spawn('fighterA', 3, 0, 1450);
    st.step(24);
    expect(st.lockon.locks.length).toBe(2);
    const fox = [];
    st.events.on('fox', (e) => fox.push(e.locked));
    for (let k = 0; k < 6; k++) {
      st.press('missile');
      st.step(1);
      st.release('missile');
      st.step(20);
    }
    expect(st.fired.get(a.id)).toBe(1);
    expect(st.fired.get(b.id)).toBe(1);
    expect(fox.slice(0, 2)).toEqual([true, true]);
    expect(fox.slice(2).every((l) => l === false)).toBe(true); // extra presses dumb-fire
    expect(a.xMark && b.xMark).toBe(true);
  });

  it('holding MISSILE ripples at new locks at ~8 Hz after 0.25 s', () => {
    const st = makeStage({ jet: 'f15e', settings: { autoMissile: true } });
    for (let i = 0; i < 14; i++) st.spawn('fighterA', (i - 7) * 2, 0, 1500 + i * 5);
    st.step(12);
    const times = [];
    st.events.on('fox', () => times.push(st.time));
    const t0 = st.time;
    st.press('missile');
    st.step(Math.round(1.25 * 120));
    const rel = times.map((t) => t - t0);
    expect(rel[0]).toBeLessThan(0.02); // the press
    const ripple = rel.slice(1);
    expect(ripple[0]).toBeGreaterThanOrEqual(0.25);
    for (let i = 1; i < ripple.length; i++) expect(ripple[i] - ripple[i - 1]).toBeGreaterThanOrEqual(1 / 8 - 1e-6);
    expect(ripple.length).toBeGreaterThanOrEqual(6);
    for (const n of st.fired.values()) expect(n).toBe(1);
  });

  it('no ripple when auto missile is off', () => {
    const st = makeStage({ settings: { autoMissile: false } });
    for (let i = 0; i < 6; i++) st.spawn('fighterA', (i - 3) * 2, 0, 1500);
    st.step(12);
    let n = 0;
    st.events.on('fox', () => n++);
    st.press('missile');
    st.step(120);
    expect(n).toBe(1);
  });

  it('dumb-fires at the assist target only if it still needs a missile', () => {
    const st = makeStage();
    st.lockon.dwellTime = 10; // never lock
    const a = st.spawn('fighterA', 0, 0, 1500);
    st.step(2);
    expect(st.lockon.assistTarget).toBe(a);
    st.press('missile');
    st.step(1);
    expect(st.fired.get(a.id)).toBe(1);
    st.release('missile');
    st.step(10);
    st.press('missile');
    st.step(1);
    expect(st.fired.get(a.id)).toBe(1); // covered → second missile flies straight
    expect(st.missiles.count('player')).toBe(2);
  });
});
