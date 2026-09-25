// Shared part generators for the aircraft designs.

import { Matrix4, Quaternion as _Q, Vector3 as _V3, Matrix4 as _M4 } from 'three';
import { lathe, loft, cylinder, ellipsoid } from '../loft.js';
import { applyMat, mirrorX, setGlow, setZone, taperBox, box, hexahedron, xform, DEG } from '../geom.js';
import { wingSet, wingPoint } from '../airfoil.js';

export const RED = [1.0, 0.06, 0.03];
export const GREEN = [0.1, 1.0, 0.25];
export const WHITE = [1.0, 0.97, 0.9];
export const FORMATION = [0.75, 1.0, 0.55];
export const FLAME = [1.0, 0.42, 0.12];

export const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Add geometry and its mirror image to a slot. */
export function addPair(A, slot, g, node = 'root', nodeL = node) {
  const m = mirrorX(g);
  A.add(slot, g, node);
  A.add(slot, m, nodeL);
}

/**
 * Convergent-divergent jet nozzle (metal shell, dark liner, afterburner glow).
 * Adds nozzle anchors for FX. Mirrors when `mirror` (x > 0 given).
 */
export function jetNozzle(A, o) {
  const { x = 0, y = 0, z0, z1, rBase, rExit, rThroat = rExit * 0.78, mirror = true, node = 'root', nodeL = node, petals = 12 } = o;
  const len = z1 - z0;
  const seg = A.L(o.seg ?? 32, 14, 6);
  const prof =
    A.lod >= 2
      ? [
          [rBase, z0],
          { r: rExit, z: z1, crease: true },
          { r: rExit * 0.9, z: z1, crease: true },
          [rThroat, z0 + len * 0.45]
        ]
      : [
    [rBase, z0],
    [rBase * 0.995, z0 + len * 0.22],
    { r: rBase * 0.965, z: z0 + len * 0.3, crease: true },
    [(rBase * 0.965 + rExit) * 0.5 + 0.01, z0 + len * 0.62],
    [rExit * 1.01, z1 - 0.015],
    { r: rExit, z: z1, crease: true },
    { r: rExit * 0.93, z: z1, crease: true },
    [rThroat * 1.05, z0 + len * 0.55],
    [rThroat, z0 + len * 0.36],
    [rThroat * 0.97, z0 + len * 0.2]
  ];
  const shell = lathe(prof, seg, { crease: 30 });
  // petal ridges: modulate the divergent section radially
  if (A.lod === 0 && petals) {
    const p = shell.attributes.position.array;
    const nrm = shell.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      const zz = p[i + 2];
      if (zz < z0 + len * 0.32) continue;
      if (p[i] * nrm[i] + p[i + 1] * nrm[i + 1] <= 0) continue; // outer skin only
      const k = smooth(z0 + len * 0.32, z1, zz);
      const phi = Math.atan2(p[i + 1], p[i]);
      const ridge = Math.abs(Math.cos(phi * petals * 0.5)) * 0.012 * k;
      const r = Math.hypot(p[i], p[i + 1]) || 1;
      const s = (r + ridge) / r;
      p[i] *= s;
      p[i + 1] *= s;
    }
  }
  // interior liner is darker (zone 1)
  const z = shell.attributes.aZone.array;
  const pp = shell.attributes.position.array;
  const nn = shell.attributes.normal.array;
  for (let i = 0; i < z.length; i++) {
    const r = Math.hypot(pp[i * 3], pp[i * 3 + 1]);
    const inward = pp[i * 3] * nn[i * 3] + pp[i * 3 + 1] * nn[i * 3 + 1] < 0;
    if (inward && r < rExit * 0.95) z[i] = 1;
  }
  shell.translate(x, y, 0);

  // glow: flame-holder cone + inner ring
  const zg = A.lod >= 2 ? z0 + len * 0.45 : z0 + len * 0.3;
  const glow = lathe(
    A.lod >= 2
      ? [
          [rThroat, zg],
          [0, zg - 0.1]
        ]
      : [
          [rThroat * 0.98, zg],
          [rThroat * 0.55, zg - 0.05],
          [rThroat * 0.12, zg - 0.18],
          [0, zg - 0.2]
        ],
    A.lod >= 2 ? 6 : Math.max(6, Math.round(seg * 0.75)),
    { crease: 80 }
  );
  glow.translate(x, y, 0);
  setGlow(glow, FLAME, 1, (px, py, pz) => 0.5 + 0.5 * smooth(zg - 0.2, zg, pz));

  A.metal(shell, node);
  A.emissive(glow, node);
  A.nozzle([x, y, z1], rExit * 0.92, [0, 0, 1]);
  if (mirror && x !== 0) {
    A.metal(mirrorX(shell), nodeL);
    A.emissive(mirrorX(glow), nodeL);
    A.nozzle([-x, y, z1], rExit * 0.92, [0, 0, 1]);
  }
}

/** Canopy glass loft + body-coloured frame bows at given z positions. */
export function canopy(A, stations, { frames = [], radial, rings, shape = 2.2, frameWidth = 0.07, frameScale = 1.035 } = {}) {
  const st = stations.map((s) => ({ shape, ...s }));
  A.glass(loft(st, { radial: radial ?? A.L(40, 18, 10), rings: rings ?? A.L(26, 10, 4), capStart: 'flat', capEnd: 'flat' }));
  if (A.lod >= 2) return;
  for (const fz of frames) {
    // interpolate station params at fz
    let i = 0;
    while (i < st.length - 2 && st[i + 1].z < fz) i++;
    const a = st[i];
    const b = st[i + 1];
    const t = Math.min(Math.max((fz - a.z) / (b.z - a.z), 0), 1);
    const w = (a.width + (b.width - a.width) * t) * frameScale;
    const h = (a.height + (b.height - a.height) * t) * frameScale;
    const y = a.y + (b.y - a.y) * t;
    const s = { width: w, height: h, y, shape };
    A.body(
      loft(
        [
          { ...s, z: fz - frameWidth / 2 },
          { ...s, z: fz + frameWidth / 2 }
        ],
        { radial: A.L(40, 18, 10), rings: 1 }
      )
    );
  }
}

/** Pylon with rounded ends. */
export function pylon(A, { x, y, z, len, h, w = 0.14, mirror = true, node = 'root' }) {
  const g = taperBox({ w0: w, d0: len, w1: w * 0.9, d1: len * 1.05, y0: y - h, y1: y, x, z, zone: 0 });
  A.body(g, node);
  if (mirror && x !== 0) A.body(mirrorX(g), node);
}

/** Standard nav lights. left/right may live on pivot nodes. */
export function navLights(A, { left, right, leftNode = 'root', rightNode = 'root', tail, strobes = [], size = 0.07 }) {
  if (left) A.light(left, RED, { size, node: leftNode });
  if (right) A.light(right, GREEN, { size, node: rightNode });
  if (tail) A.light(tail, WHITE, { size: size * 0.9 });
  for (const s of strobes) A.light(s, [1, 0.12, 0.08], { kind: 2, size: size * 0.9 });
}

/** Thin emissive formation-light strip (flat quad) centred at pos, facing +x/-x. */
export function formationStrip(A, pos, len, { axis = 'x', height = 0.06, node = 'root', mirror = true, rz = 0 } = {}) {
  const g = box(axis === 'y' ? len : 0.012, axis === 'y' ? 0.012 : height, axis === 'y' ? height : len);
  applyMat(g, xform({ pos, rz }));
  setGlow(g, FORMATION, 3);
  A.emissive(g, node);
  if (mirror && pos[0] !== 0) A.emissive(mirrorX(g), node);
}

/**
 * Lifting surface with optional control surfaces, registered on the assembly.
 * wingOpts: airfoil options (origin, matrix, mirror...)
 * surfaces: [{ name, span, chord, prefer }] -> hinge nodes '<name>R' / '<name>L'
 */
export function liftingSurface(A, wingOpts, surfaces = [], { node = 'root', nodeL = node, split = A.lod < 2, prefer = 'x', parentR, parentL } = {}) {
  const ws = wingSet(wingOpts, surfaces, split);
  if (wingOpts.mirror && node !== nodeL) {
    // split fixed part into right/left halves by x sign
    const [r, l] = splitByX(ws.fixed);
    A.body(r, node);
    A.body(l, nodeL);
  } else A.body(ws.fixed, node);
  for (const s of ws.surfaces) {
    const parent = s.side > 0 ? (parentR ?? node) : (parentL ?? nodeL);
    A.hinge(s.name, s.a, s.b, { prefer, parent });
    A.body(s.geometry, s.name);
  }
  return ws;
}

/** Split an indexed geometry into x>=0 and x<0 triangle sets (by triangle centroid). */
export function splitByX(g) {
  const idx = g.index.array;
  const p = g.attributes.position.array;
  const R = [];
  const L = [];
  for (let i = 0; i < idx.length; i += 3) {
    const cx = p[idx[i] * 3] + p[idx[i + 1] * 3] + p[idx[i + 2] * 3];
    (cx >= 0 ? R : L).push(idx[i], idx[i + 1], idx[i + 2]);
  }
  const a = g.clone();
  a.setIndex(R);
  const b = g.clone();
  b.setIndex(L);
  return [a, b];
}

export function tipPoint(o, s = 1, xc = 0.85) {
  const p = wingPoint(o, s, xc, 0);
  if (o.matrix) p.applyMatrix4(o.matrix);
  return p;
}

export function rot(opts) {
  return xform(opts);
}

export function ident() {
  return new Matrix4();
}

export { lathe, loft, cylinder, ellipsoid, setGlow, setZone, taperBox, box, hexahedron, xform, DEG, mirrorX, applyMat, wingPoint };

/**
 * Air-to-air missile store (fixed-colour zones so it ignores the jet's camo):
 * 'aim120' (3.65 m, medium range) or 'aim9' (3.0 m, short range). Nose -Z,
 * centred at `pos`. Added on its own node so gameplay can hide it on launch.
 */
export function missileStore(A, pos, { type = 'aim120', node, parent = 'root' } = {}) {
  if (node && !A.nodes.has(node)) A.node(node, pos, { parent });
  if (A.lod > 0) return;
  const aim9 = type === 'aim9';
  const R = aim9 ? 0.064 : 0.089;
  const len = aim9 ? 3.0 : 3.65;
  const h = len / 2;
  const seg = 16;
  const parts = [];
  const nose = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    nose.push([aim9 ? R * Math.min(1, 0.55 + 0.45 * Math.sqrt(t)) * (i === 0 ? 0 : 1) : R * Math.sqrt(1 - (1 - t) * (1 - t)), -h + t * (aim9 ? 0.14 : 0.4)]);
  }
  nose[0] = [0, -h];
  const zN = nose[nose.length - 1][1];
  parts.push(lathe(nose, seg, { zone: aim9 ? 9 : 2, crease: 60 }));
  const bands = aim9
    ? [
        [zN, zN + 0.55, 4],
        [zN + 0.55, zN + 0.6, 6],
        [zN + 0.6, h - 0.04, 4]
      ]
    : [
        [zN, -1.1, 4],
        [-1.1, -1.04, 6],
        [-1.04, 0.3, 4],
        [0.3, 0.35, 7],
        [0.35, h - 0.04, 4]
      ];
  for (const [a, b, zone] of bands) parts.push(lathe([[R, a], [R, b]], seg, { zone }));
  parts.push(lathe([[R, h - 0.04], [R * 0.8, h], [0, h]], seg, { zone: 3, crease: 40 }));
  // cruciform fins: forward canards (aim9) / mid wings (aim120) + tail fins
  const finSets = aim9
    ? [
        { z: -h + 0.28, root: 0.26, tip: 0.06, span: 0.11 },
        { z: h - 0.32, root: 0.3, tip: 0.2, span: 0.2 }
      ]
    : [
        { z: -0.55, root: 0.5, tip: 0.1, span: 0.18 },
        { z: h - 0.46, root: 0.38, tip: 0.2, span: 0.18 }
      ];
  for (const f of finSets) {
    for (let k = 0; k < 4; k++) {
      const g = taperBox({ w0: 0.012, d0: f.root, w1: 0.008, d1: f.tip, y0: R * 0.8, y1: R + f.span, x: 0, z: f.z + f.root / 2, zTop: (f.root - f.tip) / 2 });
      applyMat(g, xform({ rz: 45 + k * 90 }));
      setZone(g, 4);
      parts.push(g);
    }
  }
  // launch rail / shoe on top
  parts.push(box(0.05, 0.05, len * 0.55, { pos: [0, R + 0.02, 0.1], zone: 5 }));
  for (const g of parts) {
    g.translate(pos[0], pos[1], pos[2]);
    A.body(g, node || 'root');
  }
}

/** Small swept blade antenna (LOD0/1 only). `down` hangs it under the belly. */
export function bladeAntenna(A, pos, { h = 0.22, len = 0.32, down = false } = {}) {
  if (A.lod >= 2) return;
  const g = taperBox({ w0: 0.03, d0: len, w1: 0.018, d1: len * 0.45, y0: 0, y1: h, x: 0, z: 0, zTop: len * 0.3 });
  if (down) applyMat(g, xform({ rz: 180 }));
  g.translate(pos[0], pos[1], pos[2]);
  A.body(g);
}

// ---------------------------------------------------------------- gear -----

const _gq = new _Q();
const _gz = new _V3(0, 0, 1);

/** Cylinder between points a and b (radius r0 at a, r1 at b). */
export function rod(a, b, r0, r1 = r0, seg = 8, zone = 0) {
  const d = new _V3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length() || 1e-3;
  const g = lathe(
    [
      [0, 0],
      { r: r0, z: 0, crease: true },
      { r: r1, z: len, crease: true },
      [0, len]
    ],
    seg,
    { zone, crease: 60 }
  );
  _gq.setFromUnitVectors(_gz, d.normalize());
  g.applyMatrix4(new _M4().makeRotationFromQuaternion(_gq));
  g.translate(a[0], a[1], a[2]);
  return g;
}

/** Tyre (body, rubber zone) + hub (metal) with the axle along X, centred at c. */
function wheel(A, c, r, w, node) {
  const seg = A.L(20, 10, 6);
  const tyre = lathe(
    [
      [r * 0.6, -w / 2],
      [r * 0.9, -w / 2],
      [r * 0.99, -w * 0.32],
      [r, 0],
      [r * 0.99, w * 0.32],
      [r * 0.9, w / 2],
      [r * 0.6, w / 2]
    ],
    seg,
    { zone: 3, crease: 70 }
  );
  const hub = lathe(
    [
      [0, -w * 0.36],
      [r * 0.3, -w * 0.4],
      { r: r * 0.61, z: -w * 0.42, crease: true },
      { r: r * 0.61, z: w * 0.42, crease: true },
      [r * 0.3, w * 0.4],
      [0, w * 0.36]
    ],
    seg,
    { crease: 70 }
  );
  const m = xform({ ry: 90, pos: c });
  applyMat(tyre, m);
  applyMat(hub, m);
  A.body(tyre, node);
  A.metal(hub, node);
}

/**
 * Retractable tricycle landing gear. Creates deployable nodes (excluded from
 * the static gear-up geometry): 'gearNose', 'gearMainL', 'gearMainR' (legs,
 * fold about +X by `stow` degrees), 'doorNoseL/R', 'doorMainL/R' (hinged on
 * their outer edge) and 'gearWells' (dark well openings). Driven by
 * state.gear 0..1 (1 = down & locked, 0 = up / hidden). Tyres touch y = ground.
 *
 * spec = { ground, navy,
 *   nose: { hinge:[0,y,z], axleZ, tireR, tireW, twin (x offset|0), strutR, stow,
 *           well: { y, width, z0, z1 } },
 *   main: { hinge:[x,y,z], axle:[x,z], tireR, tireW, strutR, stow, brace:[x,y,z],
 *           well: { x0, x1, y, z0, z1 } } }
 */
export function landingGear(A, spec) {
  A.meta.gearContactY = spec.ground;
  if (A.lod >= 2) return;
  const G = spec.ground;
  const seg = A.L(12, 7, 5);
  const gearT = (s) => Math.min(Math.max(s.gear ?? 0, 0), 1);
  const legAngle = (stow) => (s) => stow * DEG * (1 - smooth(0.2, 1.0, gearT(s)));
  const doorAngle = (sign) => (s) => sign * 86 * DEG * smooth(0.0, 0.3, gearT(s));
  const shown = (s) => gearT(s) > 0.004;

  // ---- nose gear
  const n = spec.nose;
  A.node('gearNose', n.hinge, { axis: [1, 0, 0], deploy: true });
  const axleY = G + n.tireR;
  const axle = [0, axleY, n.axleZ ?? n.hinge[2]];
  const top = n.hinge;
  const mid = [0, (top[1] + axleY) * 0.5 + 0.1, (top[2] + axle[2]) * 0.5];
  A.metal(rod(top, [0, mid[1], mid[2]], n.strutR, n.strutR * 0.95, seg), 'gearNose');
  A.metal(rod([0, mid[1] + 0.05, mid[2]], [0, axleY + 0.06, axle[2]], n.strutR * 0.62, n.strutR * 0.6, seg), 'gearNose');
  A.body(rod([-(n.twin || 0.08) - 0.02, axleY, axle[2]], [(n.twin || 0.08) + 0.02, axleY, axle[2]], 0.045, 0.045, seg), 'gearNose');
  // torque link + forward drag brace
  A.metal(rod([0, axleY + 0.12, axle[2] + 0.02], [0, mid[1] - 0.05, mid[2] + 0.14], 0.025, 0.025, 5), 'gearNose');
  A.metal(rod([0, mid[1] + 0.2, mid[2]], [0, top[1] - 0.05, top[2] - 0.75], 0.03, 0.03, 5), 'gearNose');
  if (n.twin) {
    wheel(A, [n.twin, axleY, axle[2]], n.tireR, n.tireW, 'gearNose');
    wheel(A, [-n.twin, axleY, axle[2]], n.tireR, n.tireW, 'gearNose');
  } else {
    wheel(A, [0, axleY, axle[2]], n.tireR, n.tireW, 'gearNose');
  }
  if (spec.navy) {
    // catapult launch bar (lowered forward of the nose wheels)
    const lb0 = [0, axleY + 0.22, axle[2] - 0.05];
    const lb1 = [0, G + 0.12, axle[2] - 0.95];
    A.metal(rod([0.06, lb0[1], lb0[2]], [0.06, lb1[1], lb1[2]], 0.03, 0.028, 5), 'gearNose');
    A.metal(rod([-0.06, lb0[1], lb0[2]], [-0.06, lb1[1], lb1[2]], 0.03, 0.028, 5), 'gearNose');
    A.metal(rod([-0.09, lb1[1], lb1[2]], [0.09, lb1[1], lb1[2]], 0.035, 0.035, 5), 'gearNose');
  }
  A.control('gearNose', legAngle(n.stow ?? 90));
  A.visible('gearNose', shown);

  // ---- main gear (mirrored)
  const m = spec.main;
  for (const sgn of [1, -1]) {
    const name = sgn > 0 ? 'gearMainR' : 'gearMainL';
    const h = [m.hinge[0] * sgn, m.hinge[1], m.hinge[2]];
    A.node(name, h, { axis: [1, 0, 0], deploy: true });
    const ay = G + m.tireR;
    const ax = [m.axle[0] * sgn, ay, m.axle[1]];
    const inner = ax[0] - sgn * (m.tireW * 0.5 + 0.06);
    const legBot = [inner, ay + 0.02, ax[2]];
    const mid2 = [(h[0] + legBot[0]) * 0.5, (h[1] + legBot[1]) * 0.5 + 0.05, (h[2] + legBot[2]) * 0.5];
    A.metal(rod(h, mid2, m.strutR, m.strutR * 0.95, seg), name);
    A.metal(rod(mid2, legBot, m.strutR * 0.64, m.strutR * 0.6, seg), name);
    A.body(rod([inner, ay, ax[2]], [ax[0] + sgn * (m.tireW * 0.5 + 0.02), ay, ax[2]], 0.05, 0.05, seg), name);
    if (m.brace) {
      const b = [m.brace[0] * sgn, m.brace[1], m.brace[2]];
      A.metal(rod(b, [mid2[0], mid2[1] - 0.1, mid2[2]], 0.035, 0.035, 5), name);
    }
    A.metal(rod([inner, ay + 0.15, ax[2] - 0.02], [mid2[0], mid2[1] - 0.25, mid2[2] - 0.16], 0.028, 0.028, 5), name);
    wheel(A, ax, m.tireR, m.tireW, name);
    A.control(name, legAngle(m.stow ?? 90));
    A.visible(name, shown);
  }

  // ---- wells (dark openings, static while shown) + doors
  A.node('gearWells', [0, 0, 0], { deploy: true });
  A.visible('gearWells', shown);
  const nw = n.well;
  A.body(box(nw.width, 0.012, nw.z1 - nw.z0, { pos: [0, nw.y, (nw.z0 + nw.z1) / 2], zone: 1 }), 'gearWells');
  const hw = nw.width / 2;
  for (const sgn of [1, -1]) {
    const name = sgn > 0 ? 'doorNoseR' : 'doorNoseL';
    A.node(name, [hw * sgn, nw.y - 0.01, (nw.z0 + nw.z1) / 2], { axis: [0, 0, 1], deploy: true });
    A.body(box(hw * 0.98, 0.02, nw.z1 - nw.z0, { pos: [(hw * 0.51) * sgn, nw.y - 0.012, (nw.z0 + nw.z1) / 2] }), name);
    A.control(name, doorAngle(sgn));
    A.visible(name, shown);
  }
  const mw = m.well;
  for (const sgn of [1, -1]) {
    const cx = ((mw.x0 + mw.x1) / 2) * sgn;
    const wdt = mw.x1 - mw.x0;
    A.body(box(wdt, 0.012, mw.z1 - mw.z0, { pos: [cx, mw.y, (mw.z0 + mw.z1) / 2], zone: 1 }), 'gearWells');
    const name = sgn > 0 ? 'doorMainR' : 'doorMainL';
    const hx = mw.x1 * sgn;
    A.node(name, [hx, mw.y - 0.01, (mw.z0 + mw.z1) / 2], { axis: [0, 0, 1], deploy: true });
    A.body(box(wdt * 0.97, 0.02, (mw.z1 - mw.z0) * 0.98, { pos: [hx - sgn * wdt * 0.5, mw.y - 0.012, (mw.z0 + mw.z1) / 2] }), name);
    A.control(name, doorAngle(sgn));
    A.visible(name, shown);
  }
}
