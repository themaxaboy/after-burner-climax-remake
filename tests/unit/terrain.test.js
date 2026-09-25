import { describe, it, expect } from 'vitest';
import { makeCanyonShape } from '../../src/world/terrain/canyonShape.js';
import { makeTerrainShape, makeCentre, CENTRE_MAX_SLOPE } from '../../src/world/terrain/profiles.js';
import { buildChunk, corridorWeights } from '../../src/world/terrain/chunkBuilder.js';
import { lateralColumns } from '../../src/world/terrain/canyonStreamer.js';
import { shapeDef, INNER_HALF } from '../../src/world/terrain/terrainStreamer.js';
import { layoutObstacles, maxFreeGap, partDistance, ObstacleField, MIN_GAP } from '../../src/world/terrain/obstacles.js';
import { TERRAIN_EXAMPLES, EXAMPLE_RAIL } from '../../src/world/terrain/examples.js';
import { TerrainRun } from '../../src/stages/common/terrainRun.js';
import { buildRail } from '../../src/stages/railBuilder.js';
import { Rail, makeFrame } from '../../src/sim/rail.js';
import { Player } from '../../src/sim/player.js';
import { Events } from '../../src/core/events.js';
import { MeshStandardMaterial, Scene, Vector3 } from 'three';
import stage2 from '../../src/stages/stage2_canyon.js';

const shape = makeCanyonShape(stage2.terrain);
const rail = new Rail(stage2.rail);
const f = makeFrame();

function chunk(sh, rl, s0, rows, ds, { inner, lat } = {}) {
  lat = lat || new Float32Array(lateralColumns(2200, 300, 8, 12));
  const s = new Float32Array(rows + 2);
  const frames = new Float32Array((rows + 2) * 5);
  const up = new Vector3(0, 1, 0);
  const rh = new Vector3();
  const fr = makeFrame();
  for (let r = 0; r < rows + 2; r++) {
    s[r] = s0 + (r - 1) * ds;
    rl.frameAt(s[r], fr);
    rh.crossVectors(fr.T, up).normalize();
    frames.set([fr.pos.x, fr.pos.y, fr.pos.z, rh.x, rh.z], r * 5);
  }
  const msg = { rows, cols: lat.length, lat, s, frames, origin: [frames[5], frames[7]], inner };
  return { ...buildChunk(sh, msg), msg };
}

describe('canyon terrain', () => {
  it('is deterministic', () => {
    expect(shape.heightAt(12345, 37, 30)).toBe(makeCanyonShape(stage2.terrain).heightAt(12345, 37, 30));
  });

  it('keeps the flight path clear inside the canyon', () => {
    for (let s = 6800; s < 27000; s += 50) {
      rail.frameAt(s, f);
      const floor = shape.heightAt(s, 0, f.pos.y);
      expect(f.pos.y - floor, `clearance at ${s}`).toBeGreaterThan(18);
      const fw = shape.flyableHalfWidth(s);
      expect(fw, `width at ${s}`).toBeGreaterThan(30);
      // walls rise outside the flyable width
      expect(shape.heightAt(s, fw + 90, f.pos.y)).toBeGreaterThan(floor + 30);
    }
  });

  it('builds finite geometry with upward normals', () => {
    const c = chunk(shape, rail, 10000, 21, 10);
    for (let i = 0; i < c.pos.length; i++) expect(Number.isFinite(c.pos[i])).toBe(true);
    let up = 0;
    for (let i = 1; i < c.nor.length; i += 3) if (c.nor[i] > 0) up++;
    expect(up).toBe(c.nor.length / 3);
  });

  it('matches heights across chunk borders', () => {
    const a = chunk(shape, rail, 10000, 21, 10);
    const b = chunk(shape, rail, 10200, 21, 10);
    const cols = a.pos.length / 3 / 21;
    // last row of a vs first row of b (world space)
    rail.frameAt(10000, f);
    const oa = f.pos.clone();
    rail.frameAt(10200, f);
    const ob = f.pos.clone();
    for (let c = 0; c < cols; c += 7) {
      const ia = (20 * cols + c) * 3, ib = c * 3;
      expect(a.pos[ia + 1]).toBeCloseTo(b.pos[ib + 1], 3);
      expect(a.pos[ia] + oa.x).toBeCloseTo(b.pos[ib] + ob.x, 1);
    }
  });

  it('rail turns are gentle enough that the terrain ribbon never folds', () => {
    let maxCurv = 0;
    for (let s = 0; s < rail.length; s += 20) maxCurv = Math.max(maxCurv, Math.abs(rail.curvatureAt(s)));
    expect(1 / maxCurv).toBeGreaterThan(2200);
  });
});

const exRail = new Rail({ points: buildRail(EXAMPLE_RAIL) });
const _v = new Vector3();
const exRailY = (s) => exRail.positionAt(s, _v).y;

describe('terrain profiles', () => {
  it('worker and main thread agree on every vertex height (all profiles, swinging corridor)', () => {
    const lat = new Float32Array(lateralColumns(2200, INNER_HALF, 10, 12));
    for (const [name, def] of Object.entries(TERRAIN_EXAMPLES)) {
      const main = makeTerrainShape(def);
      const worker = makeTerrainShape(shapeDef(def)); // what the worker receives (structured clone)
      expect(main.centre.active, name).toBe(true);
      for (const s0 of [4000, 7800]) {
        const c = chunk(worker, exRail, s0, 11, 20, { inner: INNER_HALF, lat });
        const { s, frames } = c.msg;
        const latP = new Float32Array(lat.length + 2);
        latP[0] = lat[0] - (lat[1] - lat[0]);
        latP[latP.length - 1] = lat[lat.length - 1] + (lat[lat.length - 1] - lat[lat.length - 2]);
        latP.set(lat, 1);
        const w = corridorWeights(latP, INNER_HALF);
        for (let r = 0; r < 11; r++) {
          const sr = s[r + 1], py = frames[(r + 1) * 5 + 1];
          const cr = main.centreAt(sr);
          for (let k = 0; k < lat.length; k += 5) {
            const lt = lat[k] + cr * w[k + 1];
            const y = c.pos[(r * lat.length + k) * 3 + 1];
            expect(y, `${name} s=${sr} l=${lt}`).toBeCloseTo(main.heightAt(sr, lt, py), 4);
          }
        }
      }
    }
  });

  it('dense columns follow the corridor and the ribbon edge stays put', () => {
    const lat = [-2200, -1000, -400, -340, 0, 340, 400, 1000, 2200];
    const w = corridorWeights(Float32Array.from(lat), 340);
    expect(w[4]).toBe(1);
    expect(w[3]).toBe(1);
    expect(w[0]).toBe(0);
    expect(w[8]).toBe(0);
    expect(w[7]).toBeGreaterThan(0);
    expect(w[7]).toBeLessThan(1);
  });

  it('limits the corridor swing rate and offset', () => {
    const configs = [
      { amp: 200, wavelength: 900, from: 1000, to: 9000 },
      { amp: 90, wavelength: 2200, from: 0, to: 20000, phase: 1 },
      { keys: [[1000, 0], [1100, 120], [1300, -140], [4000, 60]] }
    ];
    for (const cfg of configs) {
      const c = makeCentre(cfg);
      let maxSlope = 0, maxOff = 0;
      for (let s = 0; s < 21000; s += 2) {
        maxSlope = Math.max(maxSlope, Math.abs(c.at(s + 1) - c.at(s - 1)) / 2);
        maxOff = Math.max(maxOff, Math.abs(c.at(s)));
      }
      expect(maxSlope, JSON.stringify(cfg)).toBeLessThanOrEqual(CENTRE_MAX_SLOPE + 0.005);
      expect(maxOff).toBeLessThanOrEqual(150.01);
    }
    // gentle swings are not touched, and the corridor eases in from zero
    const g = makeCentre({ amp: 90, wavelength: 2200, from: 2000, to: 12000 });
    expect(g.scale).toBe(1);
    expect(g.at(2000)).toBe(0);
    expect(Math.abs(g.at(2000 + 2200 * 1.25))).toBeCloseTo(90, 0);
  });

  it('heights follow the swinging corridor', () => {
    const def = TERRAIN_EXAMPLES.canyon;
    const sh = makeTerrainShape(def);
    const flat = makeTerrainShape({ ...def, centre: null });
    for (const s of [4100, 6000, 8800]) {
      const c = sh.centreAt(s);
      expect(Math.abs(c)).toBeGreaterThan(5);
      expect(sh.heightAt(s, 30 + c, 40)).toBeCloseTo(flat.heightAt(s, 30, 40), 6);
    }
  });

  it('valley: river/fjord floor under the water, peaks and snow line above', () => {
    const fj = makeTerrainShape(TERRAIN_EXAMPLES.fjord);
    const va = makeTerrainShape(TERRAIN_EXAMPLES.valley);
    for (let s = 3000; s < 12000; s += 400) {
      const c = fj.centreAt(s);
      expect(fj.heightAt(s, c, 40), `fjord floor at ${s}`).toBeLessThan(0);
      const fw = fj.flyableHalfWidth(s);
      expect(fj.heightAt(s, c + fw + 500, 40)).toBeGreaterThan(fj.snowLine * 0.8);
      // the river channel dips below the water, the meadows stay above
      let minH = Infinity, maxH = -Infinity;
      for (let l = -60; l <= 60; l += 4) {
        const h = va.heightAt(s, va.centreAt(s) + l, 40);
        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
      }
      expect(minH).toBeLessThan(0);
      expect(maxH).toBeGreaterThan(0);
    }
    expect(fj.waterLevel).toBe(0);
  });

  it('floorAt never exceeds the terrain and ignores the walls', () => {
    for (const def of Object.values(TERRAIN_EXAMPLES)) {
      const sh = makeTerrainShape(def);
      for (let s = 2000; s < 13000; s += 700) {
        const c = sh.centreAt(s);
        for (let l = -300; l <= 300; l += 25) {
          expect(sh.floorAt(s, c + l, 40)).toBeLessThanOrEqual(sh.heightAt(s, c + l, 40) + 1e-9);
        }
        if (sh.profile === 'dunes' || sh.sectionAt(s).depth < 100) continue;
        const fw = sh.flyableHalfWidth(s);
        const wall = sh.heightAt(s, c + fw + 120, 40);
        expect(sh.floorAt(s, c + fw + 120, 40)).toBeLessThan(wall - 5);
      }
    }
  });

  it('dunes: low inside the soft corridor, big dunes outside', () => {
    const sh = makeTerrainShape(TERRAIN_EXAMPLES.dunes);
    let inMax = -Infinity, outMax = -Infinity;
    for (let s = 3000; s < 12000; s += 20) {
      const c = sh.centreAt(s);
      inMax = Math.max(inMax, sh.heightAt(s, c, 0));
      outMax = Math.max(outMax, sh.heightAt(s, c + 320, 0), sh.heightAt(s, c - 320, 0));
    }
    expect(inMax).toBeLessThan(30);
    expect(outMax).toBeGreaterThan(inMax + 25);
  });
});

describe('terrain obstacles', () => {
  const scatter = {
    seed: 77,
    ...TERRAIN_EXAMPLES.canyon,
    obstacles: [
      { s: 3000, l: 0, kind: 'arch' },
      { s: 3200, l: 10, kind: 'pillar', r: 25 },
      { s: 5000, l: 0, kind: 'bridge', h: 50 },
      { from: 2500, to: 13000, every: [90, 160], kinds: ['pillar', 'spire', 'tower', 'arch', 'bridge'], lat: [-1, 1] },
      { from: 2500, to: 13000, every: [120, 200], kinds: ['pillar', 'spire'], lat: [-0.3, 0.3], r: [20, 30] }
    ]
  };

  it('keeps a free lateral gap of at least 45 m at every s (scatter + explicit)', () => {
    for (const def of [scatter, ...Object.values(TERRAIN_EXAMPLES)]) {
      const sh = makeTerrainShape(def);
      const lay = layoutObstacles(def, { shape: sh, railY: exRailY, boxX: 200, length: exRail.length });
      if (def === scatter) expect(lay.list.length).toBeGreaterThan(25);
      for (let s = 0; s < exRail.length; s += 2) {
        const c = sh.centreAt(s);
        const fw = Math.min(sh.flyableHalfWidth(s), 320);
        const gap = maxFreeGap(lay.parts, s, Math.max(c - fw, -200), Math.min(c + fw, 200));
        expect(gap, `gap at ${s}`).toBeGreaterThanOrEqual(MIN_GAP);
      }
    }
  });

  it('is deterministic', () => {
    const sh = makeTerrainShape(scatter);
    const a = layoutObstacles(scatter, { shape: sh, railY: exRailY, boxX: 200 });
    const b = layoutObstacles(scatter, { shape: makeTerrainShape(scatter), railY: exRailY, boxX: 200 });
    expect(a.list.map((o) => [o.kind, o.s, o.x])).toEqual(b.list.map((o) => [o.kind, o.s, o.x]));
  });

  it('collision queries: inside a pillar is negative, beside / above it positive, under an arch is free', () => {
    const def = { ...TERRAIN_EXAMPLES.canyon, obstacles: [{ s: 4000, l: 0, kind: 'pillar', r: 18, h: 160 }, { s: 6000, l: 0, kind: 'arch', h: 70 }] };
    const sh = makeTerrainShape(def);
    const field = new ObstacleField({ def, shape: sh, rail: exRail, scene: new Scene(), rockMaterial: new MeshStandardMaterial(), propMaterial: new MeshStandardMaterial() });
    const pillar = field.list.find((o) => o.kind === 'pillar');
    const arch = field.list.find((o) => o.kind === 'arch');
    const y = exRailY(4000);
    expect(field.query(pillar.s, pillar.x, y)).toBeLessThan(0);
    expect(field.query(pillar.s, pillar.x + 8, y)).toBeLessThan(0);
    expect(field.query(pillar.s, pillar.x + 30, y)).toBeGreaterThan(5);
    expect(field.query(pillar.s - 40, pillar.x, y)).toBeGreaterThan(15);
    expect(field.query(pillar.s, pillar.x, pillar.top + 20)).toBeGreaterThan(15);
    expect(field.query(9000, 0, y)).toBe(Infinity);
    // arch: beam is solid, the opening under it is free
    const mid = (arch.legs[0] + arch.legs[1]) / 2;
    expect(field.query(arch.s, mid, (arch.beamY0 + arch.beamY1) / 2)).toBeLessThan(0);
    expect(field.query(arch.s, mid, arch.beamY0 - 20)).toBeGreaterThan(15);
    expect(field.query(arch.s, arch.legs[0], arch.beamY0 - 30)).toBeLessThan(0);
    for (const p of field.parts) expect(partDistance(p, p.s0 - 200, 0, 0)).toBeGreaterThan(100);
    // meshes: one instanced mesh per kind, instances inside the window
    field.update(3900);
    const pm = field.meshes.find((m) => m.key === 'pillar');
    expect(pm.mesh.count).toBe(3); // pillar + two arch legs
    field.update(20000);
    expect(pm.mesh.count).toBe(0);
    field.dispose();
  });
});

/** TerrainRun without init(): shape + sync height queries + obstacles, on a fake stage. */
function makeRun(def) {
  const p = new Player();
  const box = { x: 200, y: 80 };
  p.reset({ s: 150, baseSpeed: 240, box });
  p.lateralSpeed = 150;
  p.verticalSpeed = 100;
  p.computePose(exRail);
  const hits = [];
  const events = new Events();
  const stage = {
    game: { settings: { difficulty: 'normal' } },
    rail: exRail,
    player: p,
    def: { rail: { box } },
    ctx: {},
    hudExtra: {},
    autopilotHint: { x: null, y: null },
    events,
    difficulty: { terrain: 25 },
    fx: {},
    playerHit: (amount, kind) => hits.push({ amount, kind, s: p.s })
  };
  const run = new TerrainRun(stage, def);
  const sh = makeTerrainShape(def);
  run.shape = sh;
  run.streamer = { heightAt: (s, l) => sh.heightAt(s, l, exRailY(s)), floorAt: (s, l) => sh.floorAt(s, l, exRailY(s)), railY: exRailY, update() {} };
  run.obstacles = new ObstacleField({ def, shape: sh, rail: exRail, scene: new Scene(), rockMaterial: new MeshStandardMaterial(), propMaterial: new MeshStandardMaterial() });
  return { run, stage, p, hits, events };
}

function fly(def, steer, from = 150, to = 13500) {
  const t = makeRun(def);
  const { run, stage, p } = t;
  const events = [];
  t.events.on('caution', (e) => events.push(`${e.kind}:${e.on}`));
  p.s = from;
  const input = { moveX: 0, moveY: 0, throttleAxis: 0 };
  const lim = { minY: 0 };
  const dt = 1 / 120;
  let caution = 0;
  while (p.s < to) {
    run.preUpdate(dt, dt);
    const h = stage.autopilotHint;
    input.moveX = steer ? Math.max(-1, Math.min(1, ((h.x ?? 0) - p.x) / 22 - p.vx / 260)) : 0;
    input.moveY = steer ? Math.max(-1, Math.min(1, ((h.y ?? 6) - p.y) / 20 - p.vy / 200)) : 0;
    lim.minY = run.groundAt(p.s, p.x) + 10 - exRailY(p.s);
    p.update(dt, input, exRail, lim);
    run.update(dt, dt);
    if (stage.hudExtra.caution) caution++;
  }
  return { ...t, caution: caution * dt, cautionEvents: events };
}

describe('TerrainRun', () => {
  it('an autopilot following safeX threads every example without a hit', () => {
    for (const [name, def] of Object.entries(TERRAIN_EXAMPLES)) {
      const { hits } = fly(def, true, 1500, 13000);
      expect(hits, name).toEqual([]);
    }
  });

  it('flying straight on through a swinging canyon hits walls and obstacles, with CAUTION first', () => {
    const { hits, caution, cautionEvents } = fly(TERRAIN_EXAMPLES.canyon, false, 3000, 9500);
    expect(hits.length).toBeGreaterThan(3);
    expect(hits.every((h) => h.kind === 'terrain')).toBe(true);
    expect(hits.some((h) => h.amount === 25)).toBe(true); // head-on
    expect(hits.some((h) => h.amount === 4)).toBe(true); // scrape
    expect(caution).toBeGreaterThan(1);
    expect(cautionEvents).toContain('terrain:true');
    expect(cautionEvents).toContain('terrain:false');
  });

  it('groundAt: movement floor for the player (walls are collisions), full height elsewhere', () => {
    const { run, p } = makeRun(TERRAIN_EXAMPLES.canyon);
    p.s = 6000;
    const c = run.shape.centreAt(6000);
    p.x = c + run.shape.flyableHalfWidth(6000) + 60; // inside the wall
    const full = run.heightAt(p.s, p.x);
    expect(run.groundAt(p.s, p.x)).toBeLessThan(full - 20);
    expect(run.groundAt(p.s, p.x + 0.001)).toBeCloseTo(run.heightAt(p.s, p.x + 0.001), 6);
    // water: never below the surface
    const fj = makeRun(TERRAIN_EXAMPLES.fjord).run;
    expect(fj.groundAt(6000, fj.shape.centreAt(6000))).toBeGreaterThanOrEqual(0);
  });

  it('query: signed clearance to terrain and obstacles', () => {
    const { run } = makeRun(TERRAIN_EXAMPLES.canyon);
    const o = run.obstacles.list.find((q) => q.kind === 'pillar');
    const y = exRailY(o.s);
    expect(run.query(o.s, o.x, y)).toBeLessThan(0);
    const c = run.shape.centreAt(6000);
    expect(run.query(6000, c, exRailY(6000))).toBeGreaterThan(20);
    expect(run.query(6000, c, run.heightAt(6000, c) - 5)).toBeLessThan(0);
    // safeX stays out of the pillar's way
    const x = run.safeX(o.s, y, o.s - 150, o.x + 1);
    expect(Math.abs(x - o.x)).toBeGreaterThan(o.r + 10);
  });
});
