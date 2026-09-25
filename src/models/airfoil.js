// Lifting-surface generator: wings, stabilators, fins, canards, control
// surfaces. Symmetric NACA 4-digit sections, rounded leading edge, crisp
// trailing edge, flat tip/root caps.
//
// Wing-local frame (before `matrix`): span along +X from the root, chord
// along +Z (leading edge first), thickness along Y. `origin` is the root
// leading-edge point. The optional `matrix` (Matrix4) is applied afterwards
// (e.g. rotate 90deg about Z for a vertical fin), then `mirror` duplicates the
// part across the aircraft plane x = 0.

import { Matrix4, Vector3 } from 'three';
import { MeshBuilder, gridSurface, capFan, applyMat, DEG } from './geom.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** NACA 00xx half thickness for unit thickness ratio (closed trailing edge). */
export function nacaHalf(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 0;
  return 5 * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
}

function planform(o) {
  if (o.planform) {
    // [{x, zLE, chord, t?, y?}] ascending x (relative to origin)
    return o.planform.map((p) => ({ x: p.x, z: p.zLE, c: p.chord, t: p.t ?? o.thicknessRatio ?? 0.06, y: p.y ?? null }));
  }
  const span = o.span;
  const tanS = Math.tan((o.sweepDeg ?? 0) * DEG);
  return [
    { x: 0, z: 0, c: o.rootChord, t: o.thicknessRatio ?? 0.06, y: null },
    { x: span, z: span * tanS, c: o.tipChord ?? o.rootChord, t: o.tipThicknessRatio ?? o.thicknessRatio ?? 0.06, y: null }
  ];
}

function sectionAt(pf, o, s) {
  // s: fraction of total span (0 root .. 1 tip)
  const span = pf[pf.length - 1].x - pf[0].x;
  const x = pf[0].x + s * span;
  let i = 0;
  while (i < pf.length - 2 && pf[i + 1].x < x) i++;
  const a = pf[i];
  const b = pf[i + 1];
  const u = (x - a.x) / (b.x - a.x || 1);
  const dih = Math.tan((o.dihedralDeg ?? 0) * DEG);
  let y = x * dih;
  if (a.y !== null && b.y !== null) y = a.y + (b.y - a.y) * u;
  return {
    x,
    z: a.z + (b.z - a.z) * u,
    c: a.c + (b.c - a.c) * u,
    t: a.t + (b.t - a.t) * u,
    y,
    tw: (o.twistDeg ?? 0) * DEG * s
  };
}

function chordSamples(c0, c1, n, clusterLE) {
  const xs = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    if (clusterLE) xs.push(c0 + (c1 - c0) * (1 - Math.cos((u * Math.PI) / 2)) ** 1.0);
    else {
      // mild clustering toward both ends for smooth curvature
      xs.push(c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(u * Math.PI)) * 0.5 + (c1 - c0) * u * 0.5);
    }
  }
  return xs;
}

/** Build the section loop description: segments of [xc, yn, kx] entries. */
function loopSegments(c0, c1, n, sharpLE) {
  const segs = [];
  if (c0 <= 1e-6) {
    // blunt nose uses cosine clustering; keep more points near LE
    const xs = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      xs.push(c1 * (1 - Math.cos((u * Math.PI) / 2)) ** 1.6);
    }
    const upper = [];
    for (let k = n; k >= 0; k--) upper.push([xs[k], nacaHalf(xs[k]), 0]);
    const lower = [];
    for (let k = 0; k <= n; k++) lower.push([xs[k], -nacaHalf(xs[k]), 0]);
    if (sharpLE) segs.push(upper, lower);
    else segs.push(upper.concat(lower.slice(1)));
  } else {
    const h0 = nacaHalf(c0);
    const xs = chordSamples(c0, c1, Math.max(1, n - 2), false);
    const upper = [];
    for (let k = xs.length - 1; k >= 0; k--) upper.push([xs[k], nacaHalf(xs[k]), 0]);
    const arc = [];
    const K = n >= 6 ? 4 : 2;
    for (let k = 1; k < K; k++) {
      const a = Math.PI / 2 - (Math.PI * k) / K;
      arc.push([c0, Math.sin(a) * h0, Math.cos(a) * h0 * 0.9]);
    }
    const lower = [];
    for (let k = 0; k < xs.length; k++) lower.push([xs[k], -nacaHalf(xs[k]), 0]);
    segs.push(upper.concat(arc, lower));
  }
  if (c1 < 1 - 1e-6) {
    const h = nacaHalf(c1);
    segs.push([
      [c1, -h, 0],
      [c1, h, 0]
    ]);
  }
  return segs;
}

function sectionPoint(sec, e, out, off = 0) {
  const zc = (e[0] - e[2] * sec.t) * sec.c;
  const yc = e[1] * sec.t * sec.c;
  // twist about quarter chord
  const q = 0.25 * sec.c;
  const cz = zc - q;
  const ct = Math.cos(sec.tw);
  const st = Math.sin(sec.tw);
  out[off] = sec.x;
  out[off + 1] = sec.y + yc * ct + cz * st;
  out[off + 2] = sec.z + q + cz * ct - yc * st;
}

/**
 * Emit (right side) wing piece into a MeshBuilder.
 * o: { rootChord, tipChord, span, sweepDeg, dihedralDeg, thicknessRatio, tipThicknessRatio,
 *      twistDeg, chordSegments, spanSegments, spanRange:[s0,s1], chordRange:[c0,c1],
 *      rootCap, tipCap, sharpLE, planform, origin:[x,y,z] }
 */
export function wingInto(mb, o) {
  const pf = planform(o);
  const [s0, s1] = o.spanRange ?? [0, 1];
  const [c0, c1] = o.chordRange ?? [0, 1];
  const nC = Math.max(2, o.chordSegments ?? 12);
  const nS = Math.max(1, o.spanSegments ?? 6);
  const org = o.origin ?? [0, 0, 0];
  const segs = loopSegments(c0, c1, nC, !!o.sharpLE);

  // span stations: uniform plus planform break points
  const span = pf[pf.length - 1].x - pf[0].x;
  const ss = [];
  for (let k = 0; k <= nS; k++) ss.push(s0 + ((s1 - s0) * k) / nS);
  for (const p of pf) {
    const s = (p.x - pf[0].x) / span;
    if (s > s0 + 1e-4 && s < s1 - 1e-4) ss.push(s);
  }
  ss.sort((a, b) => a - b);
  const secs = ss.map((s) => sectionAt(pf, o, s));

  const tmp = new Float64Array(3);
  for (const seg of segs) {
    const rows = [];
    for (const sec of secs) {
      const row = new Float64Array(seg.length * 3);
      for (let k = 0; k < seg.length; k++) {
        sectionPoint(sec, seg[k], tmp);
        row[k * 3] = tmp[0] + org[0];
        row[k * 3 + 1] = tmp[1] + org[1];
        row[k * 3 + 2] = tmp[2] + org[2];
      }
      rows.push(row);
    }
    gridSurface(mb, rows, seg.length, {
      flip: true,
      u: (c) => c / (seg.length - 1),
      v: (r) => ss[r]
    });
  }

  const capRing = (sec) => {
    const pts = [];
    for (const seg of segs) {
      for (const e of seg) {
        sectionPoint(sec, e, tmp);
        const x = tmp[0] + org[0];
        const y = tmp[1] + org[1];
        const z = tmp[2] + org[2];
        const L = pts.length;
        if (L && Math.abs(pts[L - 3] - x) + Math.abs(pts[L - 2] - y) + Math.abs(pts[L - 1] - z) < 1e-7) continue;
        pts.push(x, y, z);
      }
    }
    // drop closing duplicate
    const L = pts.length;
    if (L > 6 && Math.abs(pts[0] - pts[L - 3]) + Math.abs(pts[1] - pts[L - 2]) + Math.abs(pts[2] - pts[L - 1]) < 1e-7) pts.length = L - 3;
    return Float64Array.from(pts);
  };
  if (o.tipCap !== false) {
    const r = capRing(secs[secs.length - 1]);
    capFan(mb, r, r.length / 3, 1, 0, 0, true);
  }
  if (o.rootCap) {
    const r = capRing(secs[0]);
    capFan(mb, r, r.length / 3, -1, 0, 0, false);
  }
}

/** Point on the (unmirrored, untransformed) wing: span fraction s, chord fraction xc, thickness fraction yn (-1..1). */
export function wingPoint(o, s, xc, yn = 0) {
  const pf = planform(o);
  const sec = sectionAt(pf, o, s);
  const org = o.origin ?? [0, 0, 0];
  const out = new Float64Array(3);
  sectionPoint(sec, [xc, yn * nacaHalf(Math.min(Math.max(xc, 0.001), 0.999)), 0], out);
  return new Vector3(out[0] + org[0], out[1] + org[1], out[2] + org[2]);
}

function finish(geom, o) {
  if (o.matrix) applyMat(geom, o.matrix);
  if (o.mirror) {
    const m = geom.clone();
    applyMat(m, new Matrix4().makeScale(-1, 1, 1));
    const merged = mergeGeometries([geom, m], false);
    geom.dispose();
    m.dispose();
    return merged;
  }
  return geom;
}

/** Build a wing / tail / canard geometry (see wingInto for options, plus matrix & mirror). */
export function wing(o) {
  const mb = new MeshBuilder(512, 2048);
  if (o.zone !== undefined) mb.curZone = o.zone;
  wingInto(mb, o);
  return finish(mb.toGeometry(), o);
}

/**
 * Wing with movable control surfaces cut out of the trailing edge.
 * surfaces: [{ name, span:[s0,s1], chord: hingeFraction, gap? }]
 * Returns { fixed: geometry (mirrored if o.mirror),
 *           surfaces: [{ name: name+'R'|'L', geometry, a: Vector3, b: Vector3, side: 1|-1 }] }
 * hinge axis a->b points outboard on the right side and is mirrored on the left
 * (both expressed so that a positive rotation about (b-a) on the right equals
 * trailing-edge-down when the axis is re-oriented by the caller).
 * When `split` is false the whole wing is returned fixed (low LOD).
 */
export function wingSet(o, surfaces = [], split = true) {
  const mb = new MeshBuilder(1024, 4096);
  if (o.zone !== undefined) mb.curZone = o.zone;
  const out = { fixed: null, surfaces: [] };
  const [S0, S1] = o.spanRange ?? [0, 1];
  if (!split || surfaces.length === 0) {
    wingInto(mb, o);
    out.fixed = finish(mb.toGeometry(), o);
    return out;
  }
  const sorted = surfaces.slice().sort((a, b) => a.span[0] - b.span[0]);
  const nS = o.spanSegments ?? 6;
  const pieceSeg = (a, b) => Math.max(1, Math.round((nS * (b - a)) / (S1 - S0)));
  let cursor = S0;
  const pieces = [];
  for (const sfc of sorted) {
    if (sfc.span[0] > cursor + 1e-4) pieces.push({ span: [cursor, sfc.span[0]], chord: [0, 1] });
    pieces.push({ span: [sfc.span[0], sfc.span[1]], chord: [0, sfc.chord] });
    cursor = sfc.span[1];
  }
  if (cursor < S1 - 1e-4) pieces.push({ span: [cursor, S1], chord: [0, 1] });
  pieces.forEach((p, i) => {
    wingInto(mb, {
      ...o,
      spanRange: p.span,
      chordRange: p.chord,
      spanSegments: pieceSeg(p.span[0], p.span[1]),
      rootCap: i === 0 ? !!o.rootCap : p.chord[1] > 0.999,
      tipCap: i === pieces.length - 1 ? o.tipCap !== false : p.chord[1] > 0.999
    });
  });
  out.fixed = finish(mb.toGeometry(), o);

  for (const sfc of sorted) {
    const gap = sfc.gap ?? 0.012;
    const spanGap = sfc.spanGap ?? 0.004;
    const so = {
      ...o,
      spanRange: [sfc.span[0] + spanGap, sfc.span[1] - spanGap],
      chordRange: [sfc.chord + gap, 1],
      chordSegments: Math.max(3, Math.round((o.chordSegments ?? 12) * 0.6)),
      spanSegments: pieceSeg(sfc.span[0], sfc.span[1]),
      rootCap: true,
      tipCap: true,
      mirror: false,
      matrix: null
    };
    const smb = new MeshBuilder(256, 1024);
    if (o.zone !== undefined) smb.curZone = o.zone;
    wingInto(smb, so);
    const gR = smb.toGeometry();
    const hc = sfc.chord + gap;
    const a = wingPoint(o, sfc.span[0], hc, 0);
    const b = wingPoint(o, sfc.span[1], hc, 0);
    if (o.matrix) {
      applyMat(gR, o.matrix);
      a.applyMatrix4(o.matrix);
      b.applyMatrix4(o.matrix);
    }
    out.surfaces.push({ name: sfc.name + 'R', geometry: gR, a, b, side: 1 });
    if (o.mirror) {
      const gL = gR.clone();
      applyMat(gL, new Matrix4().makeScale(-1, 1, 1));
      out.surfaces.push({
        name: sfc.name + 'L',
        geometry: gL,
        a: new Vector3(-a.x, a.y, a.z),
        b: new Vector3(-b.x, b.y, b.z),
        side: -1
      });
    }
  }
  return out;
}
