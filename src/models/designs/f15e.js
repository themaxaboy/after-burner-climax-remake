// F-15E-inspired two-seat strike fighter (original procedural design).
// Length ~19.4 m, span 13.05 m. Big fixed wing, box intakes, conformal tanks.

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
  missileStore,
  bladeAntenna,
  landingGear
} from './common.js';

export default {
  id: 'f15e',
  name: 'F-15E STRIKE EAGLE',
  kind: 'fighter',
  defaultScheme: 'standard',
  livery: {
    panel: [1.5, 0.75],
    sootRange: [6.4, 9.8, 1.3],
    radomeZ: -7.7,
    antiGlare: [-7.5, -6.95, 0.42],
    tailTipY: 3.35,
    tailZ: 2.5,
    camoScale: 0.15,
    stripe: { y: 0.15, amp: 0.2, width: 0.12, z0: -9.2, z1: 7.0, period: 3.4, wingZ: 1.4, wingK: 0.55, fuseHalf: 1.8, wingXMin: 2.4 }
  },
  schemes: {
    standard: 'gunship',
    camo: 'euroCamo',
    special: 'bronzeGold',
    lowvis: 'darkTps'
  },
  decals: [
    { tex: 'n301', center: [0, 0.1, -7.0], size: [0.8, 0.36], axis: 'x', depth: 0.8, notSchemes: ['standard'] },
    { tex: 'stencil', center: [0, -0.3, -6.2], size: [0.6, 0.15], axis: 'x', depth: 0.8 },
    { tex: 'roundel', center: [0, 0.4, 0.9], size: [0.55, 0.55], axis: 'x', depth: 1.25, schemes: ['camo', 'lowvis'] },
    { tex: 'tailCode', center: [1.6, 2.0, 5.55], size: [1.0, 0.55], axis: 'x', depth: 0.2, mirror: true },
    { tex: 'n301', center: [1.6, 1.3, 5.2], size: [0.8, 0.36], axis: 'x', depth: 0.2, mirror: true },
    { tex: 'emblemEagle', center: [1.6, 2.75, 6.2], size: [0.7, 0.7], axis: 'x', depth: 0.2, mirror: true, schemes: ['special', 'camo'] },
    { tex: 'warnTri', center: [0, 0.45, -5.9], size: [0.24, 0.21], axis: 'x', depth: 0.8 },
    { tex: 'noStep', center: [3.9, 0.55, 2.6], size: [0.6, 0.15], axis: 'y', depth: 0.3, side: 1, mirror: true }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);

    // forward fuselage + upper centre body
    A.body(
      loft(
        [
          { z: -9.8, width: 0, height: 0, y: -0.05 },
          { z: -9.4, width: 0.42, height: 0.4, y: -0.04 },
          { z: -8.6, width: 0.82, height: 0.78, y: -0.02 },
          { z: -7.7, width: 1.08, height: 1.04, y: 0.02, shape: { nTop: 2, nBottom: 2.4 } },
          { z: -6.6, width: 1.26, height: 1.3, y: 0.08, shape: { nTop: 2.2, nBottom: 3.0 } },
          { z: -5.0, width: 1.36, height: 1.42, y: 0.12, shape: { nTop: 2.4, nBottom: 3.4 } },
          { z: -3.2, width: 1.42, height: 1.44, y: 0.14, shape: { nTop: 2.6, nBottom: 3.6 } },
          { z: -1.6, width: 1.7, height: 1.3, y: 0.22, shape: { nTop: 3, nBottom: 4 } },
          { z: 0.6, width: 2.3, height: 1.02, y: 0.3, shape: { nTop: 4, nBottom: 4 } },
          { z: 3.6, width: 2.35, height: 0.84, y: 0.3, shape: { nTop: 4.5, nBottom: 4 } },
          { z: 6.6, width: 1.7, height: 0.62, y: 0.26, shape: 4 },
          { z: 8.3, width: 0.9, height: 0.34, y: 0.2, shape: 3 }
        ],
        { radial: L(64, 22, 10), rings: L(100, 28, 10), noseBoost: 1.8 }
      )
    );
    // dorsal spine with speed-brake hump
    A.body(
      loft(
        [
          { z: -2.4, width: 0.72, height: 0.9, y: 0.86 },
          { z: -1.5, width: 0.92, height: 1.0, y: 0.8 },
          { z: 1.5, width: 1.2, height: 0.9, y: 0.72 },
          { z: 4.5, width: 1.0, height: 0.7, y: 0.62 },
          { z: 7.5, width: 0, height: 0, y: 0.48 }
        ],
        { radial: L(36, 14, 8), rings: L(36, 12, 4), shape: 2.4, tailBoost: 1 }
      )
    );
    // wide wing shelf / upper body between the booms
    A.body(
      loft(
        [
          { z: -2.2, width: 1.8, height: 0.5, y: 0.4, shape: 5 },
          { z: 0.5, width: 3.3, height: 0.62, y: 0.38, shape: { nTop: 6, nBottom: 5 } },
          { z: 5.0, width: 3.5, height: 0.56, y: 0.36, shape: { nTop: 6, nBottom: 5 } },
          { z: 8.0, width: 2.6, height: 0.4, y: 0.3, shape: 5 },
          { z: 8.9, width: 1.8, height: 0.2, y: 0.28, shape: 5 }
        ],
        { radial: L(40, 16, 8), rings: L(40, 12, 5) }
      )
    );
    // box intakes -> engine nacelles
    const nac = loft(
      [
        { z: -4.45, x: 1.33, width: 1.0, height: 1.36, y: -0.06, shape: 9, rake: -0.5 },
        { z: -3.5, x: 1.33, width: 1.04, height: 1.38, y: -0.07, shape: 7, rake: -0.12 },
        { z: -1.0, x: 1.26, width: 1.1, height: 1.3, y: -0.1, shape: 5 },
        { z: 2.0, x: 1.02, width: 1.2, height: 1.2, y: -0.12, shape: 3.2 },
        { z: 5.0, x: 0.74, width: 1.12, height: 1.1, y: -0.1, shape: 2.4 },
        { z: 7.95, x: 0.68, width: 1.04, height: 1.04, y: -0.08, shape: 2 }
      ],
      { radial: L(48, 18, 8), rings: L(56, 14, 5), capStart: { lip: 0.06, depth: 1.6 }, capEnd: 'flat' }
    );
    addPair(A, 'body', nac);
    // conformal fuel tanks
    const cft = loft(
      [
        { z: -2.9, x: 1.98, width: 0, height: 0, y: -0.15 },
        { z: -2.2, x: 1.98, width: 0.55, height: 0.8, y: -0.18, shape: 2.6 },
        { z: 0.5, x: 1.96, width: 0.66, height: 0.96, y: -0.2, shape: 3 },
        { z: 3.6, x: 1.9, width: 0.62, height: 0.9, y: -0.2, shape: 3 },
        { z: 5.2, x: 1.8, width: 0, height: 0, y: -0.12 }
      ],
      { radial: L(32, 14, 8), rings: L(32, 10, 4) }
    );
    addPair(A, 'body', cft);
    // tail booms
    const boom = loft(
      [
        { z: 2.8, x: 1.58, width: 0.3, height: 0.36, y: 0.3, shape: 3 },
        { z: 4.5, x: 1.58, width: 0.46, height: 0.54, y: 0.28, shape: 3 },
        { z: 8.4, x: 1.6, width: 0.42, height: 0.48, y: 0.22, shape: 3 },
        { z: 9.55, x: 1.6, width: 0.1, height: 0.14, y: 0.2, shape: 3 }
      ],
      { radial: L(24, 10, 6), rings: L(24, 8, 3) }
    );
    addPair(A, 'body', boom);

    // wing
    const wingO = {
      origin: [1.35, 0.5, -1.95],
      planform: [
        { x: 0, zLE: 0, chord: 6.6, t: 0.058 },
        { x: 4.55, zLE: 4.55, chord: 2.3, t: 0.04 },
        { x: 5.18, zLE: 5.25, chord: 1.55, t: 0.035 }
      ],
      dihedralDeg: -1,
      twistDeg: -2,
      chordSegments: L(26, 10, 4),
      spanSegments: L(14, 5, 1),
      mirror: true
    };
    liftingSurface(A, wingO, [
      { name: 'flap', span: [0.06, 0.46], chord: 0.74 },
      { name: 'aileron', span: [0.52, 0.86], chord: 0.74 }
    ]);
    const tipR = tipPoint(wingO, 1, 0.4);
    A.wingtip([-tipR.x, tipR.y, tipR.z + 0.4]);
    A.wingtip([tipR.x, tipR.y, tipR.z + 0.4]);

    // twin vertical tails (upright)
    liftingSurface(
      A,
      {
        origin: [0, 0, 0],
        matrix: xform({ pos: [1.6, 0.46, 3.75], rz: 90 }),
        planform: [
          { x: 0, zLE: 0, chord: 3.55, t: 0.05 },
          { x: 3.05, zLE: 2.35, chord: 1.5, t: 0.04 },
          { x: 3.3, zLE: 2.75, chord: 0.95, t: 0.04 }
        ],
        chordSegments: L(18, 8, 3),
        spanSegments: L(9, 3, 1),
        mirror: true
      },
      [{ name: 'rudder', span: [0.08, 0.5], chord: 0.7 }],
      { prefer: 'y' }
    );

    // stabilators on the booms
    A.node('stabR', [2.3, 0.15, 7.15], { axis: [1, 0, 0] });
    A.node('stabL', [-2.3, 0.15, 7.15], { axis: [1, 0, 0] });
    liftingSurface(
      A,
      {
        origin: [1.72, 0.15, 6.05],
        planform: [
          { x: 0, zLE: 0, chord: 3.25, t: 0.045 },
          { x: 2.2, zLE: 2.25, chord: 1.55, t: 0.04 },
          { x: 2.75, zLE: 2.95, chord: 0.95, t: 0.04 }
        ],
        chordSegments: L(16, 7, 3),
        spanSegments: L(8, 3, 1),
        rootCap: true,
        mirror: true
      },
      [],
      { node: 'stabR', nodeL: 'stabL' }
    );

    jetNozzle(A, { x: 0.68, y: -0.08, z0: 7.8, z1: 9.45, rBase: 0.54, rExit: 0.5, rThroat: 0.4 });

    canopy(
      A,
      [
        { z: -7.25, width: 0.44, height: 0.12, y: 0.66 },
        { z: -6.7, width: 0.9, height: 0.7, y: 0.7 },
        { z: -5.9, width: 1.0, height: 1.24, y: 0.74 },
        { z: -4.3, width: 1.04, height: 1.36, y: 0.76 },
        { z: -3.0, width: 1.0, height: 1.3, y: 0.78 },
        { z: -2.2, width: 0.84, height: 1.02, y: 0.8 },
        { z: -1.7, width: 0.6, height: 0.62, y: 0.82 }
      ],
      { frames: [-6.72, -4.3], shape: 2.3 }
    );

    // details
    if (A.lod < 2)
    A.metal(
      lathe(
        [
          [0, -10.05],
          [0.015, -9.95],
          [0.02, -9.7],
          [0.04, -9.62]
        ],
        L(8, 5, 3)
      )
    );
    if (A.lod < 2) {
      // targeting pods under the intakes
      const pod = lathe(
        [
          [0, -1.5],
          [0.12, -1.42],
          [0.17, -1.1],
          [0.18, 0.9],
          [0.12, 1.3],
          [0, 1.35]
        ],
        L(14, 8, 4)
      );
      const podL = pod.clone();
      pod.translate(1.33, -0.98, -2.2);
      A.body(pod);
      podL.translate(-1.33, -0.98, -2.2);
      A.body(podL);
      const win = lathe(
        [
          [0, -1.53],
          [0.1, -1.46],
          [0, -1.4]
        ],
        L(10, 6, 4)
      );
      win.translate(1.33, -0.98, -2.2);
      A.body(setZone(win, 9));
      pylon(A, { x: 1.33, y: -0.72, z: -2.2, len: 1.4, h: 0.12 });
    }
    A.body(box(0.03, 0.12, 0.3, { pos: [1.9, 0.58, -1.3], zone: 1 }));
    A.gun([1.95, 0.58, -1.6]);
    // CFT stub pylons + wing pylons
    if (A.lod < 2) {
      for (const zc of [-1.2, 0.6, 2.4]) {
        const st = box(0.12, 0.12, 0.7, { pos: [2.12, -0.66, zc] });
        addPair(A, 'body', st);
      }
    }
    pylon(A, { x: 3.4, y: 0.34, z: 1.4, len: 2.2, h: 0.46 });
    let si = 0;
    for (const [hp, type] of [
      [[3.4, -0.23, 1.2], 'aim120'],
      [[2.12, -0.83, 0.6], 'aim120'],
      [[2.12, -0.83, -1.3], 'aim120']
    ]) {
      for (const s of [-1, 1]) {
        const p = [hp[0] * s, hp[1], hp[2]];
        A.hardpoint(p);
        missileStore(A, p, { type, node: `store${si++}` });
      }
    }
    // Sidewinders on the wing-pylon shoulder rails
    for (const s of [-1, 1]) missileStore(A, [s * 3.72, 0.02, 1.0], { type: 'aim9', node: s < 0 ? 'storeRailL' : 'storeRailR' });
    navLights(A, {
      left: [-tipR.x - 0.02, tipR.y, tipR.z - 0.45],
      right: [tipR.x + 0.02, tipR.y, tipR.z - 0.45],
      tail: [1.6, 3.62, 7.4],
      strobes: [
        [0, 1.28, 0.8],
        [0, -0.5, 1.2]
      ]
    });
    bladeAntenna(A, [0, 1.29, -1.0]);
    bladeAntenna(A, [0, -0.6, -4.4], { down: true, h: 0.16 });
    if (A.lod === 0) {
      formationStrip(A, [0.68, 0.15, -5.6], 0.5);
      formationStrip(A, [1.64, 2.2, 6.0], 0.5);
    }

    landingGear(A, {
      ground: -2.1,
      navy: false,
      nose: { hinge: [0, -0.35, -5.6], axleZ: -5.42, tireR: 0.29, tireW: 0.18, twin: 0, strutR: 0.085, stow: 90, well: { y: -0.6, width: 0.4, z0: -6.7, z1: -5.5 } },
      main: {
        hinge: [1.2, -0.45, 0.9],
        axle: [1.42, 1.05],
        tireR: 0.43,
        tireW: 0.26,
        strutR: 0.12,
        stow: 90,
        brace: [1.15, -0.5, 0.0],
        well: { x0: 0.95, x1: 1.35, y: -0.76, z0: -0.1, z1: 1.5 }
      }
    });

    A.control('aileronR', (s) => -(s.roll ?? 0) * 0.35);
    A.control('aileronL', (s) => (s.roll ?? 0) * 0.35);
    const flap = (s) => (s.flaps ?? 0) * 0.55;
    A.control('flapR', flap);
    A.control('flapL', flap);
    A.control('stabR', (s) => -(s.pitch ?? 0) * 0.35 - (s.roll ?? 0) * 0.15);
    A.control('stabL', (s) => -(s.pitch ?? 0) * 0.35 + (s.roll ?? 0) * 0.15);
    A.control('rudderR', (s) => (s.yaw ?? 0) * 0.5);
    A.control('rudderL', (s) => (s.yaw ?? 0) * 0.5);
  }
};
