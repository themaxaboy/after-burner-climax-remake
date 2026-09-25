// KC-10-inspired tri-jet tanker (original procedural design). Wide-body
// fuselage, two under-wing engines, tail engine in the fin, refuelling boom
// on node 'boom'. Length ~55 m, span 50 m.

import { loft, lathe, liftingSurface, navLights, tipPoint, addPair, taperBox, xform, setGlow, FLAME } from './common.js';
import { bandProfile } from '../loft.js';
import { wingPoint } from '../airfoil.js';

const WING = {
  origin: [2.6, -1.95, -6.6],
  rootChord: 11.0,
  tipChord: 2.7,
  span: 22.6,
  sweepDeg: 35,
  dihedralDeg: 5,
  thicknessRatio: 0.11,
  tipThicknessRatio: 0.08,
  twistDeg: -3,
  mirror: true
};

const FUSE = [
  { z: -27.4, width: 0, height: 0, y: -0.35 },
  { z: -26.2, width: 3.2, height: 3.0, y: -0.3 },
  { z: -24.2, width: 5.0, height: 4.9, y: -0.12 },
  { z: -21.5, width: 5.85, height: 5.9, y: 0.0 },
  { z: -18.0, width: 6.0, height: 6.0, y: 0.0 },
  { z: 12.0, width: 6.0, height: 6.0, y: 0.0 },
  { z: 18.0, width: 5.1, height: 5.3, y: 0.5 },
  { z: 23.0, width: 3.3, height: 3.7, y: 1.2 },
  { z: 26.6, width: 1.3, height: 1.6, y: 1.8 },
  { z: 27.9, width: 0, height: 0, y: 1.95 }
];

export default {
  id: 'kc10',
  name: 'KC-10 Tanker',
  kind: 'tanker',
  defaultScheme: 'standard',
  glassTint: '#0b0f14',
  livery: {
    panel: [2.2, 1.2],
    groove: 0.008,
    sootRange: [1e9, 1e9 + 1, 0],
    radomeZ: -26.0,
    camoScale: 0.05
  },
  schemes: { standard: 'tankerGray', enemy: 'tankerGray' },
  decals: [
    { tex: 'emblemTanker', center: [0, 11.0, 21.4], size: [2.4, 2.4], axis: 'x', depth: 0.6 },
    { tex: 'n512', center: [0, 1.2, -19.5], size: [2.4, 1.1], axis: 'x', depth: 3.2 },
    { tex: 'roundel', center: [0, 1.0, 14.5], size: [2.2, 2.2], axis: 'x', depth: 3.2 },
    { tex: 'stencil', center: [0, 2.0, 5.0], size: [4.0, 1.0], axis: 'x', depth: 3.2 }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    A.body(loft(FUSE, { radial: L(56, 22, 10), rings: L(110, 32, 11), noseBoost: 1.9, tailBoost: 1.2 }));
    // cockpit window band
    const band = bandProfile(0.35, Math.PI - 0.35, 0.03);
    A.glass(
      loft(
        [
          { z: -25.6, width: 4.25, height: 4.1, y: -0.12, shape: band },
          { z: -24.9, width: 4.9, height: 4.8, y: -0.1, shape: band },
          { z: -24.1, width: 5.25, height: 5.2, y: -0.08, shape: band }
        ].map((s) => ({ ...s, width: s.width * 1.012, height: s.height * 1.012 })),
        { radial: L(40, 16, 8), rings: L(6, 3, 1), crease: 50, capStart: 'none', capEnd: 'none' }
      )
    );
    // wing-body fairing
    A.body(
      loft(
        [
          { z: -9.0, width: 0, height: 0, y: -2.0 },
          { z: -6.0, width: 5.4, height: 1.8, y: -2.1 },
          { z: 2.0, width: 7.0, height: 2.4, y: -2.2, shape: 3 },
          { z: 7.5, width: 5.6, height: 1.8, y: -2.1 },
          { z: 11.0, width: 0, height: 0, y: -1.9 }
        ],
        { radial: L(36, 14, 8), rings: L(30, 10, 4) }
      )
    );

    const wingO = { ...WING, chordSegments: L(26, 10, 4), spanSegments: L(20, 6, 2) };
    liftingSurface(A, wingO, [
      { name: 'flap', span: [0.05, 0.45], chord: 0.76 },
      { name: 'aileron', span: [0.72, 0.95], chord: 0.76 }
    ]);
    const tipR = tipPoint(wingO, 1, 0.5);
    A.wingtip([-tipR.x, tipR.y, tipR.z]);
    A.wingtip([tipR.x, tipR.y, tipR.z]);

    // under-wing engines
    {
      const x = 8.9;
      const s = (x - WING.origin[0]) / WING.span;
      const le = wingPoint(WING, s, 0, 0);
      const cz = le.z - 2.6;
      const cy = le.y - 1.9;
      const pod = turbofan(A, 1.42, 7.2);
      for (const g of pod.body) {
        g.translate(x, cy, cz);
        addPair(A, 'body', g);
      }
      for (const g of pod.metal) {
        g.translate(x, cy, cz);
        addPair(A, 'metal', g);
      }
      for (const g of pod.glow) {
        g.translate(x, cy, cz);
        addPair(A, 'emissive', g);
      }
      const py = taperBox({ w0: 0.4, d0: 5.5, w1: 0.34, d1: 6.2, y0: cy + 1.1, y1: le.y + 0.2, x, z: cz + 2.4, zTop: 1.2 });
      addPair(A, 'body', py);
      A.nozzle([-x, cy, cz + 4.4], 0.9);
      A.nozzle([x, cy, cz + 4.4], 0.9);
    }
    // tail engine through the fin root
    {
      const cy = 4.55;
      const cz = 18.6;
      const pod = turbofan(A, 1.35, 8.2, true);
      for (const g of pod.body) A.body(g.translate(0, cy, cz));
      for (const g of pod.metal) A.metal(g.translate(0, cy, cz));
      for (const g of pod.glow) A.emissive(g.translate(0, cy, cz));
      A.body(taperBox({ w0: 1.2, d0: 7.0, w1: 1.0, d1: 6.0, y0: 2.4, y1: 3.8, x: 0, z: cz + 0.8, zTop: 0.6 }));
      A.nozzle([0, cy, cz + 4.6], 0.85);
    }
    // vertical fin above the tail engine
    liftingSurface(
      A,
      {
        origin: [0, 0, 0],
        matrix: xform({ pos: [0, 5.6, 16.4], rz: 90 }),
        rootChord: 7.8,
        tipChord: 3.6,
        span: 6.6,
        sweepDeg: 40,
        thicknessRatio: 0.1,
        tipThicknessRatio: 0.08,
        chordSegments: L(18, 8, 3),
        spanSegments: L(8, 3, 1)
      },
      [{ name: 'rudder', span: [0.06, 0.94], chord: 0.72 }],
      { prefer: 'y' }
    );
    liftingSurface(
      A,
      {
        origin: [1.3, 0.9, 18.3],
        rootChord: 7.0,
        tipChord: 2.4,
        span: 9.6,
        sweepDeg: 36,
        dihedralDeg: 7,
        thicknessRatio: 0.09,
        chordSegments: L(18, 7, 3),
        spanSegments: L(9, 3, 1),
        mirror: true
      },
      [{ name: 'elevator', span: [0.05, 0.95], chord: 0.72 }]
    );

    // refuelling boom (pitch hinge under the tail) + operator window
    A.node('boom', [0, -2.35, 20.6], { axis: [1, 0, 0] });
    const boomG = lathe(
      [
        [0, -0.6],
        [0.42, -0.3],
        [0.4, 1.0],
        [0.3, 6.0],
        [0.22, 11.5],
        [0.12, 12.8],
        [0.05, 13.4],
        [0, 13.5]
      ],
      L(16, 8, 5)
    );
    const boomM = xform({ pos: [0, -2.35, 20.6], rx: 28 });
    boomG.applyMatrix4(boomM);
    A.body(boomG, 'boom');
    // ruddevators (V)
    for (const side of [1, -1]) {
      const v = liftingVee(A, side);
      v.applyMatrix4(boomM);
      A.body(v, 'boom');
    }
    A.light([0, -2.35 - Math.sin(0.4887) * 13.4, 20.6 + Math.cos(0.4887) * 13.4], [1, 0.9, 0.7], { size: 0.12, node: 'boom' });
    if (A.lod < 2) {
      const win = lathe(
        [
          [0, -1.0],
          [0.7, -0.7],
          [0.85, 0.2],
          [0.6, 0.9],
          [0, 1.1]
        ],
        L(14, 8, 4),
        { scaleY: 0.45 }
      );
      win.translate(0, -2.75, 18.2);
      A.glass(win);
    }

    navLights(A, {
      left: [-tipR.x - 0.1, tipR.y, tipR.z - 0.5],
      right: [tipR.x + 0.1, tipR.y, tipR.z - 0.5],
      tail: [0, 1.95, 28.0],
      strobes: [
        [0, 3.05, -2],
        [0, -3.3, 6]
      ],
      size: 0.18
    });
    A.gun([0, -3.0, 22]);
    A.hardpoint([-1.6, -2.9, 6]);
    A.hardpoint([1.6, -2.9, 6]);

    A.control('aileronR', (s) => -(s.roll ?? 0) * 0.3);
    A.control('aileronL', (s) => (s.roll ?? 0) * 0.3);
    A.control('flapR', (s) => (s.flaps ?? 0) * 0.5);
    A.control('flapL', (s) => (s.flaps ?? 0) * 0.5);
    A.control('elevatorR', (s) => -(s.pitch ?? 0) * 0.3);
    A.control('elevatorL', (s) => -(s.pitch ?? 0) * 0.3);
    A.control('rudder', (s) => (s.yaw ?? 0) * 0.35);
    A.control('boom', (s) => Math.sin((s.time ?? 0) * 0.7) * 0.05 + Math.sin((s.time ?? 0) * 1.9) * 0.015);
  }
};

function liftingVee(A, side) {
  // small V-tail fin on the boom (boom-local frame: along +z)
  const g = taperBox({ w0: 0.06, d0: 1.4, w1: 0.05, d1: 0.7, y0: 0, y1: 1.4, x: 0, z: 10.6, zTop: 0.4 });
  g.applyMatrix4(xform({ rz: side * 125 }));
  return g;
}

/** High-bypass turbofan nacelle along +z centred at the origin. */
function turbofan(A, r, len, straight = false) {
  const L = (a, b, c) => A.L(a, b, c);
  const seg = L(28, 14, 8);
  const h = len / 2;
  const body = [];
  const metal = [];
  const glow = [];
  body.push(
    lathe(
      [
        { r: r * 0.86, z: -h, crease: true },
        [r * 0.98, -h + 0.18],
        [r, -h + 0.8],
        [r * 0.96, 0],
        [r * (straight ? 0.9 : 0.78), h - 1.0],
        { r: r * (straight ? 0.84 : 0.7), z: h - 0.4, crease: true },
        { r: 0, z: h - 0.4 }
      ],
      seg,
      { crease: 50 }
    )
  );
  // inlet duct + fan + spinner (dark zone)
  body.push(
    lathe(
      [
        [0, -h + 0.25],
        [0.18 * r, -h + 0.45],
        [0.3 * r, -h + 0.75],
        [0.84 * r, -h + 0.8],
        [0.86 * r, -h]
      ],
      seg,
      { crease: 50, zone: 1 }
    )
  );
  // core exhaust cone + nozzle
  metal.push(
    lathe(
      [
        [r * (straight ? 0.84 : 0.7), h - 0.45],
        [r * (straight ? 0.72 : 0.56), h + 0.4],
        { r: r * (straight ? 0.66 : 0.5), z: h + 0.4, crease: true },
        [r * 0.4, h - 0.2]
      ],
      seg,
      { crease: 50 }
    )
  );
  metal.push(
    lathe(
      [
        [r * 0.34, h - 0.2],
        [r * 0.28, h + 0.6],
        [r * 0.08, h + 1.2],
        [0, h + 1.25]
      ],
      seg
    )
  );
  const gl = lathe(
    [
      [r * 0.42, h - 0.19],
      [r * 0.34, h - 0.21]
    ],
    Math.max(6, seg >> 1)
  );
  setGlow(gl, FLAME, 1);
  glow.push(gl);
  return { body, metal, glow };
}

