import { describe, it, expect } from 'vitest';
import { Scene, Vector3 } from 'three';
import { RingAllocator, DirtyRanges, flushRanges } from '../../src/render/fx/ring.js';
import { motionAt, velocityAt } from '../../src/render/fx/ballistic.js';
import {
  FxRng, makeParticle, recipeExplosion, recipeHitSparks, recipeFlares, recipeSplash, recipeDebris, recipeMuzzle
} from '../../src/render/fx/recipes.js';
import { TrailBuffer, TRAIL_STRIDE } from '../../src/render/fx/trails.js';
import { ParticleLayer, PARTICLE_STRIDE } from '../../src/render/fx/particles.js';
import { FX_QUALITY, K_MUZZLE, S_FIRE } from '../../src/render/fx/config.js';
import { FX } from '../../src/render/fx/index.js';

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
