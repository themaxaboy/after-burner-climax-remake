import { describe, it, expect } from 'vitest';
import { PointLight, Scene, Vector3 } from 'three';
import { RingAllocator, DirtyRanges, flushRanges } from '../../src/render/fx/ring.js';
import { motionAt, velocityAt } from '../../src/render/fx/ballistic.js';
import {
  FxRng, makeParticle, recipeExplosion, recipeHitSparks, recipeFlares, recipeSplash, recipeDebris, recipeMuzzle,
  recipeSmokePlume, SMOKE_SHADE
} from '../../src/render/fx/recipes.js';
import { TrailBuffer, TrailSystem, TRAIL_STRIDE } from '../../src/render/fx/trails.js';
import { ParticleLayer, PARTICLE_STRIDE } from '../../src/render/fx/particles.js';
import { Afterburner } from '../../src/render/fx/afterburner.js';
import { VaporCone } from '../../src/render/fx/vapor.js';
import { Beam } from '../../src/render/fx/beam.js';
import { FX_QUALITY, K_MUZZLE, S_FIRE, S_SMOKE, TRAIL_DEFAULTS, MISSILE_TRAILS } from '../../src/render/fx/config.js';
import { FX } from '../../src/render/fx/index.js';
import { FX_STUB } from '../../src/render/fxStub.js';
import { FxHooks, FX_TUNE } from '../../src/states/stage/fxHooks.js';
import { Events } from '../../src/core/events.js';

// ------------------------------------------------------------------ helpers
const FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 't0', 'life', 's0', 's1', 'drag', 'ay', 'r', 'g', 'b', 'i', 'p0', 'p1', 'p2', 'p3'];

/** Recipe sink that counts and validates particles instead of uploading them. */
function countingSink(q = 1, seed = 1) {
  const rng = new FxRng(seed);
  const st = { add: 0, smoke: 0, trails: 0, bad: 0, minT0: Infinity, maxT0: -Infinity };
  const check = (P, maxKind) => {
    for (const k of FIELDS) if (!Number.isFinite(P[k])) st.bad++;
    if (P.life <= 0 || P.s0 < 0 || P.s1 < 0 || P.kind < 0 || P.kind > maxKind || P.seed < 0 || P.seed >= 1) st.bad++;
    st.minT0 = Math.min(st.minT0, P.t0);
    st.maxT0 = Math.max(st.maxT0, P.t0);
  };
  const sink = {
    time: 10,
    q,
    flares: 5,
    rand: () => rng.next(),
    add: (P) => { st.add++; check(P, K_MUZZLE); },
    smoke: (P) => { st.smoke++; check(P, S_FIRE); },
    flareTrail: () => { st.trails++; return true; }
  };
  return { sink, st };
}

function runExplosion(kind, q, size = 1) {
  const { sink, st } = countingSink(q);
  recipeExplosion(sink, makeParticle(), 0, 100, 0, 200, 0, 0, size, kind);
  return { add: st.add, smoke: st.smoke, total: st.add + st.smoke, bad: st.bad, minT0: st.minT0, maxT0: st.maxT0 };
}

// ------------------------------------------------------------------ ring
describe('RingAllocator', () => {
  it('allocates sequentially, wraps and overwrites the oldest', () => {
    const r = new RingAllocator(4);
    expect([r.alloc(), r.alloc(), r.alloc()]).toEqual([0, 1, 2]);
    expect(r.used).toBe(3);
    expect([r.alloc(), r.alloc(), r.alloc()]).toEqual([3, 0, 1]);
    expect(r.used).toBe(4);
    expect(r.total).toBe(6);
  });
  it('rejects empty capacity', () => {
    expect(() => new RingAllocator(0)).toThrow();
  });
});

describe('DirtyRanges', () => {
  it('merges contiguous single-slot adds into one range', () => {
    const d = new DirtyRanges(8);
    for (let i = 10; i < 30; i++) d.add(i, 1);
    expect(d.finalize()).toBe(1);
    expect([d.s[0], d.e[0]]).toEqual([10, 30]);
  });
  it('keeps the ring wrap as two ranges', () => {
    const d = new DirtyRanges(8);
    for (const i of [98, 99, 0, 1, 2]) d.add(i, 1);
    expect(d.finalize()).toBe(2);
    expect([d.s[0], d.e[0], d.s[1], d.e[1]]).toEqual([0, 3, 98, 100]);
    expect(d.covered()).toBe(5);
  });
  it('merges overlapping and near ranges on finalize (gap)', () => {
    const d = new DirtyRanges(8, 4);
    d.add(50, 5);
    d.add(10, 5);
    d.add(17, 2); // gap of 2 <= 4 -> merged with [10,15)
    d.add(52, 10); // overlaps
    expect(d.finalize()).toBe(2);
    expect([d.s[0], d.e[0], d.s[1], d.e[1]]).toEqual([10, 19, 50, 62]);
  });
  it('never exceeds maxRanges: overflow grows the nearest range', () => {
    const d = new DirtyRanges(3);
    for (let i = 0; i < 20; i++) d.add(i * 100, 2);
    expect(d.count).toBeLessThanOrEqual(3);
    d.finalize();
    // every added slot is still covered
    for (let i = 0; i < 20; i++) {
      let hit = false;
      for (let k = 0; k < d.count; k++) if (i * 100 >= d.s[k] && i * 100 + 2 <= d.e[k]) hit = true;
      expect(hit).toBe(true);
    }
  });
  it('flushRanges scales by stride, reuses pooled range objects and clears', () => {
    const d = new DirtyRanges(8);
    const target = { updateRanges: [], needsUpdate: false };
    const pool = [];
    d.add(3, 2);
    d.add(9, 1);
    expect(flushRanges(d, target, 24, pool)).toBe(2);
    expect(target.updateRanges).toEqual([{ start: 72, count: 48 }, { start: 216, count: 24 }]);
    expect(target.needsUpdate).toBe(true);
    expect(d.empty).toBe(true);
    const first = pool[0];
    d.add(0, 1);
    flushRanges(d, target, 24, pool);
    expect(pool[0]).toBe(first); // no new objects
    expect(pool.length).toBe(2);
  });
});

// ------------------------------------------------------------------ motion
describe('analytic motion', () => {
  it('matches ballistic motion without drag', () => {
    const o = { x: 0, y: 0, z: 0 };
    motionAt(o, 1, 2, 3, 10, 20, -5, 0, -9.8, 2);
    expect(o.x).toBeCloseTo(21);
    expect(o.y).toBeCloseTo(2 + 40 - 19.6);
    expect(o.z).toBeCloseTo(-7);
  });
  it('velocity is the derivative of position and tends to terminal velocity', () => {
    const a = { x: 0, y: 0, z: 0 }, b = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 };
    const h = 1e-4;
    for (const t of [0.1, 0.7, 2.5]) {
      motionAt(a, 0, 0, 0, 80, 30, -40, 1.7, -9.8, t - h);
      motionAt(b, 0, 0, 0, 80, 30, -40, 1.7, -9.8, t + h);
      velocityAt(v, 80, 30, -40, 1.7, -9.8, t);
      expect((b.x - a.x) / (2 * h)).toBeCloseTo(v.x, 3);
      expect((b.y - a.y) / (2 * h)).toBeCloseTo(v.y, 3);
    }
    velocityAt(v, 80, 30, -40, 1.7, -9.8, 30);
    expect(v.x).toBeCloseTo(0, 3);
    expect(v.y).toBeCloseTo(-9.8 / 1.7, 3);
  });
});

// ------------------------------------------------------------------ recipes
describe('emitter recipes', () => {
  const kinds = ['air', 'big', 'ground', 'water', 'missile'];
  const budget = { air: 260, big: 900, ground: 320, water: 200, missile: 90 };
  it('produce valid particles within budget for every kind', () => {
    for (const kind of kinds) {
      const r = runExplosion(kind, FX_QUALITY.high.count);
      expect(r.bad, kind).toBe(0);
      expect(r.total, kind).toBeGreaterThan(10);
      expect(r.total, kind).toBeLessThanOrEqual(budget[kind]);
      expect(r.minT0, kind).toBeGreaterThanOrEqual(10); // never in the past
    }
  });
  it('scale counts with quality', () => {
    for (const kind of kinds) {
      const lo = runExplosion(kind, FX_QUALITY.low.count).total;
      const hi = runExplosion(kind, FX_QUALITY.high.count).total;
      const ul = runExplosion(kind, FX_QUALITY.ultra.count).total;
      expect(lo, kind).toBeLessThan(hi);
      expect(hi, kind).toBeLessThan(ul);
      expect(ul, kind).toBeLessThanOrEqual(budget[kind] * 1.45);
    }
  });
  it('big explosions schedule delayed secondary bursts', () => {
    const r = runExplosion('big', 1);
    expect(r.maxT0 - 10).toBeGreaterThan(0.3);
  });
  it('hit sparks, splash, debris, muzzle and flares are well formed', () => {
    const { sink, st: stats } = countingSink(1);
    const P = makeParticle();
    recipeHitSparks(sink, P, 0, 0, 0, 0, 0, -1, 12);
    recipeSplash(sink, P, 0, 0, 0, 1);
    recipeDebris(sink, P, 0, 0, 0, 0, 0, 0, 8);
    recipeMuzzle(sink, P, 0, 0, 0, 0, 0, -1);
    const n = recipeFlares(sink, P, 0, 0, 0, 250, 0, 0);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(6);
    expect(stats.trails).toBe(n); // one ribbon tail per flare
    expect(stats.bad).toBe(0);
  });
  it('is deterministic for a given seed', () => {
    const a = runExplosion('air', 1), b = runExplosion('air', 1);
    expect(a).toEqual(b);
  });
});

// ------------------------------------------------------------------ trails
describe('TrailBuffer', () => {
  const P = 16;
  const birthOf = (tb, j, slot) => tb.data[(j * P + slot) * 2 * TRAIL_STRIDE + 3];
  const posOf = (tb, j, slot) => {
    const o = (j * P + slot) * 2 * TRAIL_STRIDE;
    return [tb.data[o], tb.data[o + 1], tb.data[o + 2]];
  };

  it('parks every slot on the first point (no stale segments)', () => {
    const tb = new TrailBuffer(2, P);
    // dirty the region with an old trail far away
    tb.begin(0, 0, 1, 2, 1, 0, 1, 1, 1, 1);
    for (let i = 0; i < 40; i++) tb.push(0, 1000 + i, 0, 0, i * 0.1);
    tb.stop(0, 4);
    tb.update(10);
    expect(tb.state[0]).toBe(0);
    const j = tb.alloc();
    expect(j).toBe(0);
    tb.begin(j, 10, 1, 2, 1, 0, 1, 1, 1, 1);
    tb.push(j, 5, 6, 7, 10);
    for (let s = 0; s < P; s++) expect(posOf(tb, j, s)).toEqual([5, 6, 7]);
  });

  it('commits points at life/(P-3) intervals and keeps a dead break slot after the head', () => {
    const tb = new TrailBuffer(1, P);
    const life = 1.3;
    tb.begin(0, 0, 1, 2, life, 0, 1, 1, 1, 1);
    const dt = 1 / 120;
    let t = 0;
    for (let i = 0; i < 400; i++) {
      t = i * dt;
      tb.push(0, 0, 0, -i * 2, t);
      const head = tb.cur[0];
      const brk = (head + 1) % P;
      expect(birthOf(tb, 0, head)).toBeCloseTo(t);
      expect(birthOf(tb, 0, brk)).toBeLessThan(-1e8);
      expect(posOf(tb, 0, brk)).toEqual(posOf(tb, 0, head));
    }
    // committed points cover roughly the trail life
    const ages = [];
    for (let s = 0; s < P; s++) {
      const b = birthOf(tb, 0, s);
      if (b > -1e8) ages.push(t - b);
    }
    expect(Math.max(...ages)).toBeGreaterThan(life * 0.85);
    expect(ages.length).toBeGreaterThanOrEqual(P - 3);
  });

  it('recycles stopped trails after they fade and steals the oldest fading one when full', () => {
    const tb = new TrailBuffer(3, P);
    for (let j = 0; j < 3; j++) {
      expect(tb.alloc()).toBe(j);
      tb.begin(j, 0, 1, 2, 2, 0, 1, 1, 1, 1);
      tb.push(j, j, 0, 0, 0);
    }
    expect(tb.alloc()).toBe(-1); // all emitting
    tb.stop(1, 1.0);
    tb.stop(2, 0.5);
    expect(tb.alloc()).toBe(2); // oldest fading
    expect(tb.update(1.5)).toBe(3);
    expect(tb.update(2.7)).toBe(2); // trail 2 faded (stopped at 0.5, life 2)
    expect(tb.state[2]).toBe(0);
    expect(tb.hi).toBe(1);
  });

  it('keeps per-frame dirty ranges small', () => {
    const tb = new TrailBuffer(8, P);
    for (let j = 0; j < 8; j++) tb.begin(j, 0, 1, 2, 1, 0, 1, 1, 1, 1);
    tb.dirty.clear();
    for (let j = 0; j < 8; j++) tb.push(j, j, 0, 0, 0.5);
    expect(tb.dirty.count).toBeLessThanOrEqual(tb.dirty.max);
  });
});

// ------------------------------------------------------------------ particle layer
describe('ParticleLayer', () => {
  it('writes spawns into the ring, shifts pending spawn times and uploads dirty ranges only', () => {
    const layer = new ParticleLayer({ capacity: 8, additive: true, uniforms: {} });
    const P = makeParticle();
    P.t0 = 1;
    P.life = 2;
    for (let i = 0; i < 3; i++) layer.push(P);
    layer.shiftPending(0.5);
    expect(layer.data[3]).toBeCloseTo(1.5);
    expect(layer.data[2 * PARTICLE_STRIDE + 3]).toBeCloseTo(1.5);
    expect(layer.flush()).toBe(1);
    expect(layer.ib.updateRanges[0]).toEqual({ start: 0, count: 3 * PARTICLE_STRIDE });
    expect(layer.geometry.instanceCount).toBe(3);
    expect(layer.alive(2)).toBe(3);
    expect(layer.alive(4)).toBe(0);
    // overwrite oldest when full
    for (let i = 0; i < 7; i++) layer.push(P);
    expect(layer.ring.head).toBe(2);
    layer.flush();
    expect(layer.geometry.instanceCount).toBe(8);
    layer.dispose();
  });
});

// ------------------------------------------------------------------ FX facade (no WebGL)
describe('FX (headless)', () => {
  it('runs the public API without a renderer and reports stats', () => {
    const scene = new Scene();
    const fx = new FX({ scene, renderer: null, quality: 'low' });
    const pos = new Vector3(0, 100, -300);
    fx.explosion(pos, { size: 1, kind: 'air', seed: 3 });
    fx.explosion(pos, { kind: 'big' });
    fx.hitSparks(pos, new Vector3(0, 0, -1));
    fx.flareBurst(pos, new Vector3(250, 0, 0));
    fx.muzzleFlash(pos, new Vector3(0, 0, -1));
    fx.waterSplash(new Vector3(0, 0, 0), 1);
    const trail = fx.createTrail({ kind: 'missile' });
    const smoke = fx.createSmokeEmitter({ fire: true });
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 1 / 60;
      trail.push(new Vector3(0, 100, -i * 5));
      smoke.update(new Vector3(i * 4, 150, 0), new Vector3(240, 0, 0), 1);
      fx.update(1 / 60, t, null);
    }
    const s = fx.stats();
    expect(s.particles).toBeGreaterThan(100);
    expect(s.particles).toBeLessThanOrEqual(FX_QUALITY.low.particles);
    expect(s.trails).toBeGreaterThanOrEqual(2); // missile + flare tails
    expect(s.drawCalls).toBeGreaterThanOrEqual(3);
    expect(trail.alive).toBe(true);
    trail.stop();
    smoke.stop();
    for (let i = 0; i < 400; i++) fx.update(1 / 60, (t += 1 / 60), null);
    expect(trail.alive).toBe(false);
    expect(fx.stats().emitters).toBe(0);
    const ab = fx.createAfterburner([{ position: new Vector3(0, 0, 8), radius: 0.5, direction: new Vector3(0, 0, 1) }]);
    ab.set(1, 1);
    fx.update(0.1, (t += 0.1), null);
    expect(ab.uniforms.uAB.value).toBeGreaterThan(0.5);
    fx.warmup();
    fx.update(1 / 60, (t += 1 / 60), null);
    fx.update(1 / 60, (t += 1 / 60), null);
    fx.dispose();
    expect(scene.children.length).toBe(0);
  });
});

// ------------------------------------------------------------------ shader safety (dark flicker)
/** First argument of every pow() call in a GLSL source (comments stripped). */
function powArgs(src) {
  const code = src.replace(/\/\/[^\n]*/g, '');
  const out = [];
  let i = 0;
  while ((i = code.indexOf('pow(', i)) >= 0) {
    let j = i + 4, depth = 0, arg = '';
    for (; j < code.length; j++) {
      const c = code[j];
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
      arg += c;
    }
    out.push(arg.trim());
    i = j;
  }
  return out;
}

describe('FX shaders (flicker safety)', () => {
  const shared = { uFxTime: { value: 0 }, uFxSun: { value: 1 }, uFxAmbient: { value: 1 }, fog: {} };
  const materials = () => ({
    trails: new TrailSystem({ maxTrails: 2, points: 8, uniforms: {} }).material,
    smoke: new ParticleLayer({ capacity: 4, additive: false, uniforms: {} }).material,
    additive: new ParticleLayer({ capacity: 4, additive: true, uniforms: {} }).material,
    afterburner: new Afterburner([{ position: new Vector3(), radius: 0.5, direction: new Vector3(0, 0, 1) }], { uniforms: shared, noise: null }).material,
    vapor: new VaporCone({ uniforms: shared, noise: null }).material,
    beam: new Beam({ uniforms: shared, noise: null }).material
  });

  it('premultiplied layers clamp alpha to [0,1] (alpha > 1 makes the blend factor negative)', () => {
    const m = materials();
    for (const k of ['trails', 'smoke']) expect(m[k].fragmentShader, k).toMatch(/alpha = clamp\(alpha, 0\.0, 1\.0\)/);
    // end-on trails may still boost opacity in the vertex shader: the clamp must come after it
    const fs = m.trails.fragmentShader;
    expect(fs.indexOf('alpha = clamp(alpha, 0.0, 1.0)')).toBeGreaterThan(fs.indexOf('float alpha ='));
  });

  it('HDR outputs are clamped to finite, non-negative values', () => {
    const m = materials();
    for (const k of ['additive', 'smoke', 'trails', 'afterburner', 'vapor', 'beam']) expect(m[k].fragmentShader, k).toMatch(/clamp\([^;]*6\.0e4\)/);
  });

  it('never raise a possibly negative base with pow() (NaN -> black blocks through bloom)', () => {
    // bases proven non-negative in their shader (clamped/max-ed, or lengths/ratios of them)
    const SAFE = new Set(['1.0 - age', 'age', 'ac', 'r / env', '1.0 - u', 'fres', 'facing', 's']);
    for (const [k, mat] of Object.entries(materials())) {
      for (const src of [mat.vertexShader, mat.fragmentShader]) {
        for (const a of powArgs(src)) {
          const ok = /^(max|clamp|abs)\(/.test(a) || SAFE.has(a);
          expect(ok, `${k}: pow(${a}, ...)`).toBe(true);
        }
      }
    }
    const m = materials();
    expect(m.additive.fragmentShader).toMatch(/float age = clamp\(vInfo\.x, 0\.0, 1\.0\)/);
    expect(m.vapor.fragmentShader).toMatch(/max\(1\.0 - abs\(dot\(N, V\)\), 0\.0\)/);
    expect(m.afterburner.fragmentShader).toMatch(/env = max\(/);
  });
});

// ------------------------------------------------------------------ stub
describe('FX_STUB', () => {
  it('implements every public FX method (tests / no-WebGL fallback)', () => {
    const names = Object.getOwnPropertyNames(FX.prototype).filter((n) => n !== 'constructor' && !n.startsWith('_'));
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(n in FX_STUB, n).toBe(true);
    const t = FX_STUB.createTrail({ kind: 'missile' });
    t.push(new Vector3());
    t.stop();
    FX_STUB.createSmokeEmitter().update(new Vector3(), null, 1);
    FX_STUB.tracers.setData(new Float32Array(3), new Float32Array(3), 1);
    expect(FX_STUB.Q.liteBurst).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ explosion looks
describe('explosion recipes (booming kills)', () => {
  it('lite explosions are cheap and valid; full kills are much richer', () => {
    const lite = runExplosion('lite', 1, 2.6);
    const full = runExplosion('air', 1, 2.6);
    expect(lite.bad).toBe(0);
    expect(lite.total).toBeLessThanOrEqual(45);
    expect(full.total).toBeGreaterThan(lite.total * 4);
    const big = runExplosion('big', 1, 6);
    expect(big.bad).toBe(0);
    expect(big.total).toBeLessThanOrEqual(1400);
  });

  it('explosion smoke is dark grey soot, not near-black', () => {
    const rng = new FxRng(3);
    let minShade = Infinity, n = 0;
    const sink = {
      time: 0, q: 1, flares: 5, rand: () => rng.next(), add() {}, flareTrail: () => true,
      smoke: (P) => {
        if (P.kind === S_SMOKE) {
          minShade = Math.min(minShade, P.r, P.g, P.b);
          n++;
        }
      }
    };
    const P = makeParticle();
    for (const kind of ['air', 'big', 'lite']) recipeExplosion(sink, P, 0, 100, 0, 150, 0, 0, 2.6, kind);
    recipeSmokePlume(sink, P, 0, 100, 0, 150, 0, 0, 1.5, 2, true);
    expect(n).toBeGreaterThan(50);
    expect(minShade).toBeGreaterThanOrEqual(0.09);
    expect(SMOKE_SHADE).toBeGreaterThanOrEqual(0.12);
    expect(SMOKE_SHADE).toBeLessThanOrEqual(0.15);
  });

  it('smoke plumes are scheduled along the drift over their duration', () => {
    const { sink, st } = countingSink(1);
    recipeSmokePlume(sink, makeParticle(), 0, 100, 0, 200, 0, 0, 1.5, 2, true);
    expect(st.bad).toBe(0);
    expect(st.smoke).toBeGreaterThanOrEqual(10);
    expect(st.add).toBeGreaterThan(0); // fire licks early on
    expect(st.maxT0 - st.minT0).toBeGreaterThan(1.5);
  });

  it('smoke fades earlier near the camera and the screen-size cap is tighter', () => {
    const vs = new ParticleLayer({ capacity: 4, additive: false, uniforms: {} }).material.vertexShader;
    expect(vs).toMatch(/smoothstep\(0\.9, 2\.8, nr\)/);
    for (const q of Object.values(FX_QUALITY)) expect(q.maxScreen).toBeLessThanOrEqual(0.35);
  });
});

// ------------------------------------------------------------------ stage hooks
function hookRig(preset = 'high') {
  const log = { explosions: [], plumes: [], debris: [], trails: [], sounds: [], trauma: 0 };
  const fx = {
    ...FX_STUB,
    Q: FX_QUALITY[preset],
    explosion: (pos, o) => log.explosions.push({ ...o }),
    smokePlume: (pos, vel, size, dur) => log.plumes.push({ size, dur }),
    debris: (pos, vel, n) => log.debris.push(n),
    createTrail: (o) => {
      const t = { ...o, stopped: false, pushes: 0, push() { this.pushes++; }, stop() { this.stopped = true; } };
      log.trails.push(t);
      return t;
    }
  };
  const scene = new Scene();
  const game = {
    clock: { worldTime: 10 },
    preset: { name: preset },
    world: { scene },
    rig: { camera: { position: new Vector3() }, addTrauma: (t) => { log.trauma += t; } },
    audio: { play: (n) => { log.sounds.push(n); return null; } }
  };
  const pk = () => ({ count: 0, max: 4, packedPos: new Float32Array(12), packedVel: new Float32Array(12) });
  const stage = {
    game, fx, time: 0, events: new Events(),
    player: { pos: new Vector3(0, 0, -20), velocity: new Vector3(0, 0, -250) },
    hudBridge: { popupAtWorld() {} },
    scoring: { combo: 0 },
    climax: { active: false, phase: 'idle' },
    vulcan: pk(),
    enemyGuns: pk()
  };
  return { hooks: new FxHooks(stage), stage, game, log, scene };
}
const foe = (id, z, def = { air: true }, y = 50) => ({ id, pos: new Vector3(0, y, z), vel: new Vector3(0, 0, 100), def });

describe('FxHooks (stage presentation)', () => {
  it('throttles full explosions to 3 per 0.25 s; the rest use the cheap lite recipe', () => {
    const { hooks, game, log } = hookRig('high');
    for (let i = 0; i < 10; i++) hooks.onEnemyExplode(foe(i, -400), 'air');
    expect(log.explosions.filter((e) => e.kind === 'air')).toHaveLength(3);
    expect(log.explosions.filter((e) => e.kind === 'lite')).toHaveLength(7);
    expect(log.debris).toHaveLength(3); // no debris for lite kills
    expect(log.plumes).toHaveLength(10); // every air kill leaves a plume
    game.clock.worldTime += 0.3;
    for (let i = 0; i < 5; i++) hooks.onEnemyExplode(foe(20 + i, -400), 'air');
    expect(log.explosions.filter((e) => e.kind === 'air')).toHaveLength(6);
    hooks.onEnemyExplode(foe(40, -400, { air: true, big: true }), 'big');
    expect(log.explosions.at(-1).kind).toBe('big'); // big kills are never throttled
    const low = hookRig('low');
    for (let i = 0; i < 5; i++) low.hooks.onEnemyExplode(foe(i, -400), 'air');
    expect(low.log.explosions.filter((e) => e.kind === 'air')).toHaveLength(FX_QUALITY.low.liteBurst);
  });

  it('uses booming sizes: fighter 2.6, big 6, sea 3.2, with x1.5 debris', () => {
    const { hooks, game, log } = hookRig();
    hooks.onEnemyExplode(foe(1, -400), 'air');
    game.clock.worldTime += 1;
    hooks.onEnemyExplode(foe(2, -400, { air: true, big: true }), 'big');
    game.clock.worldTime += 1;
    hooks.onEnemyExplode(foe(3, -400, { sea: true, ground: true }, 0), 'water');
    expect(log.explosions.map((e) => [e.kind, e.size])).toEqual([['air', 2.6], ['big', 6], ['water', 3.2]]);
    expect(log.debris).toEqual([15, 45]);
    expect(log.plumes).toHaveLength(3);
    expect(FX_TUNE.size).toMatchObject({ fighter: 2.6, big: 6, sea: 3.2 });
  });

  it('shakes by distance (0.12 + 0.5 (1 - d/1200)) and 0.8 for big kills', () => {
    const { hooks, game, log } = hookRig();
    hooks.onEnemyExplode(foe(1, -600, { air: true }, 0), 'air');
    expect(log.trauma).toBeCloseTo(0.12 + 0.5 * (1 - 600 / 1200), 5);
    log.trauma = 0;
    game.clock.worldTime += 1;
    hooks.onEnemyExplode(foe(2, -1500, { air: true }, 0), 'air');
    expect(log.trauma).toBe(0);
    hooks.onEnemyExplode(foe(3, -2500, { air: true, big: true }, 0), 'big');
    expect(log.trauma).toBeCloseTo(0.8, 5);
  });

  it('picks the boom layer by distance and the bank defines every new sound', async () => {
    const { SFX_DEFS, SOUND_NAMES } = await import('../../src/audio/sfxBank.js');
    const { hooks, game, log } = hookRig();
    hooks.onEnemyExplode(foe(1, -200), 'air');
    game.clock.worldTime += 1;
    hooks.onEnemyExplode(foe(2, -1500), 'air');
    game.clock.worldTime += 1;
    hooks.onEnemyExplode(foe(3, -900, { air: true, big: true }), 'big');
    expect(log.sounds).toEqual(['boomNear', 'boomFar', 'boomHuge']);
    for (const n of ['boomNear', 'boomFar', 'boomHuge', 'whoosh', 'evade']) {
      expect(SOUND_NAMES, n).toContain(n);
      expect(typeof SFX_DEFS[n].render).toBe('function');
    }
  });

  it('creates pooled flash lights at warmup (high/ultra only) and never adds lights mid-stage', () => {
    const lo = hookRig('low');
    lo.hooks.warmup();
    expect(lo.hooks.lights).toBe(null);
    expect(lo.scene.children.length).toBe(0);

    const { hooks, scene, game } = hookRig('high');
    const lights = () => scene.children.filter((o) => o instanceof PointLight);
    hooks.warmup();
    hooks.warmup(); // idempotent
    expect(lights()).toHaveLength(FX_QUALITY.high.lights);
    for (const l of lights()) expect(l.intensity).toBe(0);
    const peak = () => Math.max(...hooks.lights.map((r) => r.light.intensity));
    hooks.onEnemyExplode(foe(1, -300), 'air');
    hooks.render(1);
    expect(lights()).toHaveLength(FX_QUALITY.high.lights);
    for (const l of lights()) expect(l.visible).toBe(true); // hiding a light also changes programs
    const I0 = peak();
    expect(I0).toBeGreaterThan(1e5);
    expect(I0).toBeLessThanOrEqual(FX_TUNE.flash.peak);
    game.clock.worldTime += FX_TUNE.flash.decay;
    hooks.render(1);
    expect(peak() / I0).toBeCloseTo(1 / Math.E, 2);
    game.clock.worldTime += 3;
    hooks.render(1);
    expect(peak()).toBe(0);
    // a blast right on top of the jet is capped (no HalfFloat overflow)
    hooks.onEnemyExplode({ id: 9, pos: new Vector3(0, 0, -24), vel: new Vector3(), def: { air: true } }, 'air');
    hooks.render(1);
    expect(peak()).toBeLessThanOrEqual(FX_TUNE.flash.maxOnPlayer * 16 + 1e-6);
    hooks.dispose();
    expect(lights()).toHaveLength(0);
  });

  it('missile trails: thick white enemy smoke, reddish strong ones, thinner player trails, short in Climax', () => {
    const { hooks, stage, log } = hookRig();
    const msl = (owner, strong = false) => ({ owner, strong, pos: new Vector3(0, 0, -500), prevPos: new Vector3(0, 0, -490), vel: new Vector3(0, 0, 300), t: 1, dropT: 0.1 });
    const ms = [msl('enemy'), msl('enemy', true), msl('player')];
    for (const m of ms) hooks.onMissileLaunch(m);
    stage.climax.active = true;
    hooks.onMissileLaunch(msl('player'));
    stage.climax.active = false;
    const [en, strong, pl, cx] = log.trails;
    const grow = TRAIL_DEFAULTS.missile.width1 / TRAIL_DEFAULTS.missile.width0;
    expect([en.width, en.width * grow]).toEqual([2, 10]);
    expect(en.life).toBeCloseTo(3.5);
    expect(en.opacity).toBeGreaterThanOrEqual(0.9);
    expect(Math.min(...en.color)).toBeGreaterThan(0.9);
    expect(strong.color[0] - strong.color[1]).toBeGreaterThan(0.2);
    expect([pl.width, pl.width * grow]).toEqual([1.5, 7.5]);
    expect(cx.life).toBeCloseTo(MISSILE_TRAILS.climaxLife);
    // salvo missiles fired right after release also get short trails
    stage.events.emit('climax', { phase: 'end', salvo: 20 });
    hooks.onMissileLaunch(msl('player'));
    expect(log.trails.at(-1).life).toBeCloseTo(1.6);
    hooks.render(0.5);
    expect(en.pushes).toBe(1);
    hooks.onMissileEnd(ms[0], 'hit');
    expect(en.stopped).toBe(true);
    hooks.clearTrails();
    expect(log.trails.every((t) => t.stopped)).toBe(true);
  });

  it('whooshes on near misses, evades and enemy missile fly-bys', () => {
    const { hooks, stage, log } = hookRig();
    stage.events.emit('nearMiss', { e: foe(1, -30), d: 12 });
    stage.events.emit('evade', { n: 2 });
    expect(log.sounds).toEqual(['whoosh', 'evade']);
    expect(log.trauma).toBeGreaterThan(0.2);
    // an enemy missile passing 40 m from the jet
    const m = { owner: 'enemy', pos: new Vector3(40, 0, -200), prevPos: new Vector3(40, 0, -200), vel: new Vector3(0, 0, 400), t: 1, dropT: 0.1 };
    hooks.onMissileLaunch(m);
    log.sounds.length = 0;
    for (const z of [-120, -60, -20, 20, 60]) {
      m.pos.z = z;
      hooks.render(1);
    }
    expect(log.sounds).toEqual(['whoosh']);
    hooks.dispose();
    stage.events.emit('evade', { n: 1 });
    expect(log.sounds).toEqual(['whoosh']); // listeners removed
  });
});
