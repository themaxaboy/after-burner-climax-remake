// Enemy fighter "A": MiG-29-inspired twin-tail air-superiority fighter
// (original procedural design). Length ~17.3 m, span 11.4 m.

import { loft, lathe, canopy, jetNozzle, liftingSurface, navLights, pylon, tipPoint, addPair, xform, box } from './common.js';

export default {
  id: 'fighterA',
  name: 'Fighter A (twin-tail)',
  kind: 'fighter',
  defaultScheme: 'enemy',
  livery: {
    panel: [1.4, 0.7],
    sootRange: [5.8, 8.4, 2.0],
    radomeZ: -7.6,
    tailTipY: 1e9,
    camoScale: 0.2
  },
  schemes: {
    // charcoal with red-orange fin tops (side band) and wing tips (top band beyond |x| 4.2 m)
    enemy: {
      preset: 'enemyCharcoal',
      stripe: { a: '#ff5a1c', b: '#a3210f', y: 2.45, amp: 0, width: 0.62, z0: 2.5, z1: 9.5, period: 3, sideMin: 0.45, wingZ: 3.2, wingK: 0, wingWidth: 1.3, wingXMin: 4.2 }
    },
    sky: 'enemySplinterBlue',
    desert: 'enemyDesert'
  },
  decals: [
    { tex: 'n27', center: [0, 0.05, -6.8], size: [0.75, 0.36], axis: 'x', depth: 0.8 },
    { tex: 'emblemEnemy', center: [1.72, 1.55, 4.3], size: [0.9, 0.9], axis: [0.995, -0.105, 0], depth: 0.2, mirror: true },
    { tex: 'emblemEnemy', center: [3.9, 0.05, 1.9], size: [1.0, 1.0], axis: 'y', depth: 0.3, side: 1, mirror: true },
    { tex: 'emblemEnemy', center: [3.9, -0.05, 1.9], size: [1.0, 1.0], axis: 'y', depth: 0.3, side: -1, mirror: true }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    // slim forward fuselage with drooped nose, spine to the tail
    A.body(
      loft(
        [
          { z: -9.0, width: 0, height: 0, y: -0.2 },
          { z: -8.5, width: 0.4, height: 0.38, y: -0.17 },
          { z: -7.5, width: 0.78, height: 0.76, y: -0.1 },
          { z: -6.3, width: 1.0, height: 1.08, y: -0.02, shape: { nTop: 2.2, nBottom: 2.6 } },
          { z: -5.0, width: 1.1, height: 1.28, y: 0.06, shape: { nTop: 2.3, nBottom: 3 } },
          { z: -3.6, width: 1.22, height: 1.22, y: 0.1, shape: { nTop: 2.4, nBottom: 3.2 } },
          { z: -2.0, width: 1.4, height: 0.98, y: 0.18, shape: { nTop: 2.6, nBottom: 3.4 } },
          { z: 0.8, width: 1.25, height: 0.8, y: 0.22, shape: 2.6 },
          { z: 4.0, width: 1.0, height: 0.66, y: 0.22, shape: 2.4 },
          { z: 7.0, width: 0.7, height: 0.5, y: 0.2, shape: 2.2 },
          { z: 8.25, width: 0, height: 0, y: 0.2 }
        ],
        { radial: L(56, 22, 12), rings: L(96, 30, 11), noseBoost: 1.8, tailBoost: 1.2 }
      )
    );
    // wide flat centre section between nacelles (lifting body)
    A.body(
      loft(
        [
          { z: -2.6, width: 1.6, height: 0.36, y: 0.02, shape: 5 },
          { z: -0.5, width: 2.8, height: 0.56, y: 0.02, shape: { nTop: 4, nBottom: 6 } },
          { z: 4.0, width: 2.9, height: 0.54, y: 0.02, shape: { nTop: 4, nBottom: 6 } },
          { z: 7.2, width: 2.0, height: 0.3, y: 0.0, shape: 5 },
          { z: 7.9, width: 1.2, height: 0.12, y: 0.0, shape: 5 }
        ],
        { radial: L(40, 16, 8), rings: L(40, 12, 5) }
      )
    );
    // widely spaced nacelles with raked wedge intakes
    const nac = loft(
      [
        { z: -2.4, x: 1.28, width: 0.84, height: 0.62, y: -0.42, shape: 7, rake: 0.7 },
        { z: -1.6, x: 1.28, width: 0.88, height: 0.72, y: -0.42, shape: 5, rake: 0.2 },
        { z: 1.0, x: 1.26, width: 0.96, height: 0.9, y: -0.38, shape: 3 },
        { z: 4.5, x: 1.22, width: 1.0, height: 0.95, y: -0.32, shape: 2.3 },
        { z: 7.0, x: 1.18, width: 0.92, height: 0.9, y: -0.28, shape: 2 }
      ],
      { radial: L(40, 16, 8), rings: L(48, 14, 5), capStart: { lip: 0.05, depth: 1.3 }, capEnd: 'flat' }
    );
    addPair(A, 'body', nac);

    // LERX blending into the wing
    liftingSurface(A, {
      origin: [0.45, 0.2, -5.3],
      planform: [
        { x: 0, zLE: 0, chord: 6.6, t: 0.035 },
        { x: 0.7, zLE: 2.6, chord: 4.3, t: 0.04 },
        { x: 1.4, zLE: 4.6, chord: 2.6, t: 0.05 }
      ],
      chordSegments: L(20, 8, 3),
      spanSegments: L(5, 2, 1),
      sharpLE: true,
      mirror: true
    });
    const wingO = {
      origin: [1.55, 0.12, -0.6],
      rootChord: 4.0,
      tipChord: 1.15,
      span: 4.15,
      sweepDeg: 42,
      dihedralDeg: -2,
      thicknessRatio: 0.05,
      tipThicknessRatio: 0.04,
      chordSegments: L(22, 8, 4),
      spanSegments: L(12, 4, 1),
      mirror: true
    };
    liftingSurface(A, wingO, [
      { name: 'flap', span: [0.05, 0.48], chord: 0.74 },
      { name: 'aileron', span: [0.52, 0.93], chord: 0.74 }
    ]);
    const tipR = tipPoint(wingO, 1, 0.5);
    A.wingtip([-tipR.x, tipR.y, tipR.z + 0.4]);
    A.wingtip([tipR.x, tipR.y, tipR.z + 0.4]);

    liftingSurface(
      A,
      {
        origin: [0, 0, 0],
        matrix: xform({ pos: [1.55, 0.12, 2.05], rz: 84 }),
        rootChord: 3.3,
        tipChord: 1.05,
        span: 2.95,
        sweepDeg: 47,
        thicknessRatio: 0.05,
        tipThicknessRatio: 0.04,
        chordSegments: L(18, 7, 3),
        spanSegments: L(8, 3, 1),
        mirror: true
      },
      [{ name: 'rudder', span: [0.12, 0.86], chord: 0.72 }],
      { prefer: 'y' }
    );

    A.node('stabR', [2.05, -0.2, 6.1], { axis: [1, 0, 0] });
    A.node('stabL', [-2.05, -0.2, 6.1], { axis: [1, 0, 0] });
    liftingSurface(
      A,
      {
        origin: [1.7, -0.2, 4.95],
        rootChord: 2.65,
        tipChord: 0.95,
        span: 2.25,
        sweepDeg: 50,
        dihedralDeg: -3,
        thicknessRatio: 0.045,
        chordSegments: L(14, 6, 3),
        spanSegments: L(7, 3, 1),
        rootCap: true,
        mirror: true
      },
      [],
      { node: 'stabR', nodeL: 'stabL' }
    );

    jetNozzle(A, { x: 1.18, y: -0.28, z0: 6.9, z1: 8.15, rBase: 0.46, rExit: 0.43, rThroat: 0.34 });

    canopy(
      A,
      [
        { z: -6.55, width: 0.36, height: 0.1, y: 0.5 },
        { z: -6.05, width: 0.8, height: 0.62, y: 0.54 },
        { z: -5.3, width: 0.88, height: 1.1, y: 0.58 },
        { z: -4.4, width: 0.86, height: 1.12, y: 0.6 },
        { z: -3.7, width: 0.72, height: 0.86, y: 0.6 },
        { z: -3.2, width: 0.5, height: 0.5, y: 0.6 }
      ],
      { frames: [-6.0], shape: 2.2 }
    );

    if (A.lod < 2)
    A.metal(
      lathe(
        [
          [0, -9.6],
          [0.018, -9.5],
          [0.022, -9.1],
          [0.05, -8.98]
        ],
        L(8, 5, 3)
      )
    );
    // IRST ball ahead of the windscreen
    if (A.lod < 2) {
      const irst = lathe(
        [
          [0, -0.22],
          [0.14, -0.12],
          [0.16, 0.05],
          [0.1, 0.2],
          [0, 0.24]
        ],
        L(12, 8, 4),
        { zone: 9 }
      );
      irst.translate(0.18, 0.5, -6.55);
      A.body(irst);
    }
    A.body(box(0.03, 0.1, 0.3, { pos: [-0.62, 0.22, -3.2], zone: 1 }));
    A.gun([-0.66, 0.22, -3.4]);
    for (const x of [2.7, 3.7]) pylon(A, { x, y: 0.12 - 0.035 * (x - 1.55) - 0.02, z: 1.1 + (x - 1.55) * 0.5, len: 1.9, h: 0.36 });
    for (const hp of [
      [3.7, -0.35, 2.2],
      [2.7, -0.3, 1.7],
      [0.0, -0.4, 1.0]
    ]) {
      A.hardpoint([-hp[0], hp[1], hp[2]]);
      if (hp[0]) A.hardpoint(hp);
    }
    navLights(A, {
      left: [-tipR.x - 0.02, tipR.y, tipR.z - 0.2],
      right: [tipR.x + 0.02, tipR.y, tipR.z - 0.2],
      tail: [0, 0.2, 8.25]
    });

    A.control('aileronR', (s) => -(s.roll ?? 0) * 0.4);
    A.control('aileronL', (s) => (s.roll ?? 0) * 0.4);
    A.control('flapR', (s) => (s.flaps ?? 0) * 0.5);
    A.control('flapL', (s) => (s.flaps ?? 0) * 0.5);
    A.control('stabR', (s) => -(s.pitch ?? 0) * 0.35 - (s.roll ?? 0) * 0.12);
    A.control('stabL', (s) => -(s.pitch ?? 0) * 0.35 + (s.roll ?? 0) * 0.12);
    A.control('rudderR', (s) => (s.yaw ?? 0) * 0.45);
    A.control('rudderL', (s) => (s.yaw ?? 0) * 0.45);
  }
};

