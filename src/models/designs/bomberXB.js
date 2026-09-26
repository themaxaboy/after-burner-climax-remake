// Enemy bomber "XB": XB-70-inspired Mach 3 delta bomber (original procedural
// design). Long needle fuselage, canards, cranked delta with folding tips that
// droop with speed, six-engine box, twin all-moving fins. Length ~56 m, span 32 m.

import { loft, canopy, jetNozzle, liftingSurface, navLights, tipPoint, addPair, taperBox, xform, smooth, DEG } from './common.js';
import { wingPoint } from '../airfoil.js';

export default {
  id: 'bomberXB',
  name: 'Bomber XB (Mach 3 delta)',
  kind: 'bomber',
  defaultScheme: 'enemy',
  livery: {
    panel: [2.6, 1.2],
    groove: 0.008,
    sootRange: [21, 27.5, 5],
    radomeZ: -26.2,
    antiGlare: [-24.5, -21.6, 0.7],
    camoScale: 0.07
  },
  schemes: {
    // gunmetal with red-orange fin tops and wing tips
    enemy: {
      preset: 'enemyBomberDark',
      tailTipY: 3.3,
      tailZ: 18,
      stripe: { a: '#ff5a1c', b: '#a3210f', y: 0, amp: 0, width: 0.1, z0: 1e4, z1: 1e4, period: 3, sideMin: 0.5, wingZ: 21, wingK: 0, wingWidth: 4.5, wingXMin: 12.5 }
    },
    white: 'enemyWhite',
    desert: 'enemyDesert'
  },
  decals: [
    { tex: 'n88', center: [0, 0.3, -17.5], size: [2.2, 1.0], axis: 'x', depth: 1.6 },
    { tex: 'emblemEnemy', center: [3.2, 3.4, 21.5], size: [2.2, 2.2], axis: 'x', depth: 0.4, mirror: true },
    { tex: 'emblemEnemy', center: [9.5, 0.2, 14.0], size: [3.2, 3.2], axis: 'y', depth: 0.6, side: 1, mirror: true }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    A.meta.bomber = true;
    // needle fuselage
    A.body(
      loft(
        [
          { z: -28.2, width: 0, height: 0, y: 0.1 },
          { z: -27.0, width: 0.72, height: 0.7, y: 0.15 },
          { z: -24.0, width: 1.7, height: 1.66, y: 0.3 },
          { z: -20.5, width: 2.3, height: 2.4, y: 0.45, shape: { nTop: 2.2, nBottom: 2.6 } },
          { z: -16.0, width: 2.6, height: 2.6, y: 0.55, shape: { nTop: 2.3, nBottom: 2.8 } },
          { z: -8.0, width: 2.8, height: 2.6, y: 0.6, shape: { nTop: 2.3, nBottom: 3 } },
          { z: 2.0, width: 2.8, height: 2.4, y: 0.7, shape: { nTop: 2.3, nBottom: 3 } },
          { z: 12.0, width: 2.5, height: 2.1, y: 0.8, shape: 2.4 },
          { z: 21.0, width: 1.8, height: 1.5, y: 0.9, shape: 2.2 },
          { z: 26.5, width: 0.7, height: 0.6, y: 1.0 },
          { z: 27.9, width: 0, height: 0, y: 1.02 }
        ],
        { radial: L(56, 22, 10), rings: L(120, 36, 12), noseBoost: 1.5, tailBoost: 1.2 }
      )
    );
    // flush windscreen ramp
    canopy(
      A,
      [
        { z: -23.4, width: 0.8, height: 0.3, y: 1.0 },
        { z: -22.2, width: 1.5, height: 1.2, y: 1.05 },
        { z: -20.6, width: 1.7, height: 1.55, y: 1.08 },
        { z: -19.4, width: 1.5, height: 1.2, y: 1.1 },
        { z: -18.4, width: 0.9, height: 0.6, y: 1.12 }
      ],
      { frames: [-21.6, -20.2], shape: 2.2, frameWidth: 0.12 }
    );
    // dorsal fairing to the fins
    A.body(
      loft(
        [
          { z: -18.8, width: 0, height: 0, y: 1.4 },
          { z: -16.0, width: 1.2, height: 0.9, y: 1.55 },
          { z: 5.0, width: 1.5, height: 1.1, y: 1.6 },
          { z: 22.0, width: 1.0, height: 0.8, y: 1.5 },
          { z: 25.5, width: 0, height: 0, y: 1.4 }
        ],
        { radial: L(28, 12, 6), rings: L(40, 14, 5) }
      )
    );

    // canards (all-moving)
    const canO = {
      origin: [1.05, 0.95, -16.2],
      rootChord: 5.2,
      tipChord: 2.1,
      span: 3.3,
      sweepDeg: 31,
      dihedralDeg: 0,
      thicknessRatio: 0.035,
      chordSegments: L(16, 7, 3),
      spanSegments: L(6, 2, 1),
      rootCap: true,
      mirror: true
    };
    A.node('canardR', [1.6, 0.95, -13.8], { axis: [1, 0, 0] });
    A.node('canardL', [-1.6, 0.95, -13.8], { axis: [1, 0, 0] });
    liftingSurface(A, canO, [], { node: 'canardR', nodeL: 'canardL' });

    // cranked delta: fixed inner wing + folding tips
    const pf = [
      { x: 0, zLE: 0, chord: 31.0, t: 0.026 },
      { x: 7.9, zLE: 16.2, chord: 14.8, t: 0.024 },
      { x: 14.7, zLE: 29.9, chord: 1.1, t: 0.03 }
    ];
    const wingO = { origin: [1.3, 0.0, -6.0], planform: pf, chordSegments: L(28, 10, 4), sharpLE: true, mirror: true };
    const sFold = 7.9 / 14.7;
    liftingSurface(A, { ...wingO, spanRange: [0, sFold], spanSegments: L(14, 5, 1), tipCap: false }, [
      { name: 'elevon', span: [0.12, 0.5], chord: 0.88 }
    ]);
    const fa = wingPoint(wingO, sFold, 0.02, 0);
    const fb = wingPoint(wingO, sFold, 0.98, 0);
    A.hinge('wingtipR', fa, fb, { prefer: 'z' });
    A.hinge('wingtipL', [-fa.x, fa.y, fa.z], [-fb.x, fb.y, fb.z], { prefer: 'z' });
    liftingSurface(A, { ...wingO, spanRange: [sFold + 0.002, 1], spanSegments: L(12, 4, 1), rootCap: true }, [], {
      node: 'wingtipR',
      nodeL: 'wingtipL'
    });
    const tipR = tipPoint(wingO, 1, 0.6);
    A.wingtip([-tipR.x, tipR.y, tipR.z], 'wingtipL');
    A.wingtip([tipR.x, tipR.y, tipR.z], 'wingtipR');

    // six-engine box with split intakes
    const box = loft(
      [
        { z: 1.5, x: 2.25, width: 3.9, height: 1.9, y: -1.0, shape: 8, rake: -0.9 },
        { z: 3.0, x: 2.25, width: 4.1, height: 2.1, y: -1.05, shape: 7, rake: -0.2 },
        { z: 12.0, x: 2.25, width: 4.3, height: 2.3, y: -1.15, shape: 6 },
        { z: 24.0, x: 2.25, width: 4.3, height: 2.1, y: -1.1, shape: 6 },
        { z: 25.4, x: 2.25, width: 4.3, height: 1.9, y: -1.05, shape: 6 }
      ],
      { radial: L(40, 16, 8), rings: L(40, 12, 5), capStart: { lip: 0.08, depth: 3.0 }, capEnd: 'flat' }
    );
    addPair(A, 'body', box);
    A.body(
      taperBox({ w0: 0.2, d0: 5.0, w1: 0.2, d1: 3.0, y0: -2.1, y1: -0.1, x: 0, z: 3.5, zTop: 0.9 })
    );
    for (const x of [0.75, 2.25, 3.75]) {
      jetNozzle(A, { x, y: -1.15, z0: 24.9, z1: 26.4, rBase: 0.68, rExit: 0.64, rThroat: 0.5, seg: 20 });
    }

    // twin all-moving fins
    const finO = {
      origin: [0, 0, 0],
      rootChord: 7.8,
      tipChord: 3.0,
      span: 4.6,
      sweepDeg: 50,
      thicknessRatio: 0.04,
      chordSegments: L(14, 6, 3),
      spanSegments: L(5, 2, 1),
      sharpLE: true,
      rootCap: true
    };
    const fM = xform({ pos: [3.0, 0.3, 17.2], rz: 90 });
    const ha = tipPoint({ ...finO, matrix: fM }, 0, 0.45);
    const hb = tipPoint({ ...finO, matrix: fM }, 1, 0.45);
    A.hinge('finR', ha, hb, { prefer: 'y' });
    A.hinge('finL', [-ha.x, ha.y, ha.z], [-hb.x, hb.y, hb.z], { prefer: 'y' });
    liftingSurface(A, { ...finO, matrix: fM, mirror: true }, [], { node: 'finR', nodeL: 'finL' });

    navLights(A, {
      left: [-tipR.x, tipR.y, tipR.z - 0.3],
      right: [tipR.x, tipR.y, tipR.z - 0.3],
      leftNode: 'wingtipL',
      rightNode: 'wingtipR',
      tail: [0, 1.02, 28.0],
      strobes: [
        [0, 2.2, 0],
        [0, -2.3, 12]
      ],
      size: 0.14
    });
    A.gun([0, -0.9, -24]);
    A.hardpoint([-1.2, -2.2, 8]);
    A.hardpoint([1.2, -2.2, 8]);
    const droop = (s) => 65 * DEG * smooth(0.35, 0.9, s.speed01 ?? 0);
    A.control('wingtipR', (s) => -droop(s));
    A.control('wingtipL', (s) => droop(s));
    A.control('canardR', (s) => (s.pitch ?? 0) * 0.25);
    A.control('canardL', (s) => (s.pitch ?? 0) * 0.25);
    A.control('elevonR', (s) => -(s.pitch ?? 0) * 0.3 - (s.roll ?? 0) * 0.3);
    A.control('elevonL', (s) => -(s.pitch ?? 0) * 0.3 + (s.roll ?? 0) * 0.3);
    A.control('finR', (s) => (s.yaw ?? 0) * 0.3);
    A.control('finL', (s) => (s.yaw ?? 0) * 0.3);
  }
};
