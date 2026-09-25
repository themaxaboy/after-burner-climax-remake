import { describe, it, expect } from 'vitest';
import { Director, FORMATIONS } from '../../src/sim/director.js';
import { WaveGen, PATTERNS, DEFAULT_WAVES, waveTypes } from '../../src/sim/waves.js';
import { BEHAVIORS } from '../../src/sim/enemies.js';
import { ENEMY_TYPES } from '../../src/sim/enemyTypes.js';
import { Rail } from '../../src/sim/rail.js';
import { Player } from '../../src/sim/player.js';
import { Rng } from '../../src/core/rng.js';
import { buildRail } from '../../src/stages/railBuilder.js';

const DT = 1 / 120;
const NO_INPUT = { moveX: 0, moveY: 0, throttleAxis: 0 };
const rail = new Rail({ points: buildRail({ start: [0, 150, 0], segs: [{ len: 30000, turn: 20 }] }) });
const ALL = Object.keys(PATTERNS).map((n) => [n, 1]);

const BASE = {
  seed: 7,
  rate: { base: 1.3, perStar: 0.12 },
  maxAlive: { high: 20, low: 14 },
  spans: [{ from: 900, to: 14000 }],
  quiet: [],
  mix: [['vHeadOn', 4], ['lineHeadOn', 2], ['rammerPair', 2], ['rammerSolo', 1], ['overtakeClose', 2], ['crossSweep', 1], ['swarmPass', 1], ['chaserPair', 1, { minS: 4000 }], ['heavyPair', 1]],
  types: { light: 'fighterA', heavy: 'stealthB' }
};

/**
 * Run the Director with only a waves config for `seconds` of flight.
 * Enemies "live" `life` seconds (stand-in for kills/escapes).
 */
function run(waves, { seconds = 60, quality = 'high', rank = 0, life = 4, box = { x: 240, y: 100 }, timeline = [], startS = 0 } = {}) {
  const player = new Player();
  player.reset({ s: startS, baseSpeed: 240, box });
  player.computePose(rail);
  let t = 0;
  const alive = [];
  const spawns = [];
  const patternT = [];
  let maxAlive = 0;
  const api = {
    spawn: (type, o) => {
      expect(ENEMY_TYPES[type], type).toBeTruthy();
      expect(BEHAVIORS[o.behavior], o.behavior).toBeTruthy();
      const e = { type, id: spawns.length + 1, until: t + life };
      alive.push(e);
      spawns.push({ t, s: player.s, type, behavior: o.behavior, rx: o.rx, ry: o.ry, rel: o.rs - player.s, world: !!o.world });
      return e;
    },
    cue() {},
    radio() {},
    message() {},
    eoEvent() {},
    end() {},
    rank: () => rank,
    quality: () => quality,
    aliveCount: () => alive.length,
    player: () => player,
    worldPoint: (s, x, y) => ({ x, y: y || 0, z: -s }), // flat sea at y = 0 (rail altitude 150)
    railHeading: () => 0
  };
  const dir = new Director({ timeline, waves }, api);
  let lastPatterns = 0;
  for (let i = 0; i < seconds * 120; i++) {
    t += DT;
    player.update(DT, NO_INPUT, rail, null);
    for (let k = alive.length - 1; k >= 0; k--) if (alive[k].until <= t) alive.splice(k, 1);
    dir.update(DT, player);
    if (dir.waves && dir.waves.patterns !== lastPatterns) {
      lastPatterns = dir.waves.patterns;
      patternT.push(t);
    }
    maxAlive = Math.max(maxAlive, alive.length);
  }
  return { spawns, maxAlive, patternT, dir, player };
}

describe('waves: pattern library', () => {
  it('every pattern produces valid spawn specs', () => {
    const rng = new Rng(3);
    const c = new WaveGen({ mix: ALL })._ctx;
    Object.assign(c, { s: 5000, px: 10, py: 5, rank: 2, quality: 'high', xLim: 264, yLo: -80, yHi: 100 });
    for (const [name] of ALL) {
      for (let k = 0; k < 20; k++) {
        const list = PATTERNS[name](rng, c, {});
        expect(list.length, name).toBeGreaterThan(0);
        for (const sp of list) {
          expect(ENEMY_TYPES[sp.type], `${name} type ${sp.type}`).toBeTruthy();
          expect(BEHAVIORS[sp.behavior], `${name} behavior`).toBeTruthy();
          if (sp.formation) expect(FORMATIONS[sp.formation], sp.formation).toBeTruthy();
          expect(sp.dt).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(sp.dist)).toBe(true);
        }
      }
    }
  });

  it('swarmPass spawns 8–12 aircraft, rammers are flagged as rammers', () => {
    const rng = new Rng(9);
    const c = new WaveGen({})._ctx;
    for (let k = 0; k < 20; k++) {
      const n = PATTERNS.swarmPass(rng, c, {}).length;
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(12);
    }
    expect(PATTERNS.rammerPair(rng, c, {}).every((sp) => sp.behavior === 'rammer')).toBe(true);
  });

  it('unknown patterns are rejected; waveTypes lists what a config can spawn', () => {
    expect(() => new WaveGen({ mix: [['nope', 1]] })).toThrow();
    const types = waveTypes({ mix: [['vHeadOn', 1], ['heavyPair', 1], ['groundSites', 1], ['boatGroup', 1], ['heloLine', 1]], types: { heavy: 'stealthB' } });
    for (const ty of ['fighterA', 'stealthB', 'samSite', 'aaGun', 'samBoat', 'heloCH47']) expect(types).toContain(ty);
    expect(waveTypes(DEFAULT_WAVES)).toContain('stealthB');
  });
});

describe('waves: scheduler', () => {
  it('spawns 1.2–1.6 enemies per second over a span', () => {
    for (const rank of [0, 2]) {
      // start inside the span and fly 50 s (12 km) without leaving it
      const { spawns } = run(BASE, { seconds: 50, rank, startS: 900 });
      const rate = spawns.length / 50;
      expect(rate, `rank ${rank}`).toBeGreaterThanOrEqual(1.2);
      expect(rate, `rank ${rank}`).toBeLessThanOrEqual(1.6);
      expect(spawns[spawns.length - 1].t).toBeGreaterThan(45);
    }
  });

  it('about 80 enemies in a 55 s stage', () => {
    const { spawns } = run({ ...BASE, spans: [{ from: 300, to: 1e9 }] }, { seconds: 55, rank: 1 });
    expect(spawns.length).toBeGreaterThanOrEqual(65);
    expect(spawns.length).toBeLessThanOrEqual(95);
  });

  it('is deterministic per seed', () => {
    const a = run(BASE, { seconds: 30 }).spawns;
    const b = run(BASE, { seconds: 30 }).spawns;
    const c = run({ ...BASE, seed: 8 }, { seconds: 30 }).spawns;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].type).toBe(b[i].type);
      expect(a[i].behavior).toBe(b[i].behavior);
      expect(a[i].t).toBe(b[i].t);
      expect(a[i].rx).toBe(b[i].rx);
      expect(a[i].ry).toBe(b[i].ry);
    }
    const sig = (l) => l.map((s) => `${s.behavior}:${s.rx.toFixed(1)}`).join('|');
    expect(sig(c)).not.toBe(sig(a));
  });

  it('respects maxAlive (by quality) and the 1 s gap between patterns', () => {
    for (const quality of ['high', 'low']) {
      const { maxAlive, patternT, spawns } = run({ ...BASE, rate: { base: 4, perStar: 0 } }, { seconds: 50, quality, life: 30 });
      expect(maxAlive).toBeLessThanOrEqual(quality === 'low' ? 14 : 20);
      expect(spawns.length).toBeGreaterThan(10);
      for (let i = 1; i < patternT.length; i++) expect(patternT[i] - patternT[i - 1]).toBeGreaterThanOrEqual(1 - 1e-6);
    }
  });

  it('spawns inside ±1.1·box.x and the vertical box (above the floor)', () => {
    for (const box of [{ x: 240, y: 100 }, { x: 70, y: 36 }]) {
      const mix = ALL.filter(([n]) => n !== 'boatGroup' && n !== 'groundSites');
      const { spawns } = run({ ...BASE, mix, rate: { base: 2 } }, { seconds: 60, box, rank: 3 });
      expect(spawns.length).toBeGreaterThan(60);
      for (const s of spawns) {
        expect(Math.abs(s.rx), `${s.behavior} rx`).toBeLessThanOrEqual(1.1 * box.x + 1e-6);
        expect(s.ry, `${s.behavior} ry`).toBeGreaterThanOrEqual(-box.y - 1e-6);
        expect(s.ry, `${s.behavior} ry`).toBeLessThanOrEqual(box.y + 1e-6);
      }
    }
    // ground / sea units: lateral bound too
    const { spawns } = run({ ...BASE, mix: [['groundSites', 1], ['boatGroup', 1]] }, { seconds: 30 });
    expect(spawns.length).toBeGreaterThan(10);
    for (const s of spawns) {
      expect(s.world).toBe(true);
      expect(Math.abs(s.rx)).toBeLessThanOrEqual(1.1 * 240 + 1e-6);
    }
  });

  it('pauses in quiet spans and outside spans', () => {
    const cfg = { ...BASE, spans: [{ from: 900, to: 12000 }], quiet: [[4000, 6500]] };
    const { spawns } = run(cfg, { seconds: 60 });
    expect(spawns.some((s) => s.s > 6500 && s.s < 12000)).toBe(true);
    expect(spawns.some((s) => s.s > 900 && s.s < 4000)).toBe(true);
    for (const s of spawns) {
      expect(s.s >= 4000 && s.s <= 6500, `spawn at ${s.s.toFixed(0)}`).toBe(false);
      expect(s.s >= 900 - 1 && s.s <= 12000 + 1).toBe(true);
    }
  });

  it('timeline events switch waves off/on and retune the rate', () => {
    const timeline = [
      { at: 3000, waves: 'off' },
      { at: 5000, waves: 'on' },
      { at: 8000, waves: { rate: 3 } }
    ];
    const { spawns } = run({ ...BASE, spans: null, maxAlive: 40 }, { seconds: 60, timeline, life: 3 });
    for (const s of spawns) expect(s.s > 3000 && s.s < 5000, `spawn at ${s.s.toFixed(0)}`).toBe(false);
    const n = (a, b) => spawns.filter((s) => s.s >= a && s.s < b).length / ((b - a) / 240);
    expect(n(8500, 13500)).toBeGreaterThan(n(5500, 7900) * 1.5);
  });

  it('?waves=1 (api.forceWaves) runs the default generator on a stage without def.waves', () => {
    const api = { spawn: () => ({}), cue() {}, radio() {}, message() {}, eoEvent() {}, end() {}, rank: () => 0, forceWaves: () => true };
    expect(new Director({ timeline: [] }, api).waves).toBeInstanceOf(WaveGen);
    expect(new Director({ timeline: [] }, { ...api, forceWaves: () => false }).waves).toBe(null);
  });
});
