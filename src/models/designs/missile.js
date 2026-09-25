// AIM-120 / AIM-9-inspired air-to-air missile (original procedural design).
// Length 3.65 m, body diameter 0.178 m. Nose -Z. Motor glow uses the
// emissive material's uAfterburner uniform.

import { lathe, liftingSurface, xform, setGlow, FLAME } from './common.js';

const R = 0.089;
const Z0 = -1.825;
const Z1 = 1.825;

export default {
  id: 'missile',
  name: 'Missile (AAM)',
  kind: 'missile',
  defaultScheme: 'standard',
  livery: {
    panel: [0.9, 0.28],
    groove: 0.0012,
    sootRange: [1.6, 1.9, 0.2],
    camoScale: 1
  },
  schemes: { standard: 'missileWhite', enemy: 'missileWhite' },
  decals: [{ tex: 'stencil', center: [0, 0.0, 0.2], size: [0.5, 0.12], axis: 'x', depth: 0.12 }],

  build(A) {
    const L = (a, b, c) => A.L(a, b, c);
    const seg = L(32, 16, 8);
    const nose = [];
    const n = L(12, 6, 3);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      // tangent ogive
      const r = R * Math.sqrt(1 - (1 - t) * (1 - t));
      nose.push([r, Z0 + t * 0.42]);
    }
    nose[0] = [0, Z0];
    // body segments with coloured bands (zones)
    const pieces = [
      { prof: nose, zone: 2 },
      { prof: [[R, Z0 + 0.42], [R, -1.1]], zone: 0 },
      { prof: [[R, -1.1], [R, -1.03]], zone: 6 },
      { prof: [[R, -1.03], [R, 0.25]], zone: 0 },
      { prof: [[R, 0.25], [R, 0.32]], zone: 7 },
      { prof: [[R, 0.32], [R, 1.7], [R * 0.88, Z1], { r: R * 0.62, z: Z1, crease: true }, [R * 0.5, Z1 - 0.08]], zone: 0 }
    ];
    for (const p of pieces) A.body(lathe(p.prof, seg, { zone: p.zone, crease: 50 }));
    const glow = lathe(
      [
        [R * 0.5, Z1 - 0.079],
        [0, Z1 - 0.12]
      ],
      Math.max(6, seg >> 1)
    );
    setGlow(glow, FLAME, 1);
    A.emissive(glow);
    A.nozzle([0, 0, Z1], R * 0.6, [0, 0, 1]);

    // cruciform mid wings and tail control fins (X configuration)
    for (let k = 0; k < 4; k++) {
      const rz = 45 + k * 90;
      liftingSurface(A, {
        origin: [0, 0, 0],
        matrix: xform({ pos: [0, 0, 0], rz }).multiply(xform({ pos: [R * 0.9, 0, -0.35] })),
        rootChord: 0.52,
        tipChord: 0.1,
        span: 0.2,
        sweepDeg: 58,
        thicknessRatio: 0.05,
        chordSegments: L(6, 3, 2),
        spanSegments: 1,
        sharpLE: true
      });
      const finName = `fin${k}`;
      const pivot = [Math.cos((rz * Math.PI) / 180) * R, Math.sin((rz * Math.PI) / 180) * R, 1.45];
      A.node(finName, pivot, { axis: [Math.cos((rz * Math.PI) / 180), Math.sin((rz * Math.PI) / 180), 0] });
      liftingSurface(
        A,
        {
          origin: [0, 0, 0],
          matrix: xform({ pos: [0, 0, 0], rz }).multiply(xform({ pos: [R * 0.9, 0, 1.33] })),
          rootChord: 0.38,
          tipChord: 0.2,
          span: 0.19,
          sweepDeg: 38,
          thicknessRatio: 0.06,
          chordSegments: L(6, 3, 2),
          spanSegments: 1,
          sharpLE: true
        },
        [],
        { node: finName }
      );
      A.control(finName, (s) => ((k & 1 ? s.pitch : s.yaw) ?? 0) * 0.3 + (s.roll ?? 0) * 0.1);
    }
    A.gun([0, 0, Z0]);
    A.wingtip([0.25, 0, 1.6]);
    A.wingtip([-0.25, 0, 1.6]);
  }
};
