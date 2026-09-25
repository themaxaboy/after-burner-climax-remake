import { describe, it, expect } from 'vitest';
import { makeCanyonShape } from '../../src/world/terrain/canyonShape.js';
import { buildChunk } from '../../src/world/terrain/chunkBuilder.js';
import { lateralColumns } from '../../src/world/terrain/canyonStreamer.js';
import { Rail, makeFrame } from '../../src/sim/rail.js';
import { Vector3 } from 'three';
import stage2 from '../../src/stages/stage2_canyon.js';

const shape = makeCanyonShape(stage2.terrain);
const rail = new Rail(stage2.rail);
const f = makeFrame();

function chunk(s0, rows, ds) {
  const lat = new Float32Array(lateralColumns(2200, 300, 8, 12));
  const s = new Float32Array(rows + 2);
  const frames = new Float32Array((rows + 2) * 5);
  const up = new Vector3(0, 1, 0);
  const rh = new Vector3();
  for (let r = 0; r < rows + 2; r++) {
    s[r] = s0 + (r - 1) * ds;
    rail.frameAt(s[r], f);
    rh.crossVectors(f.T, up).normalize();
    frames.set([f.pos.x, f.pos.y, f.pos.z, rh.x, rh.z], r * 5);
  }
  return buildChunk(shape, { rows, cols: lat.length, lat, s, frames, origin: [frames[5], frames[7]] });
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
    const c = chunk(10000, 21, 10);
    for (let i = 0; i < c.pos.length; i++) expect(Number.isFinite(c.pos[i])).toBe(true);
    let up = 0;
    for (let i = 1; i < c.nor.length; i += 3) if (c.nor[i] > 0) up++;
    expect(up).toBe(c.nor.length / 3);
  });

  it('matches heights across chunk borders', () => {
    const a = chunk(10000, 21, 10);
    const b = chunk(10200, 21, 10);
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
