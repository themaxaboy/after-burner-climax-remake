// Enemy fighter "B": Su-57-inspired 5th-generation stealth fighter
// (original procedural design). Blended chined body, widely spaced engines,
// LEVCONs, all-moving canted fins, vectoring nozzles. Length ~20 m, span 14 m.

import { loft, lathe, canopy, jetNozzle, liftingSurface, navLights, tipPoint, addPair, xform, DEG, smooth } from './common.js';
import { polyProfile } from '../loft.js';

// chined sections (sharp lateral edge slightly below the centreline)
const CHINE = polyProfile([
  [0, -1],
  [0.62, -0.9],
  [1, -0.3],
  [0.74, 0.3],
  [0.38, 0.82],
  [0, 1]
]);
const LENS = polyProfile([
  [0, -1],
  [0.55, -0.82],
  [1, -0.1],
  [0.6, 0.62],
  [0, 1]
]);

export default {
  id: 'stealthB',
  name: 'Fighter B (stealth)',
  kind: 'fighter',
  defaultScheme: 'enemy',
  livery: {
    panel: [1.8, 0.9],
    groove: 0.004,
    sootRange: [6.6, 10.2, 1.9],
    radomeZ: null,
    camoScale: 0.14
  },
  schemes: { enemy: 'enemyStealth', desert: 'enemyDesert' },
  decals: [
    { tex: 'n33', center: [0, 0.1, -7.3], size: [0.8, 0.38], axis: 'x', depth: 0.9 },
    { tex: 'emblemEnemy', center: [2.18, 1.55, 6.6], size: [0.75, 0.75], axis: [0.899, -0.438, 0], depth: 0.25, mirror: true },
    { tex: 'emblemEnemy', center: [4.6, 0.12, 2.8], size: [1.0, 1.0], axis: 'y', depth: 0.3, side: 1, mirror: true }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    // chined forebody + spine
    A.body(
      loft(
        [
          { z: -10.0, width: 0, height: 0, y: -0.05, shape: CHINE },
          { z: -9.45, width: 0.62, height: 0.34, y: -0.05, shape: CHINE },
          { z: -8.4, width: 1.14, height: 0.66, y: -0.02, shape: CHINE },
          { z: -7.0, width: 1.46, height: 0.94, y: 0.04, shape: CHINE },
          { z: -5.6, width: 1.6, height: 1.1, y: 0.1, shape: CHINE },
          { z: -4.0, width: 1.74, height: 1.08, y: 0.12, shape: CHINE },
          { z: -2.0, width: 2.0, height: 0.92, y: 0.14, shape: CHINE },
          { z: 2.0, width: 1.9, height: 0.78, y: 0.16, shape: CHINE },
          { z: 6.0, width: 1.4, height: 0.6, y: 0.14, shape: CHINE },
          { z: 8.4, width: 0.8, height: 0.4, y: 0.1, shape: CHINE }
        ],
        { radial: L(64, 24, 12), rings: L(100, 30, 10), noseBoost: 1.6, crease: 30 }
      )
    );
    // wide blended centre body
    A.body(
      loft(
        [
          { z: -4.6, width: 1.9, height: 0.4, y: 0.0, shape: LENS },
          { z: -2.4, width: 3.9, height: 0.62, y: 0.02, shape: LENS },
          { z: 1.5, width: 4.4, height: 0.66, y: 0.04, shape: LENS },
          { z: 5.5, width: 3.9, height: 0.56, y: 0.04, shape: LENS },
          { z: 8.2, width: 2.6, height: 0.36, y: 0.02, shape: LENS },
          { z: 9.2, width: 1.4, height: 0.14, y: 0.0, shape: LENS }
        ],
        { radial: L(56, 22, 10), rings: L(56, 16, 6), crease: 30 }
      )
    );
    // engine nacelles with caret intakes
    const nac = loft(
      [
        { z: -3.7, x: 1.28, width: 0.86, height: 0.84, y: -0.42, shape: 7, rake: 0.55, topScale: 0.8 },
        { z: -2.9, x: 1.28, width: 0.92, height: 0.86, y: -0.42, shape: 5.5, rake: 0.15, topScale: 0.85 },
        { z: 0.5, x: 1.28, width: 1.02, height: 0.9, y: -0.4, shape: 3.5 },
        { z: 4.5, x: 1.26, width: 1.08, height: 0.98, y: -0.34, shape: 2.4 },
        { z: 7.7, x: 1.25, width: 1.0, height: 0.96, y: -0.3, shape: 2 }
      ],
      { radial: L(44, 18, 8), rings: L(52, 14, 5), capStart: { lip: 0.05, depth: 1.5 }, capEnd: 'flat', crease: 32 }
    );
    addPair(A, 'body', nac);
    // stinger tail cone between the nozzles
    A.body(
      lathe(
        [
          [0.3, 7.6],
          [0.34, 8.4],
          [0.26, 9.4],
          [0.12, 10.0],
          [0, 10.12]
        ],
        L(20, 10, 6),
        { center: [0, 0.06] }
      )
    );

    // LEVCONs (movable LE root extensions)
    A.hinge('levconR', [0.95, 0.1, -2.25], [2.25, 0.1, -1.55], { prefer: 'x' });
    A.hinge('levconL', [-0.95, 0.1, -2.25], [-2.25, 0.1, -1.55], { prefer: 'x' });
    liftingSurface(
      A,
      {
        origin: [0.95, 0.1, -4.6],
        planform: [
          { x: 0, zLE: 0, chord: 2.4, t: 0.03 },
          { x: 1.3, zLE: 2.2, chord: 0.9, t: 0.03 }
        ],
        chordSegments: L(10, 5, 3),
        spanSegments: L(4, 2, 1),
        sharpLE: true,
        rootCap: true,
        mirror: true
      },
      [],
      { node: 'levconR', nodeL: 'levconL' }
    );

    const wingO = {
      origin: [1.9, 0.1, -2.1],
      planform: [
        { x: 0, zLE: 0, chord: 5.6, t: 0.042 },
        { x: 5.15, zLE: 5.75, chord: 1.35, t: 0.032 }
      ],
      dihedralDeg: -2,
      chordSegments: L(24, 9, 4),
      spanSegments: L(14, 5, 1),
      sharpLE: true,
      mirror: true
    };
    liftingSurface(A, wingO, [
      { name: 'flap', span: [0.06, 0.52], chord: 0.8 },
      { name: 'aileron', span: [0.56, 0.93], chord: 0.76 }
    ]);
    const tipR = tipPoint(wingO, 1, 0.5);
    A.wingtip([-tipR.x, tipR.y, tipR.z + 0.4]);
    A.wingtip([tipR.x, tipR.y, tipR.z + 0.4]);

    // all-moving canted fins (26 deg)
    const finO = {
      origin: [0, 0, 0],
      rootChord: 3.1,
      tipChord: 1.2,
      span: 2.55,
      sweepDeg: 45,
      thicknessRatio: 0.04,
      chordSegments: L(16, 7, 3),
      spanSegments: L(7, 3, 1),
      sharpLE: true,
      rootCap: true
    };
    const finM = xform({ pos: [1.6, 0.3, 5.25], rz: 64 });
    const hingeA = tipPoint({ ...finO, matrix: finM }, 0, 0.4);
    const hingeB = tipPoint({ ...finO, matrix: finM }, 1, 0.4);
    A.hinge('rudderR', hingeA, hingeB, { prefer: 'y' });
    A.hinge('rudderL', [-hingeA.x, hingeA.y, hingeA.z], [-hingeB.x, hingeB.y, hingeB.z], { prefer: 'y' });
    liftingSurface(A, { ...finO, matrix: finM, mirror: true }, [], { node: 'rudderR', nodeL: 'rudderL' });

    // tail booms + stabilators
    const boom = loft(
      [
        { z: 3.8, x: 2.05, width: 0.2, height: 0.16, y: 0.0, shape: 3 },
        { z: 5.5, x: 2.05, width: 0.5, height: 0.34, y: 0.0, shape: 3 },
        { z: 8.9, x: 2.05, width: 0.44, height: 0.3, y: 0.0, shape: 3 },
        { z: 9.7, x: 2.05, width: 0.08, height: 0.08, y: 0.0, shape: 3 }
      ],
      { radial: L(20, 10, 6), rings: L(20, 8, 3) }
    );
    addPair(A, 'body', boom);
    A.node('stabR', [2.6, 0.0, 7.75], { axis: [1, 0, 0] });
    A.node('stabL', [-2.6, 0.0, 7.75], { axis: [1, 0, 0] });
    liftingSurface(
      A,
      {
        origin: [2.15, 0.0, 6.4],
        planform: [
          { x: 0, zLE: 0, chord: 3.2, t: 0.04 },
          { x: 2.55, zLE: 2.55, chord: 1.3, t: 0.035 }
        ],
        chordSegments: L(14, 6, 3),
        spanSegments: L(7, 3, 1),
        sharpLE: true,
        rootCap: true,
        mirror: true
      },
      [],
      { node: 'stabR', nodeL: 'stabL' }
    );

    // thrust-vectoring nozzles on pivots
    A.node('nozzleR', [1.25, -0.3, 7.7], { axis: [1, 0, 0] });
    A.node('nozzleL', [-1.25, -0.3, 7.7], { axis: [1, 0, 0] });
    jetNozzle(A, { x: 1.25, y: -0.3, z0: 7.55, z1: 8.95, rBase: 0.48, rExit: 0.46, rThroat: 0.36, node: 'nozzleR', nodeL: 'nozzleL' });

    canopy(
      A,
      [
        { z: -7.2, width: 0.36, height: 0.1, y: 0.48 },
        { z: -6.6, width: 0.8, height: 0.56, y: 0.52 },
        { z: -5.7, width: 0.92, height: 1.04, y: 0.56 },
        { z: -4.7, width: 0.9, height: 1.06, y: 0.58 },
        { z: -3.8, width: 0.74, height: 0.8, y: 0.58 },
        { z: -3.2, width: 0.44, height: 0.42, y: 0.58 }
      ],
      { frames: [], shape: 2.2 }
    );
    // IRST ball
    if (A.lod < 2) {
      const irst = lathe(
        [
          [0, -0.2],
          [0.13, -0.1],
          [0.14, 0.05],
          [0, 0.2]
        ],
        L(12, 8, 4),
        { zone: 9 }
      );
      irst.translate(0.2, 0.52, -7.3);
      A.body(irst);
    }
    A.gun([0.9, 0.2, -3.2]);
    for (const hp of [
      [0.6, -0.55, -0.5],
      [0.6, -0.55, 2.5],
      [2.3, -0.2, 0.5]
    ]) {
      A.hardpoint([-hp[0], hp[1], hp[2]]);
      A.hardpoint(hp);
    }
    navLights(A, {
      left: [-tipR.x - 0.02, tipR.y, tipR.z - 0.2],
      right: [tipR.x + 0.02, tipR.y, tipR.z - 0.2],
      tail: [0, 0.06, 10.1]
    });

    A.control('aileronR', (s) => -(s.roll ?? 0) * 0.4);
    A.control('aileronL', (s) => (s.roll ?? 0) * 0.4);
    A.control('flapR', (s) => (s.flaps ?? 0) * 0.5);
    A.control('flapL', (s) => (s.flaps ?? 0) * 0.5);
    A.control('stabR', (s) => -(s.pitch ?? 0) * 0.35 - (s.roll ?? 0) * 0.15);
    A.control('stabL', (s) => -(s.pitch ?? 0) * 0.35 + (s.roll ?? 0) * 0.15);
    A.control('rudderR', (s) => (s.yaw ?? 0) * 0.3);
    A.control('rudderL', (s) => (s.yaw ?? 0) * 0.3);
    const lev = (s) => -(smooth(0, 1, Math.max(s.pitch ?? 0, 0)) * 0.3 + (1 - (s.speed01 ?? 0)) * 0.06);
    A.control('levconR', lev);
    A.control('levconL', lev);
    A.control('nozzleR', (s) => (s.pitch ?? 0) * 15 * DEG);
    A.control('nozzleL', (s) => (s.pitch ?? 0) * 15 * DEG);
  }
};
