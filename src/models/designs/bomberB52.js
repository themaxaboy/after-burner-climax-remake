// Enemy bomber "B52": B-52-inspired strategic bomber (original procedural design).
// Slab-sided fuselage, long 35 deg swept shoulder wing, 8 engines in 4 twin
// pods (weak-point nodes 'engine0'..'engine3'), tall fin, tail turret node
// 'turretTail'. Length ~48.5 m, span 56.4 m.

import { loft, lathe, canopy, liftingSurface, navLights, tipPoint, addPair, taperBox, xform, setGlow, FLAME, mirrorX } from './common.js';
import { wingPoint } from '../airfoil.js';

const WING = {
  origin: [1.3, 2.35, -7.0],
  rootChord: 12.6,
  tipChord: 3.6,
  span: 26.9,
  sweepDeg: 36,
  dihedralDeg: -1.5,
  thicknessRatio: 0.1,
  tipThicknessRatio: 0.075,
  twistDeg: -3,
  mirror: true
};

export default {
  id: 'bomberB52',
  name: 'Bomber B52 (strategic)',
  kind: 'bomber',
  defaultScheme: 'enemy',
  livery: {
    panel: [2.4, 1.1],
    groove: 0.008,
    sootRange: [1e9, 1e9 + 1, 0],
    radomeZ: -23.3,
    camoScale: 0.06
  },
  schemes: {
    // gunmetal with a red-orange fin top and wing tips
    enemy: {
      preset: 'enemyBomberDark',
      tailTipY: 7.2,
      tailZ: 12,
      stripe: { a: '#ff5a1c', b: '#a3210f', y: 0, amp: 0, width: 0.1, z0: 1e4, z1: 1e4, period: 3, sideMin: 0.5, wingZ: -1.25, wingK: 0.5, wingWidth: 3.5, wingXMin: 21 }
    },
    desert: 'enemyDesert',
    gray: 'tankerGray'
  },
  decals: [
    { tex: 'n88', center: [0, 1.4, -17.0], size: [2.4, 1.1], axis: 'x', depth: 1.7 },
    { tex: 'emblemEnemy', center: [0, 6.2, 18.5], size: [2.6, 2.6], axis: 'x', depth: 0.6 },
    { tex: 'emblemEnemy', center: [16.5, 2.3, 6.8], size: [3.4, 3.4], axis: 'y', depth: 0.9, side: 1, mirror: true },
    { tex: 'emblemEnemy', center: [0, 1.4, 4.0], size: [2.0, 2.0], axis: 'x', depth: 1.7 }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    // slab-sided fuselage
    A.body(
      loft(
        [
          { z: -24.4, width: 2.2, height: 2.4, y: 0.35 },
          { z: -23.2, width: 2.5, height: 2.9, y: 0.45, shape: { nTop: 2.4, nBottom: 3 } },
          { z: -20.5, width: 2.9, height: 3.5, y: 0.65, shape: { nTop: 2.6, nBottom: 3.4 } },
          { z: -15.0, width: 3.0, height: 3.95, y: 0.9, shape: { nTop: 2.8, nBottom: 3.6 } },
          { z: 0.0, width: 3.0, height: 4.0, y: 1.0, shape: { nTop: 2.8, nBottom: 3.6 } },
          { z: 10.0, width: 2.8, height: 3.8, y: 1.15, shape: { nTop: 2.8, nBottom: 3.4 } },
          { z: 16.0, width: 2.2, height: 3.0, y: 1.45, shape: 3 },
          { z: 21.5, width: 1.3, height: 1.7, y: 1.9, shape: 2.6 },
          { z: 23.6, width: 0.9, height: 1.0, y: 2.0 }
        ],
        { radial: L(56, 22, 10), rings: L(110, 32, 10), capStart: 'round', capEnd: 'flat' }
      )
    );
    // stepped cockpit windscreen
    canopy(
      A,
      [
        { z: -22.6, width: 1.0, height: 0.3, y: 2.1 },
        { z: -21.9, width: 2.1, height: 1.0, y: 2.1 },
        { z: -20.6, width: 2.4, height: 1.3, y: 2.15 },
        { z: -19.6, width: 2.2, height: 0.9, y: 2.2 },
        { z: -19.0, width: 1.4, height: 0.5, y: 2.2 }
      ],
      { frames: [-21.4, -20.4], shape: 2.6, frameWidth: 0.1 }
    );
    // chin sensor blisters
    if (A.lod < 2) {
      const bl = lathe(
        [
          [0, -0.55],
          [0.36, -0.35],
          [0.42, 0.1],
          [0.3, 0.5],
          [0, 0.6]
        ],
        L(14, 8, 4),
        { zone: 9 }
      );
      bl.translate(0.6, -0.95, -21.4);
      addPair(A, 'body', bl);
    }

    // wing with flaps
    const wingO = { ...WING, chordSegments: L(26, 10, 4), spanSegments: L(22, 7, 2) };
    liftingSurface(A, wingO, [
      { name: 'flap', span: [0.05, 0.42], chord: 0.8 },
      { name: 'aileron', span: [0.5, 0.72], chord: 0.82 }
    ]);
    const tipR = tipPoint(wingO, 1, 0.5);
    A.wingtip([-tipR.x, tipR.y, tipR.z]);
    A.wingtip([tipR.x, tipR.y, tipR.z]);

    // twin-engine pods on pylons, as weak-point nodes
    const podX = [-16.2, -9.1, 9.1, 16.2];
    podX.forEach((x, i) => {
      const ax = Math.abs(x);
      const s = (ax - WING.origin[0]) / WING.span;
      const le = wingPoint(WING, s, 0.0, 0);
      const cz = le.z - 1.6;
      const cy = le.y - 1.75;
      const name = `engine${i}`;
      A.node(name, [x, cy, cz]);
      const parts = enginePod(A, cz, cy);
      for (const g of parts.body) {
        if (x < 0) A.body(mirrorX(shift(g, ax)), name);
        else A.body(shift(g, ax), name);
      }
      for (const g of parts.metal) A.metal(x < 0 ? mirrorX(shift(g, ax)) : shift(g, ax), name);
      for (const g of parts.glow) A.emissive(x < 0 ? mirrorX(shift(g, ax)) : shift(g, ax), name);
      for (const dx of [-0.66, 0.66]) A.nozzle([x + dx, cy - 0.05, cz + 3.1], 0.42, [0, 0, 1]);
    });
    // external tanks near the tips
    {
      const x = 22.3;
      const s = (x - WING.origin[0]) / WING.span;
      const le = wingPoint(WING, s, 0.0, 0);
      const tank = lathe(
        [
          [0, -4.8],
          [0.35, -4.2],
          [0.68, -2.6],
          [0.72, 0],
          [0.66, 2.8],
          [0.4, 4.2],
          [0.08, 5.0],
          [0, 5.05]
        ],
        L(20, 10, 6),
        { crease: 60 }
      );
      tank.translate(x, le.y - 1.05, le.z + 2.4);
      addPair(A, 'body', tank);
      A.body(taperBox({ w0: 0.12, d0: 2.6, w1: 0.12, d1: 3.2, y0: le.y - 0.5, y1: le.y + 0.1, x, z: le.z + 2.6 }));
      A.body(taperBox({ w0: 0.12, d0: 2.6, w1: 0.12, d1: 3.2, y0: le.y - 0.5, y1: le.y + 0.1, x: -x, z: le.z + 2.6 }));
      // tank fins
      if (A.lod < 2) {
        const fin = taperBox({ w0: 0.05, d0: 1.4, w1: 0.05, d1: 0.7, y0: le.y - 1.05, y1: le.y - 0.1, x, z: le.z + 6.5, zTop: 0.35 });
        addPair(A, 'body', fin);
      }
    }

    // tall fin + rudder
    liftingSurface(
      A,
      {
        origin: [0, 0, 0],
        matrix: xform({ pos: [0, 2.6, 10.6], rz: 90 }),
        rootChord: 10.4,
        tipChord: 3.4,
        span: 7.8,
        sweepDeg: 40,
        thicknessRatio: 0.08,
        tipThicknessRatio: 0.06,
        chordSegments: L(20, 8, 3),
        spanSegments: L(10, 3, 1),
        mirror: false
      },
      [{ name: 'rudder', span: [0.08, 0.95], chord: 0.8 }],
      { prefer: 'y' }
    );
    // horizontal stabs + elevators
    liftingSurface(
      A,
      {
        origin: [0.8, 1.6, 15.8],
        rootChord: 6.6,
        tipChord: 2.4,
        span: 7.9,
        sweepDeg: 38,
        thicknessRatio: 0.07,
        chordSegments: L(18, 7, 3),
        spanSegments: L(9, 3, 1),
        mirror: true
      },
      [{ name: 'elevator', span: [0.04, 0.96], chord: 0.72 }]
    );

    // tail turret (weak point)
    A.node('turretTail', [0, 2.0, 24.2], { axis: [0, 1, 0] });
    A.body(
      lathe(
        [
          [0.5, 23.5],
          [0.62, 23.9],
          [0.55, 24.5],
          [0.3, 24.9],
          [0, 25.0]
        ],
        L(16, 8, 5),
        { center: [0, 2.0] }
      ),
      'turretTail'
    );
    for (const dx of [-0.16, 0.16]) {
      const barrel = lathe(
        [
          [0, 24.4],
          [0.05, 24.4],
          [0.045, 26.2],
          [0, 26.2]
        ],
        L(8, 5, 3)
      );
      barrel.translate(dx, 2.0, 0);
      A.metal(barrel, 'turretTail');
    }

    navLights(A, {
      left: [-tipR.x, tipR.y, tipR.z - 1.5],
      right: [tipR.x, tipR.y, tipR.z - 1.5],
      tail: [0, 10.4, 20.0],
      strobes: [
        [0, 3.1, -6],
        [0, -1.05, 6]
      ],
      size: 0.16
    });
    A.gun([0, 2.0, 26.2]);
    for (const hp of [
      [0.5, -1.2, 0],
      [4.5, 1.2, -1]
    ]) {
      A.hardpoint([-hp[0], hp[1], hp[2]]);
      A.hardpoint(hp);
    }

    A.control('aileronR', (s) => -(s.roll ?? 0) * 0.3);
    A.control('aileronL', (s) => (s.roll ?? 0) * 0.3);
    A.control('flapR', (s) => (s.flaps ?? 0) * 0.5);
    A.control('flapL', (s) => (s.flaps ?? 0) * 0.5);
    A.control('elevatorR', (s) => -(s.pitch ?? 0) * 0.3);
    A.control('elevatorL', (s) => -(s.pitch ?? 0) * 0.3);
    A.control('rudder', (s) => (s.yaw ?? 0) * 0.35);
    A.control('turretTail', (s) => Math.sin((s.time ?? 0) * 0.6) * 0.5);
  }
};

function shift(g, x) {
  return g.translate(x, 0, 0);
}

/** Twin-engine pod centred at x = 0 (caller shifts / mirrors). */
function enginePod(A, cz, cy) {
  const L = (a, b, c) => A.L(a, b, c);
  const body = [];
  const metal = [];
  const glow = [];
  const seg = L(24, 12, 6);
  if (A.lod >= 2) {
    for (const dx of [-0.66, 0.66]) {
      const nac = lathe(
        [
          [0, -2.8],
          { r: 0.5, z: -2.9, crease: true },
          [0.63, -2.4],
          [0.5, 2.3],
          [0.36, 3.1],
          [0, 3.1]
        ],
        5,
        { crease: 60 }
      );
      nac.translate(dx, cy, cz);
      const z = nac.attributes.aZone.array;
      const p = nac.attributes.position.array;
      for (let i = 0; i < z.length; i++) if (p[i * 3 + 2] < cz - 2.85) z[i] = 1;
      body.push(nac);
    }
    body.push(taperBox({ w0: 0.26, d0: 4.6, w1: 0.2, d1: 5.6, y0: cy + 0.3, y1: cy + 1.95, x: 0, z: cz + 0.6, zTop: 1.4 }));
    return { body, metal, glow };
  }
  for (const dx of [-0.66, 0.66]) {
    const nac = lathe(
      [
        { r: 0.46, z: -2.9, crease: true },
        [0.6, -2.75],
        [0.64, -2.2],
        [0.62, 0.8],
        [0.52, 2.2],
        { r: 0.46, z: 2.6, crease: true },
        { r: 0.0, z: 2.6 }
      ],
      seg,
      { crease: 50 }
    );
    nac.translate(dx, cy, cz);
    body.push(nac);
    // dark intake face + spinner
    const face = lathe(
      [
        [0, -2.8],
        [0.08, -2.7],
        [0.2, -2.45],
        [0.44, -2.5],
        [0.47, -2.9]
      ],
      seg,
      { crease: 50, zone: 1 }
    );
    face.translate(dx, cy, cz);
    body.push(face);
    const noz = lathe(
      [
        [0.46, 2.55],
        [0.42, 3.1],
        { r: 0.36, z: 3.1, crease: true },
        [0.3, 2.7]
      ],
      seg,
      { crease: 50 }
    );
    noz.translate(dx, cy, cz);
    metal.push(noz);
    const gl = lathe(
      [
        [0.3, 2.72],
        [0, 2.6]
      ],
      Math.max(6, seg >> 1)
    );
    gl.translate(dx, cy, cz);
    setGlow(gl, FLAME, 1);
    glow.push(gl);
  }
  // pod fairing between the two nacelles + pylon
  body.push(taperBox({ w0: 0.6, d0: 4.4, w1: 0.6, d1: 4.8, y0: cy - 0.35, y1: cy + 0.4, x: 0, z: cz + 0.2 }));
  body.push(taperBox({ w0: 0.28, d0: 4.6, w1: 0.22, d1: 5.6, y0: cy + 0.3, y1: cy + 1.95, x: 0, z: cz + 0.6, zTop: 1.4 }));
  return { body, metal, glow };
}
