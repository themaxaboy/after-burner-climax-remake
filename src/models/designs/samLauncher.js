// Tracked SAM launcher vehicle (original procedural design). Node 'launcher'
// (azimuth, +Y) carries node 'launcherArm' (elevation) with a 2x2 canister box.
// Origin ~1.3 m above ground (ground at y = -1.35).

import { lathe, taperBox, box, hexahedron, xform, applyMat, addPair, navLights, WHITE } from './common.js';

export default {
  id: 'samLauncher',
  name: 'SAM Launcher',
  kind: 'ground',
  defaultScheme: 'standard',
  glassTint: '#10161a',
  livery: {
    panel: [1.1, 0.6],
    groove: 0.004,
    sootRange: [1e9, 1e9 + 1, 0],
    camoScale: 0.3
  },
  schemes: { standard: 'enemyDesert', enemy: 'enemyDesert', olive: 'olive' },
  decals: [
    { tex: 'emblemEnemy', center: [0, 0.1, 0.6], size: [0.9, 0.9], axis: 'x', depth: 1.8 },
    { tex: 'n27', center: [0, 0.1, -2.2], size: [0.9, 0.42], axis: 'x', depth: 1.8 }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    // hull with sloped glacis
    A.body(
      hexahedron([
        [-1.55, -0.75, -3.6],
        [1.55, -0.75, -3.6],
        [1.45, 0.1, -3.9],
        [-1.45, 0.1, -3.9],
        [-1.55, -0.75, 3.5],
        [1.55, -0.75, 3.5],
        [1.55, 0.35, 3.5],
        [-1.55, 0.35, 3.5]
      ])
    );
    A.body(taperBox({ w0: 3.1, d0: 5.0, w1: 3.0, d1: 5.0, y0: 0.05, y1: 0.4, x: 0, z: 1.0 }));
    // cab
    A.body(
      hexahedron([
        [-1.5, 0.05, -3.8],
        [1.5, 0.05, -3.8],
        [1.3, 1.25, -3.2],
        [-1.3, 1.25, -3.2],
        [-1.5, 0.05, -1.6],
        [1.5, 0.05, -1.6],
        [1.35, 1.3, -1.7],
        [-1.35, 1.3, -1.7]
      ])
    );
    A.glass(
      hexahedron([
        [-1.25, 0.55, -3.66],
        [1.25, 0.55, -3.66],
        [1.12, 1.12, -3.3],
        [-1.12, 1.12, -3.3],
        [-1.25, 0.55, -3.56],
        [1.25, 0.55, -3.56],
        [1.12, 1.12, -3.2],
        [-1.12, 1.12, -3.2]
      ])
    );
    // tracks + road wheels
    const track = box(0.6, 0.85, 7.0, { pos: [1.5, -0.95, -0.1], zone: 3 });
    addPair(A, 'body', track);
    if (A.lod < 2) {
      for (let i = 0; i < 6; i++) {
        const w = lathe(
          [
            [0, -0.12],
            [0.38, -0.12],
            [0.4, 0],
            [0.38, 0.12],
            [0, 0.12]
          ],
          L(16, 8, 5),
          { zone: 3 }
        );
        applyMat(w, xform({ ry: 90, pos: [1.84, -0.98, -2.8 + i * 1.12] }));
        addPair(A, 'body', w);
      }
      // side skirts
      const sk = box(0.06, 0.45, 6.6, { pos: [1.82, -0.62, -0.1] });
      addPair(A, 'body', sk);
    }

    // launcher: turntable (azimuth) + elevating 2x2 canister box
    A.node('launcher', [0, 0.45, 1.3], { axis: [0, 1, 0] });
    A.body(lathe([[0, 0], [1.1, 0], [1.1, 0.35], [0, 0.35]], L(20, 10, 6)).applyMatrix4(xform({ rx: -90, pos: [0, 0.4, 1.3] })), 'launcher');
    A.body(taperBox({ w0: 0.5, d0: 0.9, w1: 0.4, d1: 0.7, y0: 0.7, y1: 1.4, x: 1.1, z: 2.6 }), 'launcher');
    A.body(taperBox({ w0: 0.5, d0: 0.9, w1: 0.4, d1: 0.7, y0: 0.7, y1: 1.4, x: -1.1, z: 2.6 }), 'launcher');
    A.node('launcherArm', [0, 1.35, 2.6], { parent: 'launcher', axis: [1, 0, 0] });
    for (const x of [-0.42, 0.42])
      for (const y of [1.72, 2.52]) {
        const can = box(0.76, 0.76, 5.4, { pos: [x, y, 0.3] });
        A.body(can, 'launcherArm');
        const cap = box(0.6, 0.6, 0.04, { pos: [x, y, -2.42], zone: 1 });
        A.body(cap, 'launcherArm');
      }
    A.body(box(1.8, 0.2, 1.2, { pos: [0, 1.3, 2.3] }), 'launcherArm');
    A.control('launcher', (s) => (s.yaw ?? 0) * Math.PI);
    A.control('launcherArm', (s) => 0.55 + (s.pitch ?? 0) * 0.35);

    // radar mast on the cab
    A.metal(lathe([[0.05, 0], [0.04, 1.2], [0, 1.2]], L(8, 5, 3)).applyMatrix4(xform({ rx: -90, pos: [0.8, 1.25, -2.3] })));
    A.body(box(0.9, 0.5, 0.08, { pos: [0.8, 2.5, -2.3], zone: 5 }));
    // exhaust + stowage boxes
    A.body(box(0.5, 0.35, 1.4, { pos: [1.2, 0.55, 3.0] }));
    A.body(box(0.5, 0.35, 1.4, { pos: [-1.2, 0.55, 3.0] }));
    navLights(A, { left: [-1.3, 0.2, -3.9], right: [1.3, 0.2, -3.9], size: 0.06 });
    A.light([0, 0.2, 3.55], WHITE, { size: 0.05 });
    A.gun([0, 2.1, -2.0]);
    for (const x of [-0.42, 0.42]) for (const y of [1.72, 2.52]) A.hardpoint([x, y, -2.4]);
  }
};
