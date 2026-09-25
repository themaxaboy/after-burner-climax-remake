// Cross-section lofting and lathe (surface of revolution) generators.
//
// loft(stations, opts): closed fuselage / pod surface through cross-section
// stations placed along +Z (nose toward -Z). Each ring vertex is interpolated
// between stations with a monotone (Fritsch-Carlson limited) Catmull-Rom /
// Hermite spline in z, so shapes stay smooth without overshooting.
//
// station = {
//   z,                       // position along the axis (must be ascending)
//   width, height,           // full extents (or top/bottom instead of height)
//   yOffset|y, xOffset|x,    // centre of the section
//   shape,                   // superellipse exponent (2 = ellipse, 4+ = boxy),
//                            // {nTop, nBottom} or fn(angle) -> [x, y] in [-1, 1]
//   topScale, bottomScale,   // x scale at the top / bottom (trapezoid sections)
//   rake                     // dz per metre of y (raked intake lips)
// }
// uv = (angle / 2PI, normalized z). Angles start at the bottom (seam hidden).

import { BufferGeometry, Matrix4 } from 'three';
import { MeshBuilder, gridSurface, capFan, applyMat, TAU } from './geom.js';

export function superellipse(n = 2, nBottom = n) {
  return (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const e = s >= 0 ? 2 / n : 2 / nBottom;
    return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
  };
}

/**
 * Closed polygon profile (right half, from bottom centre to top centre, unit
 * coords) mirrored to the left; sampled by arc length so different stations
 * correspond point-to-point. Good for ship hulls / chined stealth sections.
 */
export function polyProfile(halfPts) {
  // build full loop: bottom centre -> right half -> top centre -> left half (mirrored) -> back
  const pts = halfPts.slice();
  for (let i = halfPts.length - 2; i >= 1; i--) pts.push([-halfPts[i][0], halfPts[i][1]]);
  const n = pts.length;
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[n];
  // arc length of the right half (index 0 .. halfPts.length-1)
  const halfLen = cum[halfPts.length - 1];
  return (a) => {
    // angle -PI/2 (bottom) .. PI/2 (top) maps to right half, rest to left half
    let t = (a + Math.PI / 2) / TAU;
    t -= Math.floor(t);
    const target = t < 0.5 ? (t / 0.5) * halfLen : halfLen + ((t - 0.5) / 0.5) * (total - halfLen);
    let i = 0;
    while (i < n - 1 && cum[i + 1] < target) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const u = (target - cum[i]) / seg;
    const p = pts[i];
    const q = pts[(i + 1) % n];
    return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  };
}

/**
 * Thin curved band (e.g. airliner windscreen / window strip) lying on a unit
 * ellipse between angles a0..a1 (radians, 0 = +x, PI/2 = top). The loop runs
 * along the outer arc and back along an inner arc (1 - thickness).
 */
export function bandProfile(a0, a1, thickness = 0.02) {
  return (a) => {
    let t = (a + Math.PI / 2) / TAU;
    t -= Math.floor(t);
    if (t < 0.5) {
      const u = a0 + (a1 - a0) * (t / 0.5);
      return [Math.cos(u), Math.sin(u)];
    }
    const u = a1 + (a0 - a1) * ((t - 0.5) / 0.5);
    const r = 1 - thickness;
    return [Math.cos(u) * r, Math.sin(u) * r];
  };
}

function evalShape(shape, a) {
  if (typeof shape === 'function') return shape(a);
  let n = 2;
  let nb = 2;
  if (typeof shape === 'number') n = nb = shape;
  else if (shape && typeof shape === 'object') {
    n = shape.nTop ?? shape.n ?? 2;
    nb = shape.nBottom ?? shape.n ?? 2;
  }
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = s >= 0 ? 2 / n : 2 / nb;
  return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
}

function normStation(st) {
  let w = st.width ?? st.w ?? 0;
  let h = st.height ?? st.h ?? w;
  let y = st.yOffset ?? st.y ?? 0;
  if (st.top !== undefined && st.bottom !== undefined) {
    h = st.top - st.bottom;
    y = (st.top + st.bottom) / 2;
  }
  return {
    z: st.z,
    w,
    h,
    y,
    x: st.xOffset ?? st.x ?? 0,
    shape: st.shape ?? 2,
    ts: st.topScale ?? 1,
    bs: st.bottomScale ?? 1,
    rake: st.rake ?? 0
  };
}

function monotoneTangents(z, v, n, out, startBoost, endBoost) {
  const d = new Float64Array(Math.max(n - 1, 1));
  for (let i = 0; i < n - 1; i++) d[i] = (v[i + 1] - v[i]) / (z[i + 1] - z[i] || 1e-9);
  if (n === 1) {
    out[0] = 0;
    return;
  }
  out[0] = d[0] * startBoost;
  out[n - 1] = d[n - 2] * endBoost;
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      out[i] = 0;
      continue;
    }
    let m = (v[i + 1] - v[i - 1]) / (z[i + 1] - z[i - 1]);
    const a = m / d[i - 1];
    const b = m / d[i];
    if (a > 3) m = 3 * d[i - 1];
    if (b > 3 && Math.abs(3 * d[i]) < Math.abs(m)) m = 3 * d[i];
    out[i] = m;
  }
}

/**
 * @param {Array} stationsIn
 * @param {object} opts { radial=32, rings=40, capStart='auto'|'flat'|'none'|'round'|{inset,depth},
 *   capEnd, crease (deg) | creaseCols (Set), zone, builder (MeshBuilder to append to), noseBoost }
 */
export function loft(stationsIn, opts = {}) {
  const own = !opts.builder;
  const mb = opts.builder || new MeshBuilder(1024, 4096);
  const prevZone = mb.curZone;
  if (opts.zone !== undefined) mb.curZone = opts.zone;
  loftInto(mb, stationsIn, opts);
  mb.curZone = prevZone;
  return own ? mb.toGeometry() : null;
}

function loftInto(mb, stationsIn, opts) {
  const radial = Math.max(3, opts.radial ?? 32);
  const ringsWanted = Math.max(1, opts.rings ?? 40);
  const st = stationsIn.map(normStation);
  const N = st.length;
  if (N < 2) throw new Error('loft: need at least 2 stations');
  const capStart = opts.capStart ?? 'auto';
  const capEnd = opts.capEnd ?? 'auto';
  const roundStart = capStart === 'round';
  const roundEnd = capEnd === 'round';

  // --- ring points per station -------------------------------------------
  const SX = [];
  const SY = [];
  const ang = new Float64Array(radial);
  for (let j = 0; j < radial; j++) ang[j] = -Math.PI / 2 + (TAU * j) / radial;
  for (let s = 0; s < N; s++) {
    const S = st[s];
    const xs = new Float64Array(radial);
    const ys = new Float64Array(radial);
    for (let j = 0; j < radial; j++) {
      const p = evalShape(S.shape, ang[j]);
      const k = p[1] > 0 ? 1 + (S.ts - 1) * p[1] : 1 + (S.bs - 1) * -p[1];
      xs[j] = S.x + p[0] * S.w * 0.5 * k;
      ys[j] = S.y + p[1] * S.h * 0.5;
    }
    SX.push(xs);
    SY.push(ys);
  }
  const Z = st.map((s) => s.z);
  const poleStart = roundStart || (st[0].w < 1e-6 && st[0].h < 1e-6);
  const poleEnd = roundEnd || (st[N - 1].w < 1e-6 && st[N - 1].h < 1e-6);
  const boost0 = poleStart ? (opts.noseBoost ?? 1.7) : 1;
  const boost1 = poleEnd ? (opts.tailBoost ?? 1.4) : 1;

  // tangents per column
  const MX = [];
  const MY = [];
  const colX = new Float64Array(N);
  const colY = new Float64Array(N);
  for (let s = 0; s < N; s++) {
    MX.push(new Float64Array(radial));
    MY.push(new Float64Array(radial));
  }
  const tx = new Float64Array(N);
  const ty = new Float64Array(N);
  for (let j = 0; j < radial; j++) {
    for (let s = 0; s < N; s++) {
      colX[s] = SX[s][j];
      colY[s] = SY[s][j];
    }
    monotoneTangents(Z, colX, N, tx, boost0, boost1);
    monotoneTangents(Z, colY, N, ty, boost0, boost1);
    for (let s = 0; s < N; s++) {
      MX[s][j] = tx[s];
      MY[s][j] = ty[s];
    }
  }
  if (roundStart && N > 2) for (let j = 0; j < radial; j++) (MX[1][j] = 0), (MY[1][j] = 0);
  if (roundEnd && N > 2) for (let j = 0; j < radial; j++) (MX[N - 2][j] = 0), (MY[N - 2][j] = 0);

  // --- ring distribution ---------------------------------------------------
  const meas = new Float64Array(N - 1);
  let total = 0;
  for (let s = 0; s < N - 1; s++) {
    const a = st[s];
    const b = st[s + 1];
    const dz = b.z - a.z;
    let m = Math.sqrt(dz * dz + 2.2 * ((b.w - a.w) ** 2 + (b.h - a.h) ** 2 + (b.y - a.y) ** 2 + (b.x - a.x) ** 2));
    if ((s === 0 && roundStart) || (s === N - 2 && roundEnd)) m *= 1.35;
    meas[s] = m;
    total += m;
  }
  const counts = new Int32Array(N - 1);
  for (let s = 0; s < N - 1; s++) counts[s] = Math.max(1, Math.round((ringsWanted * meas[s]) / (total || 1)));

  const rows = [];
  const rowV = [];
  const zMin = Z[0];
  const zSpan = Z[N - 1] - Z[0] || 1;
  const pushRow = (s, t, round) => {
    const a = st[s];
    const b = st[s + 1];
    const h = b.z - a.z;
    const row = new Float64Array(radial * 3);
    let z;
    if (round === 'start') {
      // quarter-ellipse dome from the tip (station s) to station s+1
      const phi = t * (Math.PI / 2);
      const sc = Math.sin(phi);
      const tt = 1 - Math.cos(phi);
      z = a.z + h * tt;
      const cx = a.x + (b.x - a.x) * tt;
      const cy = a.y + (b.y - a.y) * tt;
      for (let j = 0; j < radial; j++) {
        row[j * 3] = cx + (SX[s + 1][j] - b.x) * sc;
        row[j * 3 + 1] = cy + (SY[s + 1][j] - b.y) * sc;
        row[j * 3 + 2] = z;
      }
    } else if (round === 'end') {
      const phi = t * (Math.PI / 2);
      const sc = Math.cos(phi);
      const tt = Math.sin(phi);
      z = a.z + h * tt;
      const cx = a.x + (b.x - a.x) * tt;
      const cy = a.y + (b.y - a.y) * tt;
      for (let j = 0; j < radial; j++) {
        row[j * 3] = cx + (SX[s][j] - a.x) * sc;
        row[j * 3 + 1] = cy + (SY[s][j] - a.y) * sc;
        row[j * 3 + 2] = z;
      }
    } else {
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      z = a.z + h * t;
      const rake = a.rake + (b.rake - a.rake) * t;
      const yc = a.y + (b.y - a.y) * t;
      const X0 = SX[s];
      const X1 = SX[s + 1];
      const Y0 = SY[s];
      const Y1 = SY[s + 1];
      const MX0 = MX[s];
      const MX1 = MX[s + 1];
      const MY0 = MY[s];
      const MY1 = MY[s + 1];
      for (let j = 0; j < radial; j++) {
        const x = h00 * X0[j] + h10 * h * MX0[j] + h01 * X1[j] + h11 * h * MX1[j];
        const y = h00 * Y0[j] + h10 * h * MY0[j] + h01 * Y1[j] + h11 * h * MY1[j];
        row[j * 3] = x;
        row[j * 3 + 1] = y;
        row[j * 3 + 2] = z + rake * (y - yc);
      }
    }
    rows.push(row);
    rowV.push((z - zMin) / zSpan);
  };
  for (let s = 0; s < N - 1; s++) {
    const round = s === 0 && roundStart ? 'start' : s === N - 2 && roundEnd ? 'end' : null;
    for (let k = 0; k < counts[s]; k++) pushRow(s, k / counts[s], round);
  }
  pushRow(N - 2, 1, roundEnd ? 'end' : null);
  if (poleStart) {
    // collapse first row exactly to a point
    const r = rows[0];
    for (let j = 1; j < radial; j++) {
      r[j * 3] = r[0];
      r[j * 3 + 1] = r[1];
      r[j * 3 + 2] = r[2];
    }
  }
  if (poleEnd) {
    const r = rows[rows.length - 1];
    for (let j = 1; j < radial; j++) {
      r[j * 3] = r[0];
      r[j * 3 + 1] = r[1];
      r[j * 3 + 2] = r[2];
    }
  }

  // --- creases ------------------------------------------------------------
  let creaseCols = opts.creaseCols || null;
  if (!creaseCols && opts.crease) {
    creaseCols = new Set();
    const thr = Math.cos((opts.crease * Math.PI) / 180);
    const sample = [];
    for (let r = 1; r < rows.length - 1; r += Math.max(1, Math.floor(rows.length / 9))) sample.push(r);
    for (let j = 0; j < radial; j++) {
      let votes = 0;
      for (const r of sample) {
        const R = rows[r];
        const jp = (j + radial - 1) % radial;
        const jn = (j + 1) % radial;
        const ax = R[j * 3] - R[jp * 3];
        const ay = R[j * 3 + 1] - R[jp * 3 + 1];
        const bx = R[jn * 3] - R[j * 3];
        const by = R[jn * 3 + 1] - R[j * 3 + 1];
        const la = Math.hypot(ax, ay);
        const lb = Math.hypot(bx, by);
        if (la < 1e-9 || lb < 1e-9) continue;
        if ((ax * bx + ay * by) / (la * lb) < thr) votes++;
      }
      if (votes * 2 > sample.length) creaseCols.add(j);
    }
  }

  gridSurface(mb, rows, radial, {
    wrap: true,
    creaseCols,
    u: (c) => c / radial,
    v: (r) => rowV[r]
  });

  // --- caps -----------------------------------------------------------------
  if (!poleStart && capStart !== 'none') {
    if (typeof capStart === 'object') intake(mb, rows[0], radial, capStart);
    else capFan(mb, rows[0], radial, 0, 0, -1, true);
  }
  if (!poleEnd && capEnd !== 'none') {
    if (typeof capEnd === 'object') intake(mb, rows[rows.length - 1], radial, { ...capEnd, reverse: true });
    else capFan(mb, rows[rows.length - 1], radial, 0, 0, 1, false);
  }
}

/** Hollow intake mouth: rounded lip + dark inner duct + dark back cap. */
function intake(mb, ring, radial, { lip = 0.05, depth = 1.5, shrink = 0.92, reverse = false }) {
  const dir = reverse ? -1 : 1; // duct goes toward +z for a front intake
  const O = ring;
  const M = new Float64Array(radial * 3);
  const I = new Float64Array(radial * 3);
  const B = new Float64Array(radial * 3);
  let cx = 0;
  let cy = 0;
  for (let j = 0; j < radial; j++) {
    cx += O[j * 3];
    cy += O[j * 3 + 1];
  }
  cx /= radial;
  cy /= radial;
  for (let j = 0; j < radial; j++) {
    const jp = (j + radial - 1) % radial;
    const jn = (j + 1) % radial;
    const tx = O[jn * 3] - O[jp * 3];
    const ty = O[jn * 3 + 1] - O[jp * 3 + 1];
    const l = Math.hypot(tx, ty) || 1;
    const nx = ty / l;
    const ny = -tx / l;
    const x = O[j * 3];
    const y = O[j * 3 + 1];
    const z = O[j * 3 + 2];
    M[j * 3] = x - nx * lip * 0.5;
    M[j * 3 + 1] = y - ny * lip * 0.5;
    M[j * 3 + 2] = z - dir * lip * 0.4;
    I[j * 3] = x - nx * lip;
    I[j * 3 + 1] = y - ny * lip;
    I[j * 3 + 2] = z + dir * lip * 0.2;
    B[j * 3] = cx + (I[j * 3] - cx) * shrink;
    B[j * 3 + 1] = cy + (I[j * 3 + 1] - cy) * shrink;
    B[j * 3 + 2] = z + dir * depth;
  }
  gridSurface(mb, [O, M, I], radial, { wrap: true, flip: !reverse });
  const z0 = mb.curZone;
  mb.curZone = 1;
  gridSurface(mb, [I, B], radial, { wrap: true, flip: !reverse });
  capFan(mb, B, radial, 0, 0, -dir, !reverse);
  mb.curZone = z0;
}

/**
 * Surface of revolution about the Z axis.
 * profile: [[r, z], ...] or [{r, z, crease}] - traverse +z for outward normals
 * (traverse -z for inner surfaces). Sharp corners split automatically above
 * `crease` degrees (default 40).
 * opts: { crease, center:[x,y], phiStart, phiLength, zone, builder, scaleY }
 */
export function lathe(profile, segments = 24, opts = {}) {
  const own = !opts.builder;
  const mb = opts.builder || new MeshBuilder(256, 1024);
  const prevZone = mb.curZone;
  if (opts.zone !== undefined) mb.curZone = opts.zone;
  const P = profile.map((p) => (Array.isArray(p) ? { r: p[0], z: p[1], crease: false } : p));
  const thr = Math.cos(((opts.crease ?? 40) * Math.PI) / 180);
  const [cx, cy] = opts.center || [0, 0];
  const sy = opts.scaleY ?? 1;
  const full = opts.phiLength === undefined || opts.phiLength >= TAU - 1e-6;
  const phi0 = opts.phiStart ?? -Math.PI / 2;
  const phiL = opts.phiLength ?? TAU;
  const nCols = full ? segments : segments + 1;

  // split into smooth runs
  const runs = [];
  let cur = [P[0]];
  for (let i = 1; i < P.length; i++) {
    cur.push(P[i]);
    if (i < P.length - 1) {
      const a = P[i - 1];
      const b = P[i];
      const c = P[i + 1];
      const ux = b.r - a.r;
      const uz = b.z - a.z;
      const vx = c.r - b.r;
      const vz = c.z - b.z;
      const lu = Math.hypot(ux, uz);
      const lv = Math.hypot(vx, vz);
      const sharp = b.crease || (lu > 1e-9 && lv > 1e-9 && (ux * vx + uz * vz) / (lu * lv) < thr);
      if (sharp) {
        runs.push(cur);
        cur = [P[i]];
      }
    }
  }
  runs.push(cur);

  // total length for v
  let totalLen = 0;
  for (let i = 1; i < P.length; i++) totalLen += Math.hypot(P[i].r - P[i - 1].r, P[i].z - P[i - 1].z);
  totalLen = totalLen || 1;
  let acc = 0;
  for (const run of runs) {
    if (run.length < 2) continue;
    const rows = [];
    const vs = [];
    for (let i = 0; i < run.length; i++) {
      if (i > 0) acc += Math.hypot(run[i].r - run[i - 1].r, run[i].z - run[i - 1].z);
      vs.push(acc / totalLen);
      const row = new Float64Array(nCols * 3);
      for (let j = 0; j < nCols; j++) {
        const phi = phi0 + (phiL * j) / segments;
        row[j * 3] = cx + run[i].r * Math.cos(phi);
        row[j * 3 + 1] = cy + run[i].r * Math.sin(phi) * sy;
        row[j * 3 + 2] = run[i].z;
      }
      rows.push(row);
    }
    gridSurface(mb, rows, nCols, {
      wrap: full,
      u: (c) => c / segments,
      v: (r) => vs[r]
    });
  }
  mb.curZone = prevZone;
  return own ? mb.toGeometry() : null;
}

/** Ellipsoid / capsule-ish blob via lathe (axis Z). */
export function ellipsoid(rx, ry, rz, segments = 16, rings = 10, opts = {}) {
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const t = (i / rings) * Math.PI;
    prof.push([Math.sin(t) * rx, -Math.cos(t) * rz]);
  }
  const g = lathe(prof, segments, { ...opts, crease: 179 });
  if (ry !== rx) applyMat(g, new Matrix4().makeScale(1, ry / rx, 1));
  return g;
}

/** Simple capped cylinder / frustum along Z. */
export function cylinder(r0, r1, len, segments = 12, opts = {}) {
  const h = len / 2;
  return lathe(
    [
      [0, -h],
      [r0, -h],
      [r1, h],
      [0, h]
    ],
    segments,
    opts
  );
}

export function emptyGeometry() {
  return new BufferGeometry();
}
