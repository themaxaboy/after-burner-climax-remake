// Modern guided-missile destroyer (~154 m), original procedural design
// inspired by contemporary 9000 t class ships. Waterline at y = 0.
// Named nodes: 'turret' (+ child 'gun'), 'radar'.

import { loft, lathe, taperBox, box, xform, addPair, applyMat, navLights, WHITE } from './common.js';
import { polyProfile } from '../loft.js';

const BOW = polyProfile([
  [0, -1],
  [0.12, -0.72],
  [0.36, -0.24],
  [0.72, 0.38],
  [1.0, 1.0],
  [0, 1.0]
]);
const MID = polyProfile([
  [0, -1],
  [0.55, -0.97],
  [0.82, -0.8],
  [0.88, -0.4],
  [0.91, 0.1],
  [0.96, 0.6],
  [1.0, 1.0],
  [0, 1.0]
]);
const STERN = polyProfile([
  [0, -1],
  [0.72, -0.95],
  [0.9, -0.6],
  [0.93, 0.0],
  [0.97, 0.6],
  [1.0, 1.0],
  [0, 1.0]
]);

export default {
  id: 'destroyer',
  name: 'Destroyer',
  kind: 'ship',
  defaultScheme: 'standard',
  glassTint: '#0c1216',
  livery: {
    panel: [5.0, 2.2],
    groove: 0.012,
    panelStrength: 0.6,
    sootRange: [1e9, 1e9 + 1, 0],
    waterline: [0.35, 1.05],
    antiGlare: [-80, 80, 10.6],
    antiGlareColor: '#50565b',
    camoScale: 0.05
  },
  schemes: { standard: 'navalHaze', enemy: 'navalHaze' },
  decals: [
    { tex: 'hull71', center: [0, 5.2, -58], size: [6.4, 3.2], axis: 'x', depth: 11 },
    { tex: 'emblemEnemy', center: [0, 11.5, 30], size: [3.2, 3.2], axis: 'x', depth: 8 }
  ],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    // hull
    A.body(
      loft(
        [
          { z: -74.5, width: 0.5, top: 9.8, bottom: 1.2, shape: BOW, rake: -0.55 },
          { z: -66, width: 8.0, top: 9.2, bottom: -3.2, shape: BOW },
          { z: -52, width: 15.0, top: 8.2, bottom: -5.2, shape: MID },
          { z: -32, width: 19.6, top: 7.4, bottom: -6.0, shape: MID },
          { z: 0, width: 20.4, top: 7.0, bottom: -6.2, shape: MID },
          { z: 32, width: 20.0, top: 6.8, bottom: -6.0, shape: MID },
          { z: 58, width: 18.6, top: 6.6, bottom: -4.2, shape: STERN },
          { z: 77, width: 16.8, top: 6.5, bottom: -0.8, shape: STERN }
        ],
        { radial: L(80, 40, 14), rings: L(170, 64, 14), crease: 32 }
      )
    );
    const deckY = (z) => (z < -52 ? 8.2 + ((-52 - z) / 22.5) * 1.6 : z < 0 ? 7.0 + (-z / 52) * 1.2 : 7.0 - (z / 77) * 0.5);

    // forward deckhouse + bridge
    A.body(taperBox({ w0: 16.0, d0: 26, w1: 13.2, d1: 22.5, y0: 6.6, y1: 15.5, x: 0, z: -17, zTop: 0.6 }));
    A.body(taperBox({ w0: 12.5, d0: 8.5, w1: 10.5, d1: 6.8, y0: 15.3, y1: 18.8, x: 0, z: -24.5, zTop: 0.4 }));
    // bridge wings
    A.body(taperBox({ w0: 18.5, d0: 2.6, w1: 18.5, d1: 2.6, y0: 16.2, y1: 16.9, x: 0, z: -26.8 }));
    // bridge windows (sloped glass strip)
    A.glass(taperBox({ w0: 10.3, d0: 0.3, w1: 9.2, d1: 0.3, y0: 17.0, y1: 18.1, x: 0, z: -28.62, zTop: 0.55 }));
    // phased-array faces (dark)
    for (const s of [1, -1]) {
      const p = box(4.4, 4.4, 0.3, { zone: 5 });
      applyMat(p, xform({ rx: -10, ry: -s * 40, pos: [s * 5.7, 12.2, -27.6] }));
      A.body(p);
      const q = box(4.0, 4.0, 0.3, { zone: 5 });
      applyMat(q, xform({ rx: 10, ry: s * 40, pos: [s * 5.4, 11.6, -5.6] }));
      A.body(q);
    }
    // mast + yard + radar
    A.body(taperBox({ w0: 3.4, d0: 3.4, w1: 1.2, d1: 1.2, y0: 18.6, y1: 32.0, x: 0, z: -10.5, zTop: 2.0 }));
    A.body(box(12.0, 0.35, 0.6, { pos: [0, 26.8, -9.4] }));
    A.metal(lathe([[0.12, 32.0], [0.06, 38.5], [0, 38.6]].map(([r, y]) => [r, y]), L(8, 5, 3)).applyMatrix4(xform({ rx: -90, pos: [0, 0, -8.5] })));
    A.node('radar', [0, 32.4, -8.6], { axis: [0, 1, 0] });
    A.body(box(6.2, 1.0, 0.28, { pos: [0, 32.9, -8.6], zone: 5 }), 'radar');
    A.metal(box(0.4, 0.6, 0.4, { pos: [0, 32.3, -8.6] }), 'radar');
    A.control('radar', (s) => (s.time ?? 0) * 2.4);

    // funnels
    for (const [z, y1] of [
      [2.0, 21.5],
      [26.0, 20.0]
    ]) {
      A.body(taperBox({ w0: 5.4, d0: 6.4, w1: 4.3, d1: 5.2, y0: 12.0, y1, x: 0, z, zTop: 0.8 }));
      A.body(box(3.6, 0.5, 4.2, { pos: [0, y1 + 0.2, z + 0.8], zone: 1 }));
    }
    // aft deckhouse + hangar
    A.body(taperBox({ w0: 15.0, d0: 27, w1: 12.6, d1: 24, y0: 6.3, y1: 13.8, x: 0, z: 27.5, zTop: -0.4 }));
    A.body(taperBox({ w0: 7.5, d0: 6, w1: 6.8, d1: 5, y0: 13.6, y1: 16.2, x: 0, z: 17 }));

    // VLS fields
    const vls = (zc, rows) => {
      const y = deckY(zc);
      A.body(box(7.6, 0.4, rows * 1.4 + 0.6, { pos: [0, y + 0.05, zc] }));
      if (A.lod === 0) {
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < rows; j++) A.body(box(1.5, 0.1, 1.15, { pos: [-2.7 + i * 1.8, y + 0.28, zc - (rows - 1) * 0.7 + j * 1.4], zone: 5 }));
      }
    };
    vls(-44, 8);
    vls(48, 6);

    // main gun turret (+ elevating barrel)
    const gy = deckY(-60);
    A.node('turret', [0, gy, -60], { axis: [0, 1, 0] });
    A.body(taperBox({ w0: 3.8, d0: 5.4, w1: 2.5, d1: 3.4, y0: gy - 0.2, y1: gy + 2.3, x: 0, z: -60, zTop: 0.5 }), 'turret');
    A.node('gun', [0, gy + 1.2, -61.8], { parent: 'turret', axis: [1, 0, 0] });
    const barrel = lathe(
      [
        [0.24, 0],
        [0.16, 0.5],
        [0.12, 6.8],
        [0.16, 7.1],
        [0.16, 7.5],
        { r: 0.07, z: 7.5, crease: true },
        [0.06, 7.2]
      ],
      L(12, 8, 5)
    );
    applyMat(barrel, xform({ ry: 180, pos: [0, gy + 1.2, -61.6] }));
    A.metal(barrel, 'gun');
    A.control('turret', (s) => (s.yaw ?? 0) * 1.5);
    A.control('gun', (s) => Math.max(0, s.pitch ?? 0) * 0.6);

    // CIWS mounts (white domes)
    for (const [z, y] of [
      [-29.8, 15.5],
      [39.5, 13.8]
    ]) {
      const c = lathe(
        [
          [0, 0],
          [0.95, 0],
          [0.95, 1.2],
          [0.8, 1.9],
          [0.45, 2.3],
          [0, 2.4]
        ],
        L(16, 10, 6),
        { zone: 4, crease: 45 }
      );
      applyMat(c, xform({ rx: -90, pos: [0, y, z] }));
      A.body(c);
    }
    // harpoon canisters
    if (A.lod < 2) {
      for (const s of [1, -1]) {
        const h = box(2.2, 1.0, 4.2);
        applyMat(h, xform({ ry: s * 30, rx: 12, pos: [s * 3.4, 14.5, 38.0] }));
        A.body(h);
      }
      // lifeboat canisters / RHIBs
      for (const z of [8, 14]) {
        const b = lathe(
          [
            [0, -2.2],
            [0.6, -1.6],
            [0.7, 1.6],
            [0, 2.2]
          ],
          L(10, 6, 4)
        );
        b.translate(7.6, 9.2, z);
        addPair(A, 'body', b);
      }
    }

    navLights(A, {
      left: [-9.2, 16.6, -26.8],
      right: [9.2, 16.6, -26.8],
      tail: [0, 7.4, 77.2],
      strobes: [],
      size: 0.35
    });
    A.light([0, 38.7, -8.5], WHITE, { size: 0.35 });
    A.gun([0, gy + 1.2, -69]);
    A.hardpoint([0, deckY(-44) + 1, -44]);
    A.hardpoint([0, deckY(48) + 1, 48]);
  }
};
