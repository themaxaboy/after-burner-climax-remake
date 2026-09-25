import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { Rail, makeFrame } from '../../src/sim/rail.js';
import { Loop, STEP } from '../../src/core/loop.js';
import { Clock } from '../../src/core/clock.js';
import { Rng, rngStream } from '../../src/core/rng.js';
import { interceptTime, springStep, clamp, formatTime } from '../../src/core/math.js';
import { migrate, DEFAULT_SETTINGS } from '../../src/core/save.js';
import { buildRail, polylineLength } from '../../src/stages/railBuilder.js';
import { parseParams } from '../../src/core/params.js';

describe('Rail', () => {
  const pts = buildRail({ start: [0, 50, 0], segs: [{ len: 2000, turn: 0 }, { len: 3000, turn: 40, alt: 90 }, { len: 2000, turn: -20 }] });
  const rail = new Rail({ points: pts, bank: [[0, 0], [3000, 20], [6000, 0]] });

  it('has arc length close to the polyline length', () => {
    expect(rail.length).toBeGreaterThan(polylineLength(pts) * 0.98);
    expect(rail.length).toBeLessThan(polylineLength(pts) * 1.05);
  });

  it('samples positions uniformly in arc length', () => {
    const a = new Vector3(), b = new Vector3();
    for (let s = 0; s < rail.length - 20; s += 97) {
      rail.positionAt(s, a);
      rail.positionAt(s + 10, b);
      expect(a.distanceTo(b)).toBeGreaterThan(9.7);
      expect(a.distanceTo(b)).toBeLessThan(10.05);
    }
  });

  it('produces orthonormal frames', () => {
    const f = makeFrame();
    for (let s = 0; s < rail.length; s += 250) {
      rail.frameAt(s, f);
      expect(f.T.length()).toBeCloseTo(1, 4);
      expect(f.R.length()).toBeCloseTo(1, 4);
      expect(f.U.length()).toBeCloseTo(1, 4);
      expect(Math.abs(f.T.dot(f.R))).toBeLessThan(1e-4);
      expect(Math.abs(f.T.dot(f.U))).toBeLessThan(1e-4);
      expect(Math.abs(f.R.dot(f.U))).toBeLessThan(1e-4);
    }
  });

  it('starts heading -Z with right = +X and up = +Y', () => {
    const f = rail.frameAt(10, makeFrame());
    expect(f.T.z).toBeLessThan(-0.99);
    expect(f.R.x).toBeGreaterThan(0.99);
    expect(f.U.y).toBeGreaterThan(0.99);
  });

  it('positive bank lowers the right wing', () => {
    const f = rail.frameAt(3000, makeFrame());
    expect(f.R.y).toBeLessThan(-0.2);
  });

  it('reports positive curvature on right turns', () => {
    expect(rail.curvatureAt(3500)).toBeGreaterThan(0);
  });

  it('projects world points back to rail distance', () => {
    const p = new Vector3();
    rail.positionAt(4321, p);
    expect(Math.abs(rail.project(p, 4000) - 4321)).toBeLessThan(3);
  });
});

describe('Loop', () => {
  it('runs fixed steps and interpolates', () => {
    const clock = new Clock();
    let steps = 0, alpha = -1;
    const loop = new Loop({ clock, update: () => steps++, render: (a) => (alpha = a) });
    loop.step(1 / 60);
    expect(steps).toBe(2);
    loop.step(STEP * 0.5);
    expect(steps).toBe(2);
    expect(alpha).toBeCloseTo(0.5, 5);
  });

  it('scales world time with timeScale but not real time', () => {
    const clock = new Clock();
    const loop = new Loop({ clock, update: () => {}, render: () => {}, maxSteps: 1000 });
    clock.scaleTo(0.25, 0);
    loop.step(1);
    expect(clock.realTime).toBeCloseTo(1, 3);
    expect(clock.worldTime).toBeCloseTo(0.25, 3);
  });

  it('pulse returns time scale to 1', () => {
    const clock = new Clock();
    const loop = new Loop({ clock, update: () => {}, render: () => {}, maxSteps: 1000 });
    clock.pulse(0.3, 1.0, 0.1, 0.2);
    for (let i = 0; i < 60; i++) loop.step(1 / 60);
    expect(clock.timeScale).toBeCloseTo(0.3, 2);
    for (let i = 0; i < 60; i++) loop.step(1 / 60);
    expect(clock.timeScale).toBeCloseTo(1, 3);
  });

  it('drops backlog after a hitch', () => {
    const clock = new Clock();
    let steps = 0;
    const loop = new Loop({ clock, update: () => steps++, render: () => {}, maxSteps: 8 });
    loop.step(1.0);
    expect(steps).toBe(8);
    expect(loop.acc).toBeLessThanOrEqual(STEP);
  });
});

describe('Rng', () => {
  it('is deterministic per seed and stream', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const s1 = rngStream(1, 'enemies').next();
    const s2 = rngStream(1, 'particles').next();
    expect(s1).not.toBe(s2);
  });
  it('stays in range', () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const k = r.int(2, 5);
      expect(k).toBeGreaterThanOrEqual(2);
      expect(k).toBeLessThanOrEqual(5);
    }
  });
});

describe('math', () => {
  it('interceptTime solves a head-on target', () => {
    const t = interceptTime(0, 0, -1000, 0, 0, 200, 800);
    expect(t).toBeCloseTo(1, 3);
  });
  it('interceptTime returns -1 for an unreachable target', () => {
    expect(interceptTime(0, 0, -1000, 0, 0, -900, 800)).toBe(-1);
  });
  it('springStep converges', () => {
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 600; i++) springStep(s, 10, 8, 1 / 120);
    expect(s.x).toBeCloseTo(10, 2);
  });
  it('clamp & formatTime', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(formatTime(75.5)).toBe(`1'15"50`);
  });
});

describe('save', () => {
  it('migrates v1 boolean assist', () => {
    const m = migrate({ version: 1, assist: true }, DEFAULT_SETTINGS);
    expect(m.assist).toBe(2);
    expect(m.version).toBe(2);
    expect(m.lang).toBe('en');
  });
  it('returns defaults for garbage', () => {
    expect(migrate('x', DEFAULT_SETTINGS).assist).toBe(DEFAULT_SETTINGS.assist);
  });
});

describe('params', () => {
  it('parses flags', () => {
    const p = parseParams('?stage=2&fixed=1&turbo=4&quality=low&god=0');
    expect(p.stage).toBe(2);
    expect(p.fixed).toBe(true);
    expect(p.turbo).toBe(4);
    expect(p.quality).toBe('low');
    expect(p.god).toBe(false);
  });
});
