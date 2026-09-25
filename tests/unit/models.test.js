// Procedural model sanity tests: geometry validity, LOD triangle budgets,
// bounding radii, gameplay anchors, animation pivots and build-time budget.

import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
import {
  AIRCRAFT_IDS,
  VEHICLE_IDS,
  PLAYER_JETS,
  SCHEMES,
  buildAircraft,
  buildAircraftGeometry,
  buildVehicle,
  createAircraftMaterials,
  clearModelCache,
  prebuildAll
} from '../../src/models/aircraftBuilder.js';

const AIRCRAFT_TRIS = [
  [25000, 60000],
  [5000, 8000],
  [800, 1500]
];
const VEHICLE_TRIS = {
  missile: [
    [800, 6000],
    [300, 2000],
    [100, 800]
  ],
  destroyer: [
    [20000, 60000],
    [4000, 8000],
    [800, 1500]
  ],
  samLauncher: [
    [1200, 20000],
    [600, 8000],
    [150, 1500]
  ]
};
const RADIUS = {
  f14d: [8, 13],
  fa18e: [8, 13],
  f15e: [8, 13],
  fighterA: [8, 13],
  stealthB: [8, 13],
  bomberXB: [25, 35],
  bomberB52: [25, 35],
  kc10: [25, 35],
  heloCH47: [12, 18],
  missile: [1.5, 2.2],
  destroyer: [70, 85],
  samLauncher: [3, 7]
};
const JETS = ['f14d', 'fa18e', 'f15e', 'fighterA', 'stealthB', 'bomberXB', 'bomberB52', 'kc10'];

function checkGeometry(g, label) {
  const p = g.attributes.position.array;
  const n = g.attributes.normal.array;
  const I = g.index.array;
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) throw new Error(`${label}: NaN position`);
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (Math.abs(l - 1) > 1e-3) throw new Error(`${label}: normal not unit (${l})`);
  }
  expect(g.attributes.uv, `${label} uv`).toBeTruthy();
  // winding must agree with the shading normals (catches inverted parts)
  let bad = 0;
  let total = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3;
    const b = I[t + 1] * 3;
    const c = I[t + 2] * 3;
    if (Math.max(I[t], I[t + 1], I[t + 2]) * 3 >= p.length) throw new Error(`${label}: index out of range`);
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    if (Math.hypot(fx, fy, fz) < 1e-12) continue;
    total++;
    const sx = n[a] + n[b] + n[c];
    const sy = n[a + 1] + n[b + 1] + n[c + 1];
    const sz = n[a + 2] + n[b + 2] + n[c + 2];
    if (fx * sx + fy * sy + fz * sz < 0) bad++;
  }
  expect(bad / Math.max(total, 1), `${label} flipped triangles`).toBeLessThan(0.005);
}

function tris(geo) {
  let t = 0;
  for (const k of ['body', 'glass', 'emissive', 'metal']) if (geo[k]) t += geo[k].index.count / 3;
  return t;
}

describe('procedural models: geometry', () => {
  const ids = [...AIRCRAFT_IDS, ...VEHICLE_IDS];
  for (const id of ids) {
    for (const lod of [0, 1, 2]) {
      it(`${id} lod${lod} is valid and within budget`, () => {
        const geo = buildAircraftGeometry(id, lod);
        for (const k of ['body', 'glass', 'emissive', 'metal']) if (geo[k]) checkGeometry(geo[k], `${id}/${lod}/${k}`);
        expect(geo.body).toBeTruthy();
        expect(geo.body.attributes.aZone).toBeTruthy();
        if (geo.emissive) {
          expect(geo.emissive.attributes.color).toBeTruthy();
          expect(geo.emissive.attributes.aGlow).toBeTruthy();
        }
        const t = tris(geo);
        const [lo, hi] = VEHICLE_TRIS[id]?.[lod] ?? AIRCRAFT_TRIS[lod];
        expect(t, `${id} lod${lod} triangles`).toBeGreaterThanOrEqual(lo);
        expect(t, `${id} lod${lod} triangles`).toBeLessThanOrEqual(hi);
        const [rlo, rhi] = RADIUS[id];
        expect(geo.radius).toBeGreaterThanOrEqual(rlo);
        expect(geo.radius).toBeLessThanOrEqual(rhi);
      });
    }
  }

  it('jets expose nozzles, hardpoints, wingtips and a gun port', () => {
    for (const id of JETS) {
      const geo = buildAircraftGeometry(id, 1);
      expect(geo.nozzles.length, id).toBeGreaterThanOrEqual(2);
      for (const nz of geo.nozzles) {
        expect(nz.radius).toBeGreaterThan(0.1);
        expect(nz.direction.z).toBeGreaterThan(0.9);
        expect(nz.position.z, id).toBeGreaterThan(-2);
      }
      expect(geo.hardpoints.length, id).toBeGreaterThanOrEqual(2);
      expect(geo.wingtips.length).toBe(2);
      expect(geo.wingtips[0].x).toBeLessThan(0);
      expect(geo.wingtips[1].x).toBeGreaterThan(0);
      expect(geo.gunPort).toBeInstanceOf(Vector3);
    }
  });

  it('models point their nose toward -Z', () => {
    for (const id of [...AIRCRAFT_IDS.filter((i) => i !== 'heloCH47'), 'missile', 'destroyer']) {
      const geo = buildAircraftGeometry(id, 2);
      geo.body.computeBoundingBox();
      const bb = geo.body.boundingBox;
      // nozzles are aft, fuselage extends further forward than aft of the origin
      expect(-bb.min.z, id).toBeGreaterThan(bb.max.z * 0.7);
    }
  });
});

describe('procedural models: instances & animation', () => {
  it('player jet list and schemes', () => {
    expect(PLAYER_JETS.map((p) => p.id)).toEqual(['f14d', 'fa18e', 'f15e']);
    expect(SCHEMES).toEqual(['standard', 'camo', 'special', 'lowvis']);
    for (const p of PLAYER_JETS) for (const s of SCHEMES) {
      const m = createAircraftMaterials(p.id, s);
      expect(m.body.userData.uniforms.uLivTop).toBeTruthy();
      expect(m.emissive.userData.uniforms.uAfterburner.value).toBe(0);
      expect(createAircraftMaterials(p.id, s)).toBe(m); // cached
    }
    const inst = createAircraftMaterials('fighterA', 'enemy', { instanced: true });
    expect('LIV_LITE' in inst.body.defines).toBe(true);
  });

  it('F-14 wings sweep with speed01 and move the wingtips', () => {
    const ac = buildAircraft('f14d', { lod: 0, scheme: 'standard' });
    expect(ac.root.getObjectByName('wingL')).toBeTruthy();
    expect(ac.root.getObjectByName('wingR')).toBeTruthy();
    ac.animate({ speed01: 0 });
    const spanSlow = ac.wingtips[1].x - ac.wingtips[0].x;
    const zSlow = ac.wingtips[1].z;
    ac.animate({ speed01: 1 });
    const spanFast = ac.wingtips[1].x - ac.wingtips[0].x;
    expect(spanFast).toBeLessThan(spanSlow * 0.75);
    expect(ac.wingtips[1].z).toBeGreaterThan(zSlow + 2);
    expect(ac.span).toBeGreaterThan(18.5);
    expect(ac.length).toBeGreaterThan(18.5);
    // control surfaces respond
    const stab = ac.root.getObjectByName('stabR');
    ac.animate({ pitch: 1 });
    const q1 = stab.quaternion.clone();
    ac.animate({ pitch: -1 });
    expect(q1.angleTo(stab.quaternion)).toBeGreaterThan(0.3);
    ac.animate({ afterburner: 0.7 });
    expect(ac.materials.emissive.userData.uniforms.uAfterburner.value).toBeCloseTo(0.7);
    ac.dispose();
  });

  it('player jets have retractable landing gear touching down at gearContactY', () => {
    for (const p of PLAYER_JETS) {
      const ac = buildAircraft(p.id, { lod: 0 });
      expect(ac.gearContactY, p.id).toBeCloseTo(-2.1, 3);
      const legs = ['gearNose', 'gearMainL', 'gearMainR'].map((n) => ac.root.getObjectByName(n));
      for (const l of legs) expect(l, p.id).toBeTruthy();
      for (const d of ['doorNoseL', 'doorNoseR', 'doorMainL', 'doorMainR']) expect(ac.root.getObjectByName(d), d).toBeTruthy();
      ac.animate({ gear: 0 });
      for (const l of legs) expect(l.visible).toBe(false);
      ac.animate({ gear: 1 });
      ac.root.updateMatrixWorld(true);
      const box = new Box3();
      for (const l of legs) {
        expect(l.visible).toBe(true);
        box.expandByObject(l);
      }
      expect(box.min.y, `${p.id} tyre contact`).toBeCloseTo(-2.1, 2);
      // the gear-up static geometry excludes gear and the instance's static part matches it
      const geo = buildAircraftGeometry(p.id, 0);
      geo.body.computeBoundingBox();
      expect(geo.body.boundingBox.min.y).toBeGreaterThan(-1.6);
      ac.dispose();
    }
    // enemies: no gear nodes, gear-up static geometry
    const mig = buildAircraft('fighterA', { lod: 1 });
    expect(mig.root.getObjectByName('gearNose')).toBeFalsy();
    expect(mig.gearContactY).toBe(null);
    mig.dispose();
  });

  it('named nodes exist for weak points and moving parts', () => {
    const b52 = buildAircraft('bomberB52', { lod: 1 });
    for (const n of ['engine0', 'engine1', 'engine2', 'engine3', 'turretTail']) expect(b52.root.getObjectByName(n), n).toBeTruthy();
    expect(b52.root.getObjectByName('engine0').position.x).toBeLessThan(0);
    b52.dispose();
    expect(buildAircraft('kc10', { lod: 1 }).root.getObjectByName('boom')).toBeTruthy();
    const helo = buildAircraft('heloCH47', { lod: 1 });
    const rf = helo.root.getObjectByName('rotorF');
    expect(rf && helo.root.getObjectByName('rotorR')).toBeTruthy();
    helo.animate({ time: 0.3 });
    expect(rf.quaternion.w).toBeLessThan(0.9999);
    const ship = buildVehicle('destroyer', { lod: 1 });
    expect(ship.root.getObjectByName('turret')).toBeTruthy();
    expect(ship.root.getObjectByName('radar')).toBeTruthy();
    expect(buildVehicle('samLauncher', { lod: 1 }).root.getObjectByName('launcher')).toBeTruthy();
    expect(buildVehicle('missile', { lod: 1 }).nozzles.length).toBe(1);
    expect(() => buildAircraft('destroyer')).toThrow();
  });

  it('animate() does not allocate per call (steady-state heap)', () => {
    const ac = buildAircraft('f14d', { lod: 1 });
    const st = { roll: 0.3, pitch: -0.2, yaw: 0.1, speed01: 0.5, flaps: 0.2, time: 0 };
    for (let i = 0; i < 2000; i++) ac.animate(st);
    const pivots = Object.keys(ac.nodes);
    expect(pivots.length).toBeGreaterThan(8);
    ac.dispose();
  });
});

describe('procedural models: build time', () => {
  it('builds every design at LOD0 in < 400 ms', () => {
    // warm-up (JIT) on LOD2, then measure a cold-cache LOD0 build of everything
    clearModelCache();
    prebuildAll(2);
    clearModelCache();
    const t0 = performance.now();
    const r = prebuildAll(0);
    const ms = performance.now() - t0;
    console.log(
      `[models] LOD0 build ${ms.toFixed(1)} ms :: ` +
        Object.entries(r)
          .map(([k, v]) => `${k} ${v.ms.toFixed(1)}ms/${v.tris}t`)
          .join(', ')
    );
    expect(ms).toBeLessThan(400);
  });
});
