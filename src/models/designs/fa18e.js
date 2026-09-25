// F/A-18E-inspired strike fighter (original procedural design).
// Length ~18.3 m, span 13.6 m. Big LEX, canted twin tails, caret intakes.

import {
  loft,
  lathe,
  canopy,
  jetNozzle,
  liftingSurface,
  navLights,
  pylon,
  formationStrip,
  tipPoint,
  addPair,
  xform,
  box,
  missileStore,
  bladeAntenna,
  landingGear,
  DEG
} from './common.js';

export default {
  id: 'fa18e',
  name: 'F/A-18E SUPER HORNET',
  kind: 'fighter',
  defaultScheme: 'standard',
  livery: {
    panel: [1.4, 0.7],
    sootRange: [5.4, 8.6, 1.5],
    radomeZ: -7.35,
    antiGlare: [-7.2, -6.35, 0.4],
    tailTipY: 2.52,
    tailZ: 1.5,
    camoScale: 0.17,
    stripe: { y: 0.0, amp: 0.2, width: 0.11, z0: -8.8, z1: 6.0, period: 3.0, wingZ: 0.4, wingK: 0.3, fuseHalf: 1.5, wingXMin: 2.2 }
  },
  schemes: {
    standard: 'hornetTps',
    camo: 'desertCamo',
    special: 'blueStreak',
    lowvis: 'darkTps'
  },
  decals: [
    { tex: 'n205', center: [0, 0.0, -6.9], size: [0.8, 0.36], axis: 'x', depth: 0.8 },
    { tex: 'roundel', center: [0, 0.05, -2.7], size: [0.5, 0.5], axis: 'x', depth: 0.8, schemes: ['standard', 'camo', 'lowvis'] },
    { tex: 'tailCode2', center: [1.308, 1.35, 3.7], size: [0.95, 0.52], axis: [0.94, -0.342, 0], depth: 0.2, mirror: true },
    { tex: 'emblemHornet', center: [1.56, 2.05, 4.0], size: [0.7, 0.7], axis: [0.94, -0.342, 0], depth: 0.2, mirror: true },
    { tex: 'n205', center: [4.6, -0.02, 1.6], size: [1.0, 0.46], axis: 'y', depth: 0.3, side: 1 },
    { tex: 'roundel', center: [-4.7, -0.02, 1.6], size: [0.8, 0.8], axis: 'y', depth: 0.3, side: 1, schemes: ['standard', 'camo', 'lowvis'] },
    { tex: 'warnTri', center: [0, 0.35, -5.6], size: [0.24, 0.21], axis: 'x', depth: 0.7 },
    { tex: 'stencil', center: [0, -0.15, -4.8], size: [0.55, 0.14], axis: 'x', depth: 0.8 }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);

    // forward fuselage + centre body
    A.body(
      loft(
        [
          { z: -9.55, width: 0, height: 0, y: -0.1 },
          { z: -9.15, width: 0.36, height: 0.34, y: -0.09 },
          { z: -8.35, width: 0.72, height: 0.7, y: -0.05 },
          { z: -7.35, width: 0.98, height: 0.98, y: 0.0 },
          { z: -6.4, width: 1.1, height: 1.18, y: 0.04, shape: { nTop: 2.2, nBottom: 2.8 } },
          { z: -5.2, width: 1.18, height: 1.28, y: 0.06, shape: { nTop: 2.3, nBottom: 3.2 } },
          { z: -4.0, width: 1.28, height: 1.28, y: 0.07, shape: { nTop: 2.4, nBottom: 3.4 } },
          { z: -2.6, width: 1.5, height: 1.2, y: 0.08, shape: { nTop: 2.6, nBottom: 3.6 } },
          { z: -0.8, width: 1.9, height: 1.06, y: 0.1, shape: { nTop: 3.2, nBottom: 4 } },
          { z: 2.2, width: 2.05, height: 0.92, y: 0.12, shape: { nTop: 3.6, nBottom: 4 } },
          { z: 5.2, width: 1.5, height: 0.74, y: 0.1, shape: { nTop: 3.2, nBottom: 3.6 } },
          { z: 7.3, width: 0.72, height: 0.36, y: 0.06, shape: 3 }
        ],
        { radial: L(64, 24, 10), rings: L(100, 32, 10), noseBoost: 1.8 }
      )
    );
    // dorsal spine
    A.body(
      loft(
        [
          { z: -3.9, width: 0.56, height: 0.66, y: 0.62 },
          { z: -3.0, width: 0.72, height: 0.8, y: 0.58 },
          { z: -0.5, width: 0.86, height: 0.78, y: 0.5 },
          { z: 3.5, width: 0.72, height: 0.6, y: 0.42 },
          { z: 6.6, width: 0, height: 0, y: 0.3 }
        ],
        { radial: L(36, 14, 8), rings: L(36, 12, 4), tailBoost: 1 }
      )
    );
    // engine nacelles / intake ducts (caret intakes under the LEX)
    const nac = loft(
      [
        { z: -2.55, x: 1.08, width: 0.74, height: 0.92, y: -0.32, shape: 6, rake: 0.4, topScale: 0.92 },
        { z: -1.8, x: 1.06, width: 0.8, height: 0.96, y: -0.32, shape: 5, rake: 0.12 },
        { z: 0.5, x: 0.96, width: 0.9, height: 0.98, y: -0.3, shape: 3.6 },
        { z: 3.5, x: 0.72, width: 1.0, height: 0.98, y: -0.22, shape: 2.6 },
        { z: 5.8, x: 0.64, width: 0.98, height: 0.96, y: -0.14, shape: 2.2 },
        { z: 7.0, x: 0.62, width: 0.94, height: 0.94, y: -0.12, shape: 2.0 }
      ],
      { radial: L(44, 18, 8), rings: L(56, 16, 5), capStart: { lip: 0.05, depth: 1.4 }, capEnd: 'flat' }
    );
    addPair(A, 'body', nac);

    // LEX
    liftingSurface(A, {
      origin: [0.35, 0.3, -6.1],
      planform: [
        { x: 0, zLE: 0, chord: 7.2, t: 0.034 },
        { x: 0.55, zLE: 1.2, chord: 6.2, t: 0.036 },
        { x: 1.1, zLE: 3.3, chord: 4.3, t: 0.04 },
        { x: 1.62, zLE: 5.55, chord: 2.1, t: 0.05 }
      ],
      chordSegments: L(22, 9, 4),
      spanSegments: L(6, 3, 1),
      sharpLE: true,
      mirror: true
    });

    // wings
    const wingO = {
      origin: [0.95, 0.1, -0.75],
      rootChord: 4.75,
      tipChord: 1.75,
      span: 5.75,
      sweepDeg: 26,
      dihedralDeg: -3,
      thicknessRatio: 0.052,
      tipThicknessRatio: 0.04,
      twistDeg: -2,
      chordSegments: L(24, 9, 4),
      spanSegments: L(14, 5, 1),
      mirror: true
    };
    liftingSurface(A, wingO, [
      { name: 'flap', span: [0.06, 0.52], chord: 0.7 },
      { name: 'aileron', span: [0.56, 0.94], chord: 0.74 }
    ]);
    // wingtip missile rails
    const tipR = tipPoint(wingO, 1, 0.3);
    const rail = lathe(
      [
        [0, -1.35],
        [0.05, -1.2],
        [0.065, -0.9],
        [0.065, 1.2],
        [0.04, 1.5],
        [0, 1.55]
      ],
      L(10, 6, 4)
    );
    rail.translate(tipR.x + 0.04, tipR.y - 0.04, tipR.z + 0.35);
    addPair(A, 'body', rail);
    A.wingtip([-tipR.x - 0.05, tipR.y, tipR.z + 1.4]);
    A.wingtip([tipR.x + 0.05, tipR.y, tipR.z + 1.4]);

    // canted twin tails (20 deg outboard)
    liftingSurface(
      A,
      {
        origin: [0, 0, 0],
        matrix: xform({ pos: [0.98, 0.45, 1.95], rz: 70 }),
        rootChord: 3.45,
        tipChord: 1.25,
        span: 2.75,
        sweepDeg: 37,
        thicknessRatio: 0.05,
        tipThicknessRatio: 0.04,
        chordSegments: L(18, 8, 3),
        spanSegments: L(9, 3, 1),
        mirror: true
      },
      [{ name: 'rudder', span: [0.06, 0.58], chord: 0.68 }],
      { prefer: 'y' }
    );

    // stabilators
    A.node('stabR', [1.3, -0.1, 6.2], { axis: [1, 0, 0] });
    A.node('stabL', [-1.3, -0.1, 6.2], { axis: [1, 0, 0] });
    liftingSurface(
      A,
      {
        origin: [0.95, -0.1, 5.0],
        rootChord: 2.95,
        tipChord: 1.1,
        span: 2.55,
        sweepDeg: 42,
        dihedralDeg: -2,
        thicknessRatio: 0.045,
        tipThicknessRatio: 0.04,
        chordSegments: L(16, 7, 3),
        spanSegments: L(8, 3, 1),
        rootCap: true,
        mirror: true
      },
      [],
      { node: 'stabR', nodeL: 'stabL' }
    );

    jetNozzle(A, { x: 0.62, y: -0.12, z0: 6.85, z1: 8.2, rBase: 0.49, rExit: 0.44, rThroat: 0.35 });

    canopy(
      A,
      [
        { z: -7.0, width: 0.38, height: 0.1, y: 0.56 },
        { z: -6.45, width: 0.8, height: 0.56, y: 0.6 },
        { z: -5.75, width: 0.86, height: 0.96, y: 0.63 },
        { z: -4.8, width: 0.88, height: 1.06, y: 0.63 },
        { z: -4.0, width: 0.8, height: 0.9, y: 0.62 },
        { z: -3.45, width: 0.56, height: 0.56, y: 0.6 }
      ],
      { frames: [-6.42], shape: 2.3 }
    );

    // details
    if (A.lod < 2)
    A.metal(
      lathe(
        [
          [0, -9.95],
          [0.015, -9.85],
          [0.02, -9.5],
          [0.04, -9.4]
        ],
        L(8, 5, 3)
      )
    );
    A.body(box(0.09, 0.03, 0.2, { pos: [0, 0.315, -8.25], zone: 1 }));
    A.gun([0, 0.5, -8.5]);
    // refuelling probe fairing (right side)
    if (A.lod < 2) {
      const probe = lathe(
        [
          [0, -1.2],
          [0.06, -1.0],
          [0.09, -0.4],
          [0.09, 0.8],
          [0, 1.2]
        ],
        L(10, 6, 4)
      );
      probe.translate(0.46, 0.42, -6.9);
      A.body(probe);
    }
    // pylons
    for (const x of [2.9, 4.35]) pylon(A, { x, y: 0.1 - Math.tan(3 * DEG) * (x - 0.95) - 0.03, z: 0.9, len: 2.0, h: 0.4 });
    pylon(A, { x: 0, y: -0.64, z: 0.8, len: 2.4, h: 0.22, mirror: false });
    let si = 0;
    for (const [hp, type] of [
      [[4.35, -0.59, 0.75], 'aim9'],
      [[2.9, -0.54, 0.75], 'aim120'],
      [[1.1, -0.9, -1.2], 'aim120']
    ]) {
      for (const s of [-1, 1]) {
        const p = [hp[0] * s, hp[1], hp[2]];
        A.hardpoint(p);
        missileStore(A, p, { type, node: `store${si++}` });
      }
    }
    // wingtip Sidewinders on the rails
    missileStore(A, [-(tipR.x + 0.04), tipR.y - 0.17, tipR.z + 0.25], { type: 'aim9', node: 'storeTipL' });
    missileStore(A, [tipR.x + 0.04, tipR.y - 0.17, tipR.z + 0.25], { type: 'aim9', node: 'storeTipR' });
    navLights(A, {
      left: [-tipR.x - 0.05, tipR.y + 0.05, tipR.z - 0.85],
      right: [tipR.x + 0.05, tipR.y + 0.05, tipR.z - 0.85],
      tail: [0, 0.1, 7.35],
      strobes: [
        [0, 0.95, 2.0],
        [0, -0.62, 3.0]
      ]
    });
    bladeAntenna(A, [0, 0.9, -1.2]);
    bladeAntenna(A, [0, -0.52, -3.2], { down: true, h: 0.16 });
    if (A.lod === 0) {
      formationStrip(A, [0.62, 0.05, -5.4], 0.45);
      formationStrip(A, [1.29, 1.2, 3.4], 0.45, { rz: -20 });
    }

    landingGear(A, {
      ground: -2.1,
      navy: true,
      nose: { hinge: [0, -0.32, -6.2], axleZ: -6.02, tireR: 0.28, tireW: 0.17, twin: 0.18, strutR: 0.085, stow: 90, well: { y: -0.575, width: 0.4, z0: -6.9, z1: -5.95 } },
      main: {
        hinge: [1.2, -0.45, 0.85],
        axle: [1.6, 1.0],
        tireR: 0.39,
        tireW: 0.26,
        strutR: 0.115,
        stow: -90,
        brace: [1.1, -0.5, 1.8],
        well: { x0: 0.85, x1: 1.25, y: -0.8, z0: 0.2, z1: 1.55 }
      }
    });

    A.control('aileronR', (s) => -(s.roll ?? 0) * 0.4);
    A.control('aileronL', (s) => (s.roll ?? 0) * 0.4);
    const flap = (s) => (s.flaps ?? 0) * 0.6;
    A.control('flapR', flap);
    A.control('flapL', flap);
    A.control('stabR', (s) => -(s.pitch ?? 0) * 0.35 - (s.roll ?? 0) * 0.12);
    A.control('stabL', (s) => -(s.pitch ?? 0) * 0.35 + (s.roll ?? 0) * 0.12);
    A.control('rudderR', (s) => (s.yaw ?? 0) * 0.5);
    A.control('rudderL', (s) => (s.yaw ?? 0) * 0.5);
  }
};

