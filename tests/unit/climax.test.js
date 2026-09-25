import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { LockOn } from '../../src/sim/lockon.js';
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
let NEXT = 1;

function enemy(type) {
  const def = ENEMY_TYPES[type];
  const p = new Vector3();
  return { id: NEXT++, type, active: true, lockable: true, dead: false, dying: 0, def, radius: def.radius, hp: def.hp, locks: 0, incoming: 0, pos: p, lockPos: p, vel: new Vector3() };
}

/** Minimal StageState stand-in around a real Combat. */
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
  const launches = [];
  const missiles = new MissileSystem({
    rng: new Rng(9),
    hooks: {
      onLaunch: (m) => {
        launches.push({ t: stage.time, damage: m.damage });
        if (m.target) fired.set(m.target.id, (fired.get(m.target.id) || 0) + 1);
      }
    }
  });
  const stage = {
    game, rail, player, input, fired, launches, time: 0, touchMode: false,
    events: new Events(),
    enemies: { list: [] },
    missiles,
    vulcan: { update() {} },
    lockon: new LockOn(),
    stock: new MissileStock(50, 2),
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
    const e = enemy(type);
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

const sec = (s) => Math.round(s * 120);

describe('climax gauge', () => {
  it('fills passively in ~45 s (×1.5 at FAST) and with kills', () => {
    const c = new Climax();
    for (let i = 0; i < sec(44); i++) c.fill(DT, 0);
    expect(c.gauge).toBeLessThan(1);
    for (let i = 0; i < sec(1.1); i++) c.fill(DT, 0);
    expect(c.gauge).toBe(1);
    expect(c.phase).toBe('ready');
    const f = new Climax();
    for (let i = 0; i < sec(30.1); i++) f.fill(DT, 1);
    expect(f.gauge).toBe(1);
    const k = new Climax();
    k.onKill(false, 0);
    expect(k.gauge).toBeCloseTo(0.035);
    k.onKill(true, 0);
    expect(k.gauge).toBeCloseTo(0.185);
  });

  it('activation needs a FULL gauge', () => {
    const st = makeStage();
    st.climax.gauge = 0.99;
    st.press('climax');
    st.step();
    expect(st.climax.active).toBe(false);
    st.release('climax');
    st.climax.gauge = 1;
    const ev = [];
    st.events.on('climax', (e) => ev.push(e.phase));
    st.step();
    expect(ev).toEqual(['ready']);
    st.press('climax');
    st.step();
    expect(st.climax.active).toBe(true);
    expect(st.game.clock.timeScale).toBeCloseTo(0.25);
    expect(st.game.dynres.locked).toBe(true);
    expect(ev).toEqual(['ready', 'start']);
  });
});

describe('climax hold / release', () => {
  it('sustains while held, release ends early and keeps the remainder; re-activation needs full', () => {
    const st = makeStage();
    st.climax.gauge = 1;
    st.press('climax');
    st.step(sec(1));
    expect(st.climax.active).toBe(true);
    expect(st.climax.gauge).toBeCloseTo(1 - 1 / 5.5, 2);
    st.release('climax');
    st.step(1);
    expect(st.climax.active).toBe(false);
    const kept = st.climax.gauge;
    expect(kept).toBeGreaterThan(0.8);
    expect(st.game.clock.timeScale).toBe(1);
    st.step(sec(2.2)); // salvo (no locks) + afterburn
    expect(st.climax.phase).toBe('idle');
    expect(st.climax.gauge).toBeGreaterThanOrEqual(kept);
    expect(st.climax.ready).toBe(false);
    st.press('climax');
    st.step();
    expect(st.climax.active).toBe(false);
  });

  it('a quick tap still gives a short (0.5 s) Climax', () => {
    const st = makeStage();
    st.climax.gauge = 1;
    st.press('climax');
    st.step(2);
    st.release('climax');
    st.step(sec(0.3));
    expect(st.climax.active).toBe(true);
    st.step(sec(0.3));
    expect(st.climax.active).toBe(false);
  });

  it('lasts at most 5.5 s while held', () => {
    const st = makeStage();
    st.climax.gauge = 1;
    st.press('climax');
    st.step();
    let t = DT;
    while (st.climax.active && t < 10) {
      st.step();
      t += DT;
    }
    expect(t).toBeGreaterThan(5.4);
    expect(t).toBeLessThan(5.6);
    expect(st.climax.gauge).toBe(0);
  });

  it('toggle mode: press starts, press again ends', () => {
    const st = makeStage({ settings: { climaxToggle: true } });
    st.climax.gauge = 1;
    st.press('climax');
    st.step();
    st.release('climax');
    st.step(sec(1));
    expect(st.climax.active).toBe(true);
    st.press('climax');
    st.step();
    expect(st.climax.active).toBe(false);
    expect(st.climax.phase === 'salvo' || st.climax.phase === 'afterburn').toBe(true);
  });
});

describe('climax salvo', () => {
  it('huge circle, unlimited instant locks; the salvo fires once at every lock, 0.02 s apart, then afterburn', () => {
    const st = makeStage();
    const list = [];
    for (let i = 0; i < 24; i++) list.push(st.spawn('fighterA', (i % 6 - 3) * 60, (Math.floor(i / 6) - 2) * 40, 1800));
    st.climax.gauge = 1;
    st.press('climax');
    st.step(sec(0.6));
    expect(st.lockon.radius).toBeCloseTo(0.45);
    expect(st.lockon.locks.length).toBe(24);
    expect(st.stock.infinite).toBe(true);
    expect(st.scoring.frozen).toBe(true);
    const ev = [];
    st.events.on('climax', (e) => ev.push({ ...e }));
    st.release('climax');
    st.step(1);
    expect(ev[0]).toMatchObject({ phase: 'end', salvo: 24 });
    st.step(sec(0.6));
    expect(st.launches.length).toBe(24);
    for (const e of list) expect(st.fired.get(e.id)).toBe(1);
    for (let i = 1; i < st.launches.length; i++) expect(st.launches[i].t - st.launches[i - 1].t).toBeLessThan(0.026);
    expect(st.launches[23].t - st.launches[0].t).toBeCloseTo(23 * 0.02, 1);
    expect(st.climax.phase).toBe('afterburn');
    expect(st.player.boost).toBe(1);
    expect(st.scoring.frozen).toBe(false);
    expect(st.stock.ready).toBe(8); // salvo is free
    st.step(sec(2.1));
    expect(st.climax.phase).toBe('idle');
    expect(st.player.boost).toBe(0);
  });

  it('mashing MISSILE during Climax raises damage up to 2×; missiles are not fired while active', () => {
    const st = makeStage();
    st.spawn('stealthB', 0, 0, 1500);
    st.climax.gauge = 1;
    st.press('climax');
    st.step(2);
    for (let i = 0; i < 30; i++) {
      st.input.pressed.missile = true;
      st.step(2);
    }
    expect(st.climax.damageMul).toBe(2);
    expect(st.launches.length).toBe(0);
    st.release('climax');
    st.step(sec(0.2));
    expect(st.launches.length).toBeGreaterThan(0);
    for (const l of st.launches) expect(l.damage).toBe(COMBAT.missileDamage * 2);
  });

  it('combo is frozen during Climax', () => {
    const st = makeStage();
    st.scoring.kill({ def: { score: 1000 } });
    st.climax.gauge = 1;
    st.press('climax');
    st.step(sec(0.6));
    st.scoring.update(3, 0, 0); // StageState ticks scoring every step
    expect(st.scoring.combo).toBe(1);
    expect(st.scoring.comboTimer).toBeCloseTo(4);
    st.release('climax');
    st.step(sec(0.2));
    st.scoring.update(4.1, 0, 0);
    expect(st.scoring.combo).toBe(0);
  });

  it('destroying every Climax target pays the clear bonus and emits combo', () => {
    const st = makeStage();
    const list = [];
    for (let i = 0; i < 5; i++) list.push(st.spawn('fighterA', (i - 2) * 50, 0, 1800));
    st.climax.gauge = 1;
    st.press('climax');
    st.step(sec(0.6));
    st.release('climax');
    st.step(sec(0.3));
    const combos = [];
    st.events.on('combo', (e) => combos.push({ ...e }));
    const before = st.scoring.stage;
    for (const e of list) {
      e.dead = true;
      st.events.emit('kill', { e, src: 'missile', mode: 'instant', res: { base: 1000, bonus: 0 } });
    }
    expect(st.scoring.stage - before).toBe(2000 * 5);
    expect(combos).toEqual([{ n: 5, bonus: 10000, climax: true }]);
  });
});
