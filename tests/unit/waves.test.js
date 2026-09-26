import { describe, it, expect } from 'vitest';
import { Director, FORMATIONS } from '../../src/sim/director.js';
import { WaveGen, PATTERNS, DEFAULT_WAVES, WAVE_DEFAULTS, waveTypes } from '../../src/sim/waves.js';
import { BEHAVIORS, EnemyManager } from '../../src/sim/enemies.js';
import { STAGE_BY_ID } from '../../src/stages/campaign.js';
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
function run(waves, { seconds = 60, quality = 'high', rank = 0, life = 4, box = { x: 240, y: 100 }, timeline = [], startS = 0, onScreenCount = null, fakeOnScreen } = {}) {
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
      if (fakeOnScreen !== undefined) e.onScreen = fakeOnScreen;
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
    ...(onScreenCount ? { onScreenCount: () => onScreenCount(alive, t) } : {}),
    player: () => player,
    worldPoint: (s, x, y) => ({ x, y: y || 0, z: -s }), // flat sea at y = 0 (rail altitude 150)
    railHeading: () => 0
  };
  const dir = new Director({ timeline, waves }, api);
  let lastPatterns = 0;
  for (let i = 0; i < seconds * 120; i++) {
    t += DT;
    player.update(DT, NO_INPUT, rail, null);
    for (let k = alive.length - 1; k >= 0; k--) {
      if (alive[k].until <= t) {
        alive[k].active = false;
        alive.splice(k, 1);
      }
    }
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

  it('respects maxAlive (by quality) and the 0.6 s gap between patterns', () => {
    expect(WAVE_DEFAULTS.gap).toBe(0.6);
    for (const quality of ['high', 'low']) {
      const { maxAlive, patternT, spawns } = run({ ...BASE, rate: { base: 4, perStar: 0 } }, { seconds: 50, quality, life: 30 });
      expect(maxAlive).toBeLessThanOrEqual(quality === 'low' ? 14 : 20);
      expect(spawns.length).toBeGreaterThan(10);
      for (let i = 1; i < patternT.length; i++) expect(patternT[i] - patternT[i - 1]).toBeGreaterThanOrEqual(0.6 - 1e-6);
    }
    // defaults: 24 / 20 / 16 alive by quality
    const w = new WaveGen({});
    expect([w.maxAlive('high'), w.maxAlive('medium'), w.maxAlive('low')]).toEqual([24, 20, 16]);
    for (const quality of ['high', 'medium', 'low']) {
      const { maxAlive } = run({ ...BASE, maxAlive: undefined, rate: { base: 6, perStar: 0 } }, { seconds: 40, quality, life: 30 });
      expect(maxAlive, quality).toBeLessThanOrEqual(w.maxAlive(quality));
      expect(maxAlive, quality).toBeGreaterThanOrEqual(w.maxAlive(quality) - 6);
    }
  });

  it('default rate: ~1.8 enemies per second over a span', () => {
    const cfg = { ...BASE, rate: undefined, maxAlive: undefined, mix: DEFAULT_WAVES.mix };
    for (const rank of [0, 2]) {
      const { spawns } = run(cfg, { seconds: 50, rank, startS: 900 });
      const rate = spawns.length / 50;
      expect(rate, `rank ${rank}`).toBeGreaterThanOrEqual(1.65);
      expect(rate, `rank ${rank}`).toBeLessThanOrEqual(2.3);
    }
  });

  it('starvation: (almost) nothing on screen for 1.5 s starts the next pattern at once', () => {
    const cfg = { ...BASE, rate: { base: 0.25, perStar: 0 }, maxAlive: 40 };
    // something always on screen: the slow budget spaces the patterns out
    const busy = run(cfg, { seconds: 40, life: 30, onScreenCount: () => 3 });
    // nothing ever on screen: a pattern at most ~1.5 s after the previous one finished spawning
    const idle = run(cfg, { seconds: 40, life: 6, onScreenCount: () => 0 });
    expect(busy.dir.waves.starved).toBe(0);
    expect(idle.dir.waves.starved).toBeGreaterThan(8);
    expect(idle.patternT.length).toBeGreaterThan(busy.patternT.length * 2.5);
    for (let i = 1; i < idle.patternT.length; i++) expect(idle.patternT[i] - idle.patternT[i - 1]).toBeLessThanOrEqual(1.5 + 1.8 + 0.05);
    // fallback without api.onScreenCount: the wave's own spawns and their `onScreen` flag
    const flagged = run(cfg, { seconds: 40, life: 6, fakeOnScreen: false });
    expect(flagged.dir.waves.starved).toBeGreaterThan(8);
    const seen = run({ ...cfg, floor: 1 }, { seconds: 40, life: 30, fakeOnScreen: true });
    expect(seen.dir.waves.starved).toBe(0);
    // density floor: a single enemy on screen still counts as starving by default (floor 2), not with floor 1
    expect(WAVE_DEFAULTS.floor).toBe(2);
    expect(run(cfg, { seconds: 40, life: 6, onScreenCount: () => 1 }).dir.waves.starved).toBeGreaterThan(8);
    expect(run({ ...cfg, floor: 1 }, { seconds: 40, life: 6, onScreenCount: () => 1 }).dir.waves.starved).toBe(0);
    // never in quiet spans or outside spans, and never past maxAlive
    const quiet = run({ ...cfg, maxAlive: 12, spans: [{ from: 900, to: 12000 }], quiet: [[4000, 6500]] }, { seconds: 50, life: 30, onScreenCount: () => 0 });
    expect(quiet.maxAlive).toBeLessThanOrEqual(12);
    expect(quiet.spawns.length).toBeGreaterThan(5);
    for (const sp of quiet.spawns) expect((sp.s >= 4000 && sp.s <= 6500) || sp.s < 900 - 1).toBe(false);
  });

  it('is deterministic with every pattern in the mix', () => {
    const cfg = { ...BASE, mix: ALL, rate: { base: 2.5 } };
    const a = run(cfg, { seconds: 40, rank: 2 }).spawns;
    const b = run(cfg, { seconds: 40, rank: 2 }).spawns;
    expect(a.length).toBeGreaterThan(60);
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(b[i].behavior).toBe(a[i].behavior);
      expect(b[i].t).toBe(a[i].t);
      expect(b[i].rx).toBe(a[i].rx);
      expect(b[i].ry).toBe(a[i].ry);
      expect(b[i].rel).toBe(a[i].rel);
    }
    const behaviors = new Set(a.map((s) => s.behavior));
    for (const bname of ['overheadPass', 'headOnPass', 'pincer', 'overtakeClose']) expect(behaviors.has(bname), bname).toBe(true);
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

// ------------------------------------------------------------ new patterns
/**
 * Fly one pattern against a real Player + EnemyManager: spawns resolve their
 * player-relative offsets like WaveGen._spawn and appear at their `dt`.
 * Returns per-enemy tracks [{t, rel, dx, dy, ry, d, beh, r}] relative to the player.
 */
function fly(name, { seed = 5, rank = 1, steer = null, seconds = 9, py = 0, yLo = -100, box = { x: 240, y: 100 } } = {}) {
  const rng = new Rng(seed);
  const gen = new WaveGen({ mix: [[name, 1]] });
  const c = gen._ctx;
  const player = new Player();
  player.reset({ s: 2000, baseSpeed: 240, box, y: py });
  player.lateralSpeed = 150;
  player.computePose(rail);
  Object.assign(c, { s: player.s, px: player.x, py: player.y, rank, quality: 'high', xLim: 1.1 * box.x, yLo, yHi: box.y });
  const specs = PATTERNS[name](rng, c, {});
  const mgr = new EnemyManager({ rng: new Rng(seed + 1) });
  const ctx = { player, rail, rng: new Rng(seed + 2), fireMissile: () => false, fireGun: () => {} };
  const dir = new Director({ timeline: [] }, { spawn: (type, o) => mgr.spawn(type, o), worldPoint: (s, x, y) => ({ x, y: y || 0, z: -s }), railHeading: () => 0 });
  const tracks = new Map();
  const queue = specs.map((sp) => ({ ...sp })).sort((a, b) => a.dt - b.dt);
  let t = 0;
  for (let i = 0; i < seconds * 120; i++) {
    while (queue.length && queue[0].dt <= t + 1e-9) {
      const sp = queue.shift();
      if (sp.rel) {
        sp.x = c.clampX(player.x + sp.dx, sp.half || 0);
        sp.y = c.clampY(player.y + sp.dy, sp.vm ?? 8);
      }
      for (const e of dir.spawnGroup(sp, player)) tracks.set(e, []);
    }
    player.update(DT, steer ? steer(t) : NO_INPUT, rail, null);
    mgr.update(DT, ctx);
    t += DT;
    for (const [e, tr] of tracks) {
      if (!e.active || tr.done) {
        tr.done = true;
        continue;
      }
      tr.push({ t, rel: e.rs - player.s, dx: e.rx - player.x, dy: e.ry - player.y, ry: e.ry, d: e.pos.distanceTo(player.pos), beh: e.behaviorName, r: e.radius });
    }
  }
  return { specs, tracks: [...tracks.values()], player };
}

const weaveSteer = (t) => ({ moveX: Math.sin(t * 1.3) * 0.6, moveY: Math.sin(t * 0.9) * 0.4, throttleAxis: 0 });
const CANOPY = 1.5; // canopy top above the player's centre (m)
const BELLY = 1.0 * 1.8; // enemy belly below its centre at render scale (m)

describe('waves: new pattern geometry', () => {
  it('overheadPass: 2–4 fighters 0.35 s apart from 250 m behind, ≥ 10 m over the canopy, within 30 m laterally, then targets ahead', () => {
    for (let seed = 1; seed <= 6; seed++) {
      for (const steer of [null, weaveSteer]) {
        const { specs, tracks } = fly('overheadPass', { seed, rank: seed % 3, steer });
        expect(specs.length).toBeGreaterThanOrEqual(2);
        expect(specs.length).toBeLessThanOrEqual(4);
        specs.forEach((sp, i) => {
          expect(sp.dt).toBeCloseTo(i * 0.35);
          expect(sp.dist).toBe(-250);
        });
        const cross = [];
        for (const tr of tracks) {
          expect(tr[0].rel).toBeLessThan(-200); // from behind
          const over = tr.filter((p) => Math.abs(p.rel) < 25);
          expect(over.length).toBeGreaterThan(0);
          for (const p of over) {
            expect(p.dy - CANOPY - BELLY, 'canopy clearance').toBeGreaterThanOrEqual(10);
            expect(Math.abs(p.dx), 'lateral').toBeLessThanOrEqual(30);
            expect(p.d).toBeGreaterThan(p.r + 3); // never a collision
          }
          cross.push(tr.find((p) => p.rel >= 0).t);
          // climbs away ahead, then a regular target ahead of the player
          const ahead = tr.find((p) => p.beh === 'overtake');
          expect(ahead, 'becomes a target').toBeTruthy();
          expect(ahead.rel).toBeGreaterThan(300);
          expect(ahead.dy).toBeGreaterThan(20);
        }
        for (let i = 1; i < cross.length; i++) expect(cross[i] - cross[i - 1]).toBeCloseTo(0.35, 1);
      }
    }
  });

  it('underPass: passes under the jet (floor permitting) and pulls up ahead', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { tracks } = fly('underPass', { seed, py: 40 });
      for (const tr of tracks) {
        const under = tr.filter((p) => Math.abs(p.rel) < 25);
        expect(under.length).toBeGreaterThan(0);
        for (const p of under) {
          expect(p.dy).toBeLessThanOrEqual(-15);
          expect(Math.abs(p.dx)).toBeLessThanOrEqual(30);
        }
        const ahead = tr.find((p) => p.beh === 'overtake');
        expect(ahead).toBeTruthy();
        expect(ahead.dy).toBeGreaterThan(20); // pulled up into view
      }
    }
    // player low over the sea: the floor (yLo - 4 = -34) wins, the clearance is kept sideways
    for (let seed = 1; seed <= 4; seed++) {
      const { tracks } = fly('underPass', { seed, py: -20, yLo: -30 });
      for (const tr of tracks) {
        for (const p of tr.filter((q) => Math.abs(q.rel) < 25)) {
          expect(p.ry).toBeGreaterThanOrEqual(-34 - 1e-6);
          expect(p.d).toBeGreaterThan(p.r + 3);
        }
      }
    }
  });

  it('headOnPass: a pair / V from 1.4–1.7 km that flies right past 25–40 m away (near miss), never breaking off early', () => {
    let near = 0, total = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const { specs, tracks } = fly('headOnPass', { seed, rank: seed % 2 });
      expect([2, 3]).toContain(specs.length);
      for (const tr of tracks) {
        total++;
        expect(tr[0].rel).toBeGreaterThan(1300);
        let min = Infinity, at = null;
        for (const p of tr) {
          if (p.d < min) {
            min = p.d;
            at = p;
          }
        }
        expect(min).toBeGreaterThan(at.r + 3 + 2);
        expect(min).toBeLessThan(45);
        expect(Math.abs(at.rel)).toBeLessThan(40); // closest approach right at the pass
        if (min < 35) near++;
        expect(tr[tr.length - 1].rel).toBeLessThan(-150); // flew on behind us
      }
    }
    expect(near / total).toBeGreaterThan(0.5); // mostly near-miss bonuses
  });

  it('pincer: two groups from the left and right converge and cross in front of the player', () => {
    for (let seed = 1; seed <= 5; seed++) {
      for (const box of [{ x: 240, y: 100 }, { x: 70, y: 36 }]) {
        const { specs, tracks } = fly('pincer', { seed, rank: 2, box });
        expect([4, 6]).toContain(specs.length);
        const left = tracks.filter((tr) => tr[0].dx < 0);
        const right = tracks.filter((tr) => tr[0].dx > 0);
        expect(left.length).toBe(right.length);
        // the leaders swap sides while still well ahead
        const L = left[0], R = right[0];
        const n = Math.min(L.length, R.length);
        let swapRel = null;
        for (let i = 0; i < n; i++) {
          if (L[i].dx > R[i].dx) {
            swapRel = L[i].rel;
            break;
          }
        }
        expect(swapRel, 'groups cross').not.toBe(null);
        expect(swapRel).toBeGreaterThan(200);
        expect(swapRel).toBeLessThan(700);
      }
    }
  });

  it('overtakeStream: 4–6 overtakers from behind on alternating sides', () => {
    const rng = new Rng(4);
    const c = new WaveGen({})._ctx;
    for (let k = 0; k < 20; k++) {
      const list = PATTERNS.overtakeStream(rng, c, {});
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(6);
      for (let i = 0; i < list.length; i++) {
        expect(list[i].behavior).toBe('overtakeClose');
        expect(list[i].dist).toBeLessThan(-200);
        if (i) expect(Math.sign(list[i].dx)).toBe(-Math.sign(list[i - 1].dx));
      }
    }
  });
});

describe('waves: stage mixes', () => {
  const ids = ['ocean', 'emerald', 'canyon', 'sunset', 'glacier', 'dunes', 'clouds', 'strike', 'fortress'];
  it('every stage flies head-on passes and pincers at ~1.8/s, with ≥ 20 % of its aircraft from behind', () => {
    const behind = new Set(['overheadPass', 'overtakeClose', 'chaser']);
    for (const id of ids) {
      const w = STAGE_BY_ID[id].waves;
      const names = w.mix.map((m) => m[0]);
      expect(names, id).toContain('headOnPass');
      expect(names, id).toContain('pincer');
      expect(w.rate.base, id).toBeGreaterThanOrEqual(1.8);
      const from = w.spans?.[0]?.from ?? 900;
      const { spawns } = run({ ...w, quiet: [], spans: null }, { seconds: 40, startS: from + 4000, rank: 1 });
      const air = spawns.filter((sp) => !sp.world);
      const back = air.filter((sp) => behind.has(sp.behavior)).length / Math.max(1, air.length);
      expect(spawns.length / 40, `${id} rate`).toBeGreaterThanOrEqual(1.6);
      expect(back, `${id} from behind`).toBeGreaterThanOrEqual(0.2);
    }
    for (const id of ['ocean', 'clouds', 'sunset']) {
      const names = STAGE_BY_ID[id].waves.mix.map((m) => m[0]);
      expect(names, id).toContain('overheadPass');
      expect(names, id).toContain('underPass');
    }
    expect(STAGE_BY_ID.dunes.waves.mix.map((m) => m[0])).toContain('overtakeStream');
  });
});
