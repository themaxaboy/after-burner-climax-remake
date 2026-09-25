// F-14D-inspired variable-sweep interceptor (original procedural design).
// Nose -Z, +Y up, +X right wing. Length ~19.1 m, span 19.5 m (20 deg) / 11.6 m (68 deg).

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
  setZone,
  smooth,
  missileStore,
  bladeAntenna,
  landingGear,
  DEG
} from './common.js';

const SWEEP_MIN = 20;
const SWEEP_MAX = 68;

export default {
  id: 'f14d',
  name: 'F-14D SUPER TOMCAT',
  kind: 'fighter',
  defaultScheme: 'standard',
  livery: {
    panel: [1.5, 0.75],
    sootRange: [5.2, 9.2, 2.6],
    radomeZ: -8.65,
    antiGlare: [-8.4, -6.9, 0.45],
    tailTipY: 2.58,
    camoScale: 0.16,
    stripe: { y: 0.1, amp: 0.22, width: 0.12, z0: -9.5, z1: 7.5, period: 3.2, wingZ: 0.6, wingK: 0.36 }
  },
  schemes: {
    standard: 'navyGull',
    camo: 'navyCamo',
    special: 'vandyBlack',
    lowvis: 'navyTps'
  },
  decals: [
    { tex: 'n100', center: [0, 0.02, -7.55], size: [0.9, 0.4], axis: 'x', depth: 0.9 },
    { tex: 'roundel', center: [0, 0.02, 1.4], size: [0.62, 0.62], axis: 'x', depth: 1.25, schemes: ['standard', 'camo', 'lowvis'] },
    { tex: 'tailCode', center: [1.69, 1.3, 5.9], size: [1.1, 0.6], axis: [0.996, -0.087, 0], depth: 0.2, mirror: true },
    { tex: 'emblemBolt', center: [1.755, 2.05, 6.3], size: [0.8, 0.8], axis: [0.996, -0.087, 0], depth: 0.2, mirror: true, schemes: ['special', 'standard'] },
    { tex: 'n100', center: [5.6, 0.4, 2.1], size: [1.2, 0.54], axis: 'y', depth: 0.35, side: 1 },
    { tex: 'roundel', center: [-5.9, 0.42, 2.05], size: [0.95, 0.95], axis: 'y', depth: 0.35, side: 1, schemes: ['standard', 'camo', 'lowvis'] },
    { tex: 'warnTri', center: [0, 0.55, -5.2], size: [0.26, 0.23], axis: 'x', depth: 0.8 },
    { tex: 'rescue', center: [0, 0.5, -3.0], size: [0.55, 0.22], axis: 'x', depth: 1.0, notSchemes: ['lowvis'] }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);

    // ---- forward fuselage + spine ------------------------------------
    A.body(
      loft(
        [
          { z: -10.45, width: 0, height: 0, y: -0.02 },
          { z: -10.05, width: 0.44, height: 0.42, y: -0.02 },
          { z: -9.4, width: 0.82, height: 0.78, y: 0.0 },
          { z: -8.65, width: 1.06, height: 1.02, y: 0.02 },
          { z: -7.7, width: 1.24, height: 1.24, y: 0.07, shape: { nTop: 2.2, nBottom: 2.5 } },
          { z: -6.7, width: 1.34, height: 1.42, y: 0.1, shape: { nTop: 2.3, nBottom: 2.9 } },
          { z: -5.4, width: 1.38, height: 1.5, y: 0.12, shape: { nTop: 2.4, nBottom: 3.2 } },
          { z: -4.0, width: 1.46, height: 1.5, y: 0.12, shape: { nTop: 2.5, nBottom: 3.4 } },
          { z: -2.8, width: 1.62, height: 1.44, y: 0.13, shape: { nTop: 2.7, nBottom: 3.6 } },
          { z: -1.4, width: 1.98, height: 1.28, y: 0.17, shape: { nTop: 3.0, nBottom: 3.8 } },
          { z: 0.4, width: 2.3, height: 1.1, y: 0.22, shape: { nTop: 3.4, nBottom: 4 } },
          { z: 3.0, width: 2.2, height: 0.98, y: 0.22, shape: { nTop: 3.4, nBottom: 4 } },
          { z: 5.4, width: 1.7, height: 0.8, y: 0.18, shape: { nTop: 3, nBottom: 4 } },
          { z: 7.3, width: 1.05, height: 0.5, y: 0.12, shape: 3 },
          { z: 8.3, width: 0.6, height: 0.24, y: 0.08, shape: 3 }
        ],
        { radial: L(64, 24, 10), rings: L(110, 34, 10), noseBoost: 1.8 }
      )
    );
    // turtledeck spine behind the canopy
    A.body(
      loft(
        [
          { z: -3.3, width: 0.66, height: 0.86, y: 0.84 },
          { z: -2.2, width: 0.86, height: 1.0, y: 0.73 },
          { z: 0.2, width: 0.98, height: 0.9, y: 0.62 },
          { z: 3.2, width: 0.9, height: 0.7, y: 0.55 },
          { z: 6.2, width: 0.56, height: 0.46, y: 0.45 },
          { z: 7.8, width: 0, height: 0, y: 0.38 }
        ],
        { radial: L(40, 16, 8), rings: L(44, 14, 5), shape: 2.2, tailBoost: 1 }
      )
    );

    // ---- centre "pancake" + beaver tail ----------------------------------
    A.body(
      loft(
        [
          { z: -3.6, width: 1.9, height: 0.46, y: 0.06, shape: 4 },
          { z: -1.2, width: 3.2, height: 0.78, y: 0.05, shape: { nTop: 5, nBottom: 6 } },
          { z: 3.0, width: 3.5, height: 0.8, y: 0.05, shape: { nTop: 5, nBottom: 6 } },
          { z: 6.0, width: 3.15, height: 0.62, y: 0.03, shape: { nTop: 5, nBottom: 6 } },
          { z: 7.7, width: 2.2, height: 0.3, y: 0.0, shape: 5 },
          { z: 9.05, width: 1.2, height: 0.09, y: 0.0, shape: 6 }
        ],
        { radial: L(48, 20, 10), rings: L(56, 16, 6) }
      )
    );

    // ---- engine nacelles with raked rectangular intakes -------------------
    const nacelle = loft(
      [
        { z: -4.05, x: 1.52, width: 0.95, height: 1.38, y: -0.15, shape: 7, rake: -0.42 },
        { z: -3.3, x: 1.55, width: 1.02, height: 1.42, y: -0.16, shape: 5.5, rake: -0.12 },
        { z: -1.0, x: 1.58, width: 1.14, height: 1.36, y: -0.2, shape: 3.6 },
        { z: 2.0, x: 1.6, width: 1.24, height: 1.28, y: -0.22, shape: 2.6 },
        { z: 5.0, x: 1.6, width: 1.2, height: 1.18, y: -0.2, shape: 2.2 },
        { z: 7.15, x: 1.6, width: 1.05, height: 1.04, y: -0.18, shape: 2.0 }
      ],
      { radial: L(48, 20, 8), rings: L(64, 18, 5), capStart: { lip: 0.06, depth: 1.7 }, capEnd: 'flat' }
    );
    addPair(A, 'body', nacelle);

    // intake splitter plates (boundary-layer gap between fuselage and intake)
    if (A.lod < 2) {
      const sp = box(0.03, 1.2, 1.2, { pos: [0.98, -0.12, -3.5] });
      addPair(A, 'body', sp);
    }

    // ---- glove (fixed) ------------------------------------------------------
    liftingSurface(A, {
      origin: [1.1, 0.3, -3.95],
      planform: [
        { x: 0, zLE: 0, chord: 9.3, t: 0.042 },
        { x: 1.2, zLE: 2.72, chord: 6.1, t: 0.055 },
        { x: 1.95, zLE: 4.35, chord: 3.45, t: 0.09 }
      ],
      chordSegments: L(26, 10, 4),
      spanSegments: L(6, 2, 1),
      sharpLE: true,
      mirror: true
    });

    // ---- variable-sweep outer wings on pivots ----------------------------
    const pivot = [2.72, 0.3, 0.72];
    A.node('wingR', pivot, { axis: [0, 1, 0] });
    A.node('wingL', [-pivot[0], pivot[1], pivot[2]], { axis: [0, 1, 0] });
    const wingO = {
      origin: [2.3, 0.3, -0.42],
      rootChord: 3.4,
      tipChord: 1.3,
      span: 7.48,
      sweepDeg: SWEEP_MIN,
      thicknessRatio: 0.085,
      tipThicknessRatio: 0.065,
      twistDeg: -2,
      chordSegments: L(24, 9, 4),
      spanSegments: L(16, 5, 1),
      mirror: true
    };
    liftingSurface(
      A,
      wingO,
      [
        { name: 'flap', span: [0.1, 0.56], chord: 0.74 },
        { name: 'flapOut', span: [0.56, 0.95], chord: 0.74 }
      ],
      { node: 'wingR', nodeL: 'wingL', parentR: 'wingR', parentL: 'wingL' }
    );
    const tipR = tipPoint(wingO, 1, 0.55);
    A.wingtip([-tipR.x, tipR.y, tipR.z + 0.4], 'wingL');
    A.wingtip([tipR.x, tipR.y, tipR.z + 0.4], 'wingR');
    navLights(A, {
      left: [-tipR.x - 0.02, tipR.y, tipR.z - 0.3],
      right: [tipR.x + 0.02, tipR.y, tipR.z - 0.3],
      leftNode: 'wingL',
      rightNode: 'wingR',
      tail: [0, 0.02, 9.1],
      strobes: [
        [0, 1.08, 0.6],
        [0, -0.4, 1.5]
      ]
    });

    // ---- twin vertical tails (canted 5 deg) --------------------------------
    const finM = xform({ pos: [1.6, 0.28, 3.3], rz: 85 });
    liftingSurface(
      A,
      {
        origin: [0, 0, 0],
        matrix: finM,
        rootChord: 4.45,
        tipChord: 1.45,
        span: 2.8,
        sweepDeg: 48,
        thicknessRatio: 0.05,
        tipThicknessRatio: 0.04,
        chordSegments: L(20, 8, 3),
        spanSegments: L(10, 3, 1),
        mirror: true
      },
      [{ name: 'rudder', span: [0.12, 0.9], chord: 0.72 }],
      { prefer: 'y' }
    );
    // fin-tip fairings (antennas / ECM)
    if (A.lod < 2) {
      const tipFair = lathe(
        [
          [0, -0.9],
          [0.07, -0.6],
          [0.08, 0.3],
          [0.05, 0.75],
          [0, 0.85]
        ],
        L(10, 6, 4)
      );
      tipFair.translate(1.845, 3.07, 7.05);
      addPair(A, 'body', tipFair);
    }

    // ventral fins
    liftingSurface(A, {
      origin: [0, 0, 0],
      matrix: xform({ pos: [1.92, -0.6, 4.9], rz: -58 }),
      rootChord: 2.1,
      tipChord: 1.0,
      span: 0.78,
      sweepDeg: 56,
      thicknessRatio: 0.05,
      chordSegments: L(10, 5, 3),
      spanSegments: L(3, 1, 1),
      mirror: true
    });

    // ---- all-moving stabilators --------------------------------------------
    const stabO = {
      origin: [2.02, -0.12, 4.78],
      rootChord: 3.55,
      tipChord: 1.02,
      span: 3.08,
      sweepDeg: 50,
      dihedralDeg: -4,
      thicknessRatio: 0.045,
      tipThicknessRatio: 0.04,
      chordSegments: L(20, 8, 3),
      spanSegments: L(10, 3, 1),
      rootCap: true
    };
    A.node('stabR', [2.3, -0.12, 6.35], { axis: [1, 0, 0] });
    A.node('stabL', [-2.3, -0.12, 6.35], { axis: [1, 0, 0] });
    liftingSurface(A, { ...stabO, mirror: true }, [], { node: 'stabR', nodeL: 'stabL' });

    // ---- nozzles -------------------------------------------------------------
    jetNozzle(A, { x: 1.6, y: -0.18, z0: 6.95, z1: 8.6, rBase: 0.52, rExit: 0.47, rThroat: 0.38 });

    // ---- canopy ----------------------------------------------------------------
    canopy(
      A,
      [
        { z: -7.3, width: 0.46, height: 0.12, y: 0.7 },
        { z: -6.75, width: 0.92, height: 0.7, y: 0.74 },
        { z: -6.05, width: 1.0, height: 1.2, y: 0.78 },
        { z: -4.9, width: 1.04, height: 1.34, y: 0.78 },
        { z: -3.7, width: 1.0, height: 1.3, y: 0.78 },
        { z: -2.8, width: 0.88, height: 1.08, y: 0.76 },
        { z: -2.25, width: 0.64, height: 0.72, y: 0.76 }
      ],
      { frames: [-6.28, -4.35], shape: 2.3 }
    );

    // ---- details -------------------------------------------------------------
    // pitot
    if (A.lod < 2)
    A.metal(
      lathe(
        [
          [0, -11.05],
          [0.018, -10.95],
          [0.022, -10.5],
          [0.05, -10.38]
        ],
        L(8, 5, 3)
      )
    );
    // chin pod (TCS / IRST)
    if (A.lod < 2) {
      const chin = lathe(
        [
          [0, -8.75],
          [0.12, -8.6],
          [0.15, -8.2],
          [0.13, -7.7],
          [0, -7.55]
        ],
        L(14, 8, 4)
      );
      chin.translate(0, -0.5, 0);
      A.body(setZone(chin, 2));
    }
    // gun port (dark recess)
    A.body(box(0.04, 0.12, 0.34, { pos: [-0.66, -0.12, -6.35], zone: 1 }));
    A.gun([-0.7, -0.12, -6.6]);

    // glove pylons + tunnel pallets
    pylon(A, { x: 2.45, y: 0.12, z: -0.3, len: 2.1, h: 0.42 });
    if (A.lod < 2) {
      for (const zc of [-1.1, 2.8]) {
        const pal = box(0.22, 0.14, 2.2, { pos: [0.58, -0.4, zc] });
        addPair(A, 'body', pal);
      }
    }
    // stores: node 'store<i>' sits on hardpoints[i] (hide it on launch)
    let si = 0;
    for (const [hp, type] of [
      [[2.45, -0.385, -0.35], 'aim9'],
      [[0.58, -0.58, -1.1], 'aim120'],
      [[0.58, -0.58, 2.8], 'aim120']
    ]) {
      for (const s of [-1, 1]) {
        const p = [hp[0] * s, hp[1], hp[2]];
        A.hardpoint(p);
        missileStore(A, p, { type, node: `store${si++}` });
      }
    }

    bladeAntenna(A, [0, 1.07, -0.6]);
    bladeAntenna(A, [0, -0.34, 0.9], { down: true });
    bladeAntenna(A, [0, -0.4, -5.6], { down: true, h: 0.16 });
    if (A.lod === 0) {
      formationStrip(A, [0.66, 0.1, -5.0], 0.5);
      formationStrip(A, [1.7, 0.95, 5.5], 0.55, { rz: -5 });
    }

    // ---- landing gear (tyres touch y = -2.1; Navy launch bar) --------------------
    landingGear(A, {
      ground: -2.1,
      navy: true,
      nose: { hinge: [0, -0.3, -5.9], axleZ: -5.72, tireR: 0.28, tireW: 0.17, twin: 0.19, strutR: 0.085, stow: 90, well: { y: -0.625, width: 0.46, z0: -7.0, z1: -5.75 } },
      main: {
        hinge: [2.22, 0.05, 1.2],
        axle: [2.55, 1.35],
        tireR: 0.44,
        tireW: 0.27,
        strutR: 0.12,
        stow: 90,
        brace: [2.3, 0.05, 0.2],
        well: { x0: 2.25, x1: 2.85, y: 0.11, z0: 0.0, z1: 2.3 }
      }
    });

    // ---- animation ------------------------------------------------------------
    const sweep = (s) => SWEEP_MIN + (SWEEP_MAX - SWEEP_MIN) * smooth(0.25, 0.85, s.speed01 ?? 0);
    A.control('wingR', (s) => -(sweep(s) - SWEEP_MIN) * DEG);
    A.control('wingL', (s) => (sweep(s) - SWEEP_MIN) * DEG);
    const flapAng = (s) => (s.flaps ?? 0) * 32 * DEG * (1 - smooth(0.2, 0.45, s.speed01 ?? 0));
    A.control('flapR', flapAng);
    A.control('flapL', flapAng);
    A.control('flapOutR', flapAng);
    A.control('flapOutL', flapAng);
    // roll via differential tailerons (+spoilers in reality), pitch via stabilators
    A.control('stabR', (s) => (-(s.pitch ?? 0) * 0.35 - (s.roll ?? 0) * 0.2));
    A.control('stabL', (s) => (-(s.pitch ?? 0) * 0.35 + (s.roll ?? 0) * 0.2));
    A.control('rudderR', (s) => (s.yaw ?? 0) * 0.45);
    A.control('rudderL', (s) => (s.yaw ?? 0) * 0.45);
  }
};
