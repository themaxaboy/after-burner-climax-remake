// CH-47-inspired tandem-rotor transport helicopter (original procedural
// design). Rotors are separate nodes 'rotorF' / 'rotorR' (spin about +Y).
// Fuselage ~15.5 m, rotor diameter 18.3 m.

import { loft, lathe, liftingSurface, navLights, addPair, taperBox, box, xform, mirrorX } from './common.js';
import { bandProfile } from '../loft.js';
import { wing } from '../airfoil.js';

const ROTOR_R = 9.15;
const HUB_F = [0, 3.15, -5.0];
const HUB_R = [0, 4.25, 6.15];

export default {
  id: 'heloCH47',
  name: 'Helo CH47 (tandem rotor)',
  kind: 'helo',
  defaultScheme: 'standard',
  glassTint: '#141a1e',
  livery: {
    panel: [1.2, 0.8],
    groove: 0.005,
    sootRange: [6.0, 8.5, 2.0],
    camoScale: 0.16
  },
  schemes: {
    standard: 'olive',
    // dark olive with an orange cheat line (wing band disabled)
    enemy: {
      preset: 'enemyHeloDark',
      stripe: { a: '#ff6a1a', b: '#2a2e27', y: -0.55, amp: 0, width: 0.2, z0: -9.5, z1: 8.5, period: 3, sideMin: 0.5, wingZ: 1e4, wingK: 0, wingWidth: 0.1, fuseHalf: 2.4 }
    },
    desert: 'enemyDesert'
  },
  decals: [
    { tex: 'emblemEnemy', center: [0, 0.2, 1.0], size: [1.3, 1.3], axis: 'x', depth: 1.7, schemes: ['enemy'] },
    { tex: 'roundel', center: [0, 0.2, 1.0], size: [1.2, 1.2], axis: 'x', depth: 1.7, schemes: ['standard'] },
    { tex: 'n07', center: [0, 2.9, 5.2], size: [1.2, 0.56], axis: 'x', depth: 1.0 }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    A.meta.radius = Math.max(Math.hypot(HUB_F[1], HUB_F[2]), Math.hypot(HUB_R[1], HUB_R[2])) + ROTOR_R;
    // boxy fuselage with rounded nose
    A.body(
      loft(
        [
          { z: -7.7, width: 1.9, height: 1.7, y: -0.35, shape: 3 },
          { z: -7.0, width: 2.45, height: 2.55, y: -0.05, shape: { nTop: 3, nBottom: 4 } },
          { z: -5.6, width: 2.7, height: 2.95, y: 0.05, shape: { nTop: 3.4, nBottom: 5 } },
          { z: 5.8, width: 2.7, height: 2.95, y: 0.05, shape: { nTop: 3.4, nBottom: 5 } },
          { z: 7.9, width: 2.6, height: 2.6, y: 0.35, shape: { nTop: 3.4, nBottom: 5 } }
        ],
        { radial: L(96, 36, 14), rings: L(100, 40, 8), capStart: 'round', capEnd: 'flat' }
      )
    );
    // cockpit windscreen band
    const band = bandProfile(-0.25, Math.PI + 0.25, 0.04);
    A.glass(
      loft(
        [
          { z: -7.55, width: 2.02, height: 1.85, y: -0.3, shape: band },
          { z: -7.05, width: 2.5, height: 2.6, y: -0.05, shape: band },
          { z: -6.55, width: 2.62, height: 2.8, y: 0.0, shape: band }
        ],
        { radial: L(64, 24, 12), rings: L(10, 4, 1), capStart: 'none', capEnd: 'none' }
      )
    );
    // side sponsons
    const sp = loft(
      [
        { z: -3.0, x: 1.5, width: 0, height: 0, y: -0.95 },
        { z: -2.4, x: 1.5, width: 0.8, height: 0.9, y: -0.95, shape: 3 },
        { z: 5.0, x: 1.5, width: 0.9, height: 1.0, y: -0.9, shape: 3 },
        { z: 6.0, x: 1.5, width: 0, height: 0, y: -0.85 }
      ],
      { radial: L(48, 18, 6), rings: L(56, 14, 3) }
    );
    addPair(A, 'body', sp);
    // forward rotor pylon
    A.body(
      loft(
        [
          { z: -6.7, width: 0, height: 0, y: 1.3 },
          { z: -6.2, width: 0.9, height: 0.8, y: 1.45 },
          { z: -4.4, width: 1.2, height: 1.1, y: 1.6 },
          { z: -3.4, width: 0, height: 0, y: 1.45 }
        ],
        { radial: L(48, 18, 6), rings: L(40, 12, 3) }
      )
    );
    // aft pylon (tall)
    A.body(
      loft(
        [
          { z: 1.5, width: 0.6, top: 1.55, bottom: 1.2, shape: 3 },
          { z: 3.2, width: 1.3, top: 2.4, bottom: 1.0, shape: 3 },
          { z: 5.5, width: 1.3, top: 3.8, bottom: 1.0, shape: 3 },
          { z: 7.4, width: 1.1, top: 3.9, bottom: 1.2, shape: 3 },
          { z: 8.1, width: 0.7, top: 3.6, bottom: 1.6, shape: 3 }
        ],
        { radial: L(56, 20, 8), rings: L(60, 16, 4), capStart: 'flat', capEnd: 'flat' }
      )
    );
    // engines on the aft pylon
    const eng = lathe(
      [
        { r: 0.36, z: 3.2, crease: true },
        [0.46, 3.4],
        [0.5, 4.2],
        [0.48, 6.9],
        { r: 0.36, z: 7.6, crease: true },
        { r: 0.0, z: 7.6 }
      ],
      L(40, 16, 6)
    );
    eng.translate(1.3, 2.3, 0);
    addPair(A, 'body', eng);
    const intakeFace = lathe(
      [
        [0, 3.45],
        [0.37, 3.2]
      ],
      L(14, 8, 5),
      { zone: 1 }
    );
    intakeFace.translate(1.3, 2.3, 0);
    addPair(A, 'body', intakeFace);
    A.nozzle([1.3, 2.3, 7.6], 0.35);
    A.nozzle([-1.3, 2.3, 7.6], 0.35);

    // masts + rotors
    for (const [name, hub, dir, phase] of [
      ['rotorF', HUB_F, 1, 0],
      ['rotorR', HUB_R, -1, Math.PI / 3]
    ]) {
      const mast = lathe(
        [
          [0.22, -1.0],
          [0.2, 0.0],
          [0.15, 0.4]
        ],
        L(12, 6, 4)
      );
      mast.applyMatrix4(xform({ rx: -90 }));
      mast.translate(hub[0], hub[1] - 0.2, hub[2]);
      A.metal(mast);
      A.node(name, hub, { axis: [0, 1, 0] });
      const hubG = lathe(
        [
          [0, -0.35],
          [0.42, -0.25],
          [0.48, 0.0],
          [0.3, 0.25],
          [0, 0.3]
        ],
        L(28, 12, 6)
      );
      hubG.applyMatrix4(xform({ rx: -90 }));
      hubG.translate(hub[0], hub[1], hub[2]);
      A.metal(hubG, name);
      for (let b = 0; b < 3; b++) {
        const blade = wing({
          origin: [0.4, 0, -0.32],
          rootChord: 0.64,
          tipChord: 0.64,
          span: ROTOR_R - 0.4,
          thicknessRatio: 0.12,
          twistDeg: -8,
          chordSegments: L(14, 6, 2),
          spanSegments: L(20, 8, 1)
        });
        blade.applyMatrix4(xform({ ry: phase * (180 / Math.PI) + b * 120 * dir, pos: hub }));
        A.body(blade, name);
      }
      A.control(name, (s) => dir * (s.time ?? 0) * 9.0 + phase);
    }

    // landing gear
    if (A.lod < 2) {
      for (const [z, x] of [
        [-4.6, 1.15],
        [3.9, 1.2]
      ]) {
        const tyre = lathe(
          [
            [0.12, -0.14],
            [0.36, -0.14],
            [0.4, 0],
            [0.36, 0.14],
            [0.12, 0.14]
          ],
          L(28, 12, 5),
          { zone: 3 }
        );
        tyre.applyMatrix4(xform({ ry: 90, pos: [x, -1.95, z] }));
        addPair(A, 'body', tyre);
        const strut = box(0.14, 0.9, 0.14, { pos: [x - 0.1, -1.4, z] });
        addPair(A, 'metal', strut);
      }
    }
    // horizontal pitch fairings (small stub on rear pylon)
    liftingSurface(A, {
      origin: [0.55, 1.4, 6.0],
      rootChord: 1.2,
      tipChord: 0.8,
      span: 0.6,
      sweepDeg: 20,
      thicknessRatio: 0.12,
      chordSegments: L(6, 3, 2),
      spanSegments: 1,
      mirror: true
    });
    // cabin windows (dark glass rounds)
    if (A.lod === 0) {
      for (const z of [-3.4, -1.6, 0.2, 2.0, 3.8]) {
        const w = box(0.04, 0.42, 0.42, { pos: [1.36, 0.45, z] });
        A.glass(w);
        A.glass(mirrorX(w));
      }
    }
    navLights(A, {
      left: [-1.9, -0.6, -1.0],
      right: [1.9, -0.6, -1.0],
      tail: [0, 3.95, 8.0],
      strobes: [
        [0, 1.9, -3.6],
        [0, -1.5, 2.0]
      ],
      size: 0.1
    });
    A.gun([0, -0.5, -7.8]);
    A.hardpoint([-1.5, -1.3, 0.5]);
    A.hardpoint([1.5, -1.3, 0.5]);
    A.body(taperBox({ w0: 2.2, d0: 0.4, w1: 2.2, d1: 0.1, y0: -1.2, y1: -1.1, x: 0, z: 8.0 }));
  }
};
