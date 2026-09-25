// Low-level geometry helpers shared by the procedural model generators.
//
// Everything writes into a growable MeshBuilder (typed arrays, no per-vertex
// objects) and produces indexed BufferGeometry with position / normal / uv and
// an `aZone` float attribute (paint zone id consumed by the livery shader).

import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export class MeshBuilder {
  constructor(vCap = 1024, iCap = 4096) {
    this.pos = new Float32Array(vCap * 3);
    this.nrm = new Float32Array(vCap * 3);
    this.uv = new Float32Array(vCap * 2);
    this.zone = new Float32Array(vCap);
    this.idx = new Uint32Array(iCap);
    this.vCount = 0;
    this.iCount = 0;
    this.curZone = 0;
    // Mirror across x=0 (flips winding) - lets generators emit left copies cheaply.
    this.sx = 1;
  }

  _growV(n) {
    const need = this.vCount + n;
    if (need <= this.zone.length) return;
    let cap = this.zone.length * 2;
    while (cap < need) cap *= 2;
    const grow = (a, k) => {
      const b = new Float32Array(cap * k);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.nrm = grow(this.nrm, 3);
    this.uv = grow(this.uv, 2);
    this.zone = grow(this.zone, 1);
  }

  _growI(n) {
    const need = this.iCount + n;
    if (need <= this.idx.length) return;
    let cap = this.idx.length * 2;
    while (cap < need) cap *= 2;
    const b = new Uint32Array(cap);
    b.set(this.idx);
    this.idx = b;
  }

  reserve(nv, ni) {
    this._growV(nv);
    this._growI(ni);
  }

  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    if (this.vCount >= this.zone.length) this._growV(1);
    const i = this.vCount++;
    const s = this.sx;
    this.pos[i * 3] = x * s;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.nrm[i * 3] = nx * s;
    this.nrm[i * 3 + 1] = ny;
    this.nrm[i * 3 + 2] = nz;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.zone[i] = this.curZone;
    return i;
  }

  tri(a, b, c) {
    if (this.iCount + 3 > this.idx.length) this._growI(3);
    const I = this.idx;
    if (this.sx < 0) {
      I[this.iCount++] = a;
      I[this.iCount++] = c;
      I[this.iCount++] = b;
    } else {
      I[this.iCount++] = a;
      I[this.iCount++] = b;
      I[this.iCount++] = c;
    }
  }

  toGeometry() {
    const g = new BufferGeometry();
    const n = this.vCount;
    g.setAttribute('position', new BufferAttribute(this.pos.slice(0, n * 3), 3));
    g.setAttribute('normal', new BufferAttribute(this.nrm.slice(0, n * 3), 3));
    g.setAttribute('uv', new BufferAttribute(this.uv.slice(0, n * 2), 2));
    g.setAttribute('aZone', new BufferAttribute(this.zone.slice(0, n), 1));
    const idx = n > 65535 ? this.idx.slice(0, this.iCount) : Uint16Array.from(this.idx.subarray(0, this.iCount));
    g.setIndex(new BufferAttribute(idx, 1));
    return g;
  }
}

/**
 * Emit a rectangular grid surface.
 * rows: array of Float64Array(nCols*3) point rows. Normals come from central
 * differences (one-sided at open ends / crease columns). Degenerate rows
 * (poles) borrow the neighbour row's normal and skip zero-area triangles.
 * opts: wrap (columns form a closed loop; a seam column is duplicated for uv),
 *       flip (reverse orientation), creaseCols (Set of col indices whose
 *       vertex is split for a hard edge), u(col)/v(row) uv callbacks.
 */
export function gridSurface(mb, rows, nCols, opts = {}) {
  const { wrap = false, flip = false, creaseCols = null } = opts;
  const nRows = rows.length;
  if (nRows < 2 || nCols < 2) return;
  const uFn = opts.u || ((c) => c / (wrap ? nCols : nCols - 1));
  const vFn = opts.v || ((r) => r / (nRows - 1));

  // Column layout (typed tables): logical column, stored column, neighbours for
  // the u tangent. Crease columns are emitted twice (left / right copies).
  const lastCol = wrap ? nCols : nCols - 1; // wrap duplicates col 0 as seam
  const cap = (lastCol + 1) * 2;
  const layC = new Int32Array(cap);
  const layS = new Int32Array(cap);
  let L = 0;
  for (let c = 0; c <= lastCol; c++) {
    const cc = c % nCols;
    const isCrease = creaseCols !== null && creaseCols.has(cc) && (wrap || (c > 0 && c < nCols - 1));
    if (isCrease && c !== 0 && c !== lastCol) {
      layC[L] = c;
      layS[L++] = -1;
      layC[L] = c;
      layS[L++] = 1;
    } else {
      layC[L] = c;
      layS[L++] = isCrease ? (c === 0 ? 1 : -1) : 0;
    }
  }
  const colI = new Int32Array(L);
  const colA = new Int32Array(L);
  const colB = new Int32Array(L);
  for (let li = 0; li < L; li++) {
    const c = layC[li];
    const side = layS[li];
    let ca;
    let cb;
    if (wrap) {
      ca = side === 1 ? c : c - 1;
      cb = side === -1 ? c : c + 1;
      ca = ((ca % nCols) + nCols) % nCols;
      cb = cb % nCols;
    } else {
      ca = side === 1 || c === 0 ? c : c - 1;
      cb = side === -1 || c === nCols - 1 ? c : c + 1;
    }
    colI[li] = (c % nCols) * 3;
    colA[li] = ca * 3;
    colB[li] = cb * 3;
  }

  // degenerate row detection (poles)
  const degen = new Uint8Array(nRows);
  for (let r = 0; r < nRows; r++) {
    const R = rows[r];
    let ext = 0;
    for (let c = 1; c < nCols; c++) {
      const e = Math.abs(R[c * 3] - R[0]) + Math.abs(R[c * 3 + 1] - R[1]) + Math.abs(R[c * 3 + 2] - R[2]);
      if (e > ext) ext = e;
    }
    degen[r] = ext < 1e-7 ? 1 : 0;
  }

  const normals = new Float32Array(nRows * L * 3);
  for (let r = 0; r < nRows; r++) {
    if (degen[r]) continue;
    const R = rows[r];
    const R0 = rows[r > 0 ? r - 1 : r];
    const R1 = rows[r < nRows - 1 ? r + 1 : r];
    const Rn = rows[r < nRows - 1 ? r + 1 : r];
    const Rp = rows[r > 0 ? r - 1 : r];
    for (let li = 0; li < L; li++) {
      const a = colA[li];
      const b = colB[li];
      const c = colI[li];
      const ux = R[b] - R[a];
      const uy = R[b + 1] - R[a + 1];
      const uz = R[b + 2] - R[a + 2];
      let vx = R1[c] - R0[c];
      let vy = R1[c + 1] - R0[c + 1];
      let vz = R1[c + 2] - R0[c + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-12) {
        // v tangent collapsed (next to a pole): one-sided difference
        vx = Rn[c] - R[c];
        vy = Rn[c + 1] - R[c + 1];
        vz = Rn[c + 2] - R[c + 2];
        if (Math.abs(vx) + Math.abs(vy) + Math.abs(vz) < 1e-12) {
          vx = R[c] - Rp[c];
          vy = R[c + 1] - Rp[c + 1];
          vz = R[c + 2] - Rp[c + 2];
        }
        nx = uy * vz - uz * vy;
        ny = uz * vx - ux * vz;
        nz = ux * vy - uy * vx;
        len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      }
      const o = (r * L + li) * 3;
      const k = flip ? -1 / len : 1 / len;
      normals[o] = nx * k;
      normals[o + 1] = ny * k;
      normals[o + 2] = nz * k;
    }
  }
  // degenerate rows borrow the neighbour row's normals
  for (let r = 0; r < nRows; r++) {
    if (!degen[r]) continue;
    const src = r === 0 || (r < nRows - 1 && !degen[r + 1]) ? r + 1 : r - 1;
    const rr = Math.min(Math.max(src, 0), nRows - 1);
    normals.copyWithin(r * L * 3, rr * L * 3, (rr + 1) * L * 3);
  }

  const base = mb.vCount;
  mb.reserve(nRows * L, (nRows - 1) * (L - 1) * 6);
  const uv = new Float64Array(L);
  for (let li = 0; li < L; li++) uv[li] = uFn(layC[li]);
  for (let r = 0; r < nRows; r++) {
    const v = vFn(r);
    const R = rows[r];
    for (let li = 0; li < L; li++) {
      const c = colI[li];
      const o = (r * L + li) * 3;
      mb.vert(R[c], R[c + 1], R[c + 2], normals[o], normals[o + 1], normals[o + 2], uv[li], v);
    }
  }
  for (let r = 0; r < nRows - 1; r++) {
    const d0 = degen[r];
    const d1 = degen[r + 1];
    for (let li = 0; li < L - 1; li++) {
      // skip the zero-width link between split crease copies
      if (layC[li] === layC[li + 1]) continue;
      const a = base + r * L + li;
      const b = a + 1;
      const c = a + L;
      const d = c + 1;
      if (flip) {
        if (!d0) mb.tri(a, c, b);
        if (!d1) mb.tri(b, c, d);
      } else {
        if (!d0) mb.tri(a, b, c);
        if (!d1) mb.tri(b, d, c);
      }
    }
  }
}

/** Fan-triangulated planar-ish cap over a closed ring of points (Float64Array n*3). */
export function capFan(mb, ring, n, nx, ny, nz, flip = false) {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    cx += ring[i * 3];
    cy += ring[i * 3 + 1];
    cz += ring[i * 3 + 2];
  }
  cx /= n;
  cy /= n;
  cz /= n;
  let minx = Infinity;
  let maxx = -Infinity;
  let miny = Infinity;
  let maxy = -Infinity;
  for (let i = 0; i < n; i++) {
    minx = Math.min(minx, ring[i * 3]);
    maxx = Math.max(maxx, ring[i * 3]);
    miny = Math.min(miny, ring[i * 3 + 1]);
    maxy = Math.max(maxy, ring[i * 3 + 1]);
  }
  const sx = 1 / Math.max(maxx - minx, 1e-6);
  const sy = 1 / Math.max(maxy - miny, 1e-6);
  const c = mb.vert(cx, cy, cz, nx, ny, nz, 0.5, 0.5);
  const first = mb.vCount;
  for (let i = 0; i < n; i++) {
    mb.vert(ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2], nx, ny, nz, (ring[i * 3] - minx) * sx, (ring[i * 3 + 1] - miny) * sy);
  }
  for (let i = 0; i < n; i++) {
    const a = first + i;
    const b = first + ((i + 1) % n);
    if (flip) mb.tri(c, b, a);
    else mb.tri(c, a, b);
  }
}

/** Apply a Matrix4 to a geometry in place, fixing winding when mirrored. */
export function applyMat(geom, m) {
  geom.applyMatrix4(m);
  if (m.determinant() < 0 && geom.index) {
    const I = geom.index.array;
    for (let i = 0; i < I.length; i += 3) {
      const t = I[i + 1];
      I[i + 1] = I[i + 2];
      I[i + 2] = t;
    }
    geom.index.needsUpdate = true;
  }
  return geom;
}

const _m = new Matrix4();
const _m2 = new Matrix4();

/**
 * Compose a transform: rotations in degrees applied in order Z (roll/cant),
 * X (pitch/incidence), Y (yaw/sweep); then translation. Scale optional.
 */
export function xform({ pos = [0, 0, 0], rx = 0, ry = 0, rz = 0, scale = null, order = 'ZXY' } = {}) {
  const m = new Matrix4();
  if (scale) {
    const s = Array.isArray(scale) ? scale : [scale, scale, scale];
    m.makeScale(s[0], s[1], s[2]);
  }
  for (const axis of order) {
    const a = (axis === 'X' ? rx : axis === 'Y' ? ry : rz) * DEG;
    if (!a) continue;
    if (axis === 'X') _m.makeRotationX(a);
    else if (axis === 'Y') _m.makeRotationY(a);
    else _m.makeRotationZ(a);
    m.premultiply(_m);
  }
  _m2.makeTranslation(pos[0], pos[1], pos[2]);
  m.premultiply(_m2);
  return m;
}

export function place(geom, opts) {
  return applyMat(geom, xform(opts));
}

export function mirrorX(geom) {
  const g = geom.clone();
  return applyMat(g, new Matrix4().makeScale(-1, 1, 1));
}

/** Returns [geom, mirrored clone] - convenience for symmetric parts. */
export function pair(geom) {
  return [geom, mirrorX(geom)];
}

export function setZone(geom, zone) {
  const a = geom.getAttribute('aZone');
  if (a) a.array.fill(zone);
  else geom.setAttribute('aZone', new BufferAttribute(new Float32Array(geom.attributes.position.count).fill(zone), 1));
  return geom;
}

/** Tag an emissive part: per-vertex linear color + glow type (0 steady, 1 afterburner, 2 strobe, 3 formation). */
export function setGlow(geom, color, glow = 0, gradient = null) {
  const n = geom.attributes.position.count;
  const col = new Float32Array(n * 3);
  const gl = new Float32Array(n).fill(glow);
  const p = geom.attributes.position.array;
  for (let i = 0; i < n; i++) {
    let k = 1;
    if (gradient) k = gradient(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    col[i * 3] = color[0] * k;
    col[i * 3 + 1] = color[1] * k;
    col[i * 3 + 2] = color[2] * k;
  }
  geom.setAttribute('color', new BufferAttribute(col, 3));
  geom.setAttribute('aGlow', new BufferAttribute(gl, 1));
  return geom;
}

const REQUIRED = {
  body: ['position', 'normal', 'uv', 'aZone'],
  metal: ['position', 'normal', 'uv', 'aZone'],
  glass: ['position', 'normal', 'uv'],
  emissive: ['position', 'normal', 'uv', 'color', 'aGlow']
};

/** Make a list of geometries merge-compatible for a material slot and merge them. */
export function mergeSlot(slot, list) {
  if (!list || list.length === 0) return null;
  const req = REQUIRED[slot];
  const prepared = list.map((g) => {
    if (!g.index) {
      const n = g.attributes.position.count;
      const idx = new Uint32Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new BufferAttribute(idx, 1));
    }
    for (const name of Object.keys(g.attributes)) if (!req.includes(name)) g.deleteAttribute(name);
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new BufferAttribute(new Float32Array(n * 2), 2));
    if (req.includes('aZone') && !g.attributes.aZone) g.setAttribute('aZone', new BufferAttribute(new Float32Array(n), 1));
    if (req.includes('color') && !g.attributes.color) setGlow(g, [1, 1, 1], 0);
    g.morphAttributes = {};
    return g;
  });
  if (prepared.length === 1) return prepared[0];
  const merged = mergeGeometries(prepared, false);
  for (const g of prepared) g.dispose();
  return merged;
}

export function triCount(geom) {
  if (!geom) return 0;
  return geom.index ? geom.index.count / 3 : geom.attributes.position.count / 3;
}

/** Axis-aligned box with flat normals (24 verts / 12 tris). */
export function box(w, h, d, { pos = [0, 0, 0], zone = 0 } = {}) {
  const x = w / 2;
  const y = h / 2;
  const z = d / 2;
  return hexahedron(
    [
      [-x, -y, -z],
      [x, -y, -z],
      [x, y, -z],
      [-x, y, -z],
      [-x, -y, z],
      [x, -y, z],
      [x, y, z],
      [-x, y, z]
    ].map((p) => [p[0] + pos[0], p[1] + pos[1], p[2] + pos[2]]),
    zone
  );
}

const HEX_FACES = [
  [0, 3, 2, 1], // -z
  [4, 5, 6, 7], // +z
  [0, 4, 7, 3], // -x
  [1, 2, 6, 5], // +x
  [3, 7, 6, 2], // +y
  [0, 1, 5, 4] // -y
];

/**
 * Flat-shaded hexahedron from 8 corners: 0..3 = back face (z-) ordered
 * (-x-y, +x-y, +x+y, -x+y), 4..7 = front face (z+) same order.
 * Great for tapered superstructures, pylons, tracks.
 */
export function hexahedron(c, zone = 0) {
  const mb = new MeshBuilder(24, 36);
  mb.curZone = zone;
  for (const f of HEX_FACES) {
    const p0 = c[f[0]];
    const p1 = c[f[1]];
    const p2 = c[f[2]];
    const p3 = c[f[3]];
    // Newell normal
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const q = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      const a = q[i];
      const b = q[(i + 1) % 4];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const i0 = mb.vert(p0[0], p0[1], p0[2], nx, ny, nz, 0, 0);
    mb.vert(p1[0], p1[1], p1[2], nx, ny, nz, 1, 0);
    mb.vert(p2[0], p2[1], p2[2], nx, ny, nz, 1, 1);
    mb.vert(p3[0], p3[1], p3[2], nx, ny, nz, 0, 1);
    // winding: Newell normal follows the quad order; emit CCW about it
    mb.tri(i0, i0 + 1, i0 + 2);
    mb.tri(i0, i0 + 2, i0 + 3);
  }
  return mb.toGeometry();
}

/** Tapered box: bottom rectangle (w0 x d0) at y0, top rectangle (w1 x d1) at y1, top offset in z. */
export function taperBox({ w0, d0, w1 = w0, d1 = d0, y0 = 0, y1 = 1, x = 0, z = 0, zTop = 0, zone = 0 }) {
  const a = w0 / 2;
  const b = d0 / 2;
  const c = w1 / 2;
  const e = d1 / 2;
  return hexahedron(
    [
      [x - a, y0, z - b],
      [x + a, y0, z - b],
      [x + c, y1, z + zTop - e],
      [x - c, y1, z + zTop - e],
      [x - a, y0, z + b],
      [x + a, y0, z + b],
      [x + c, y1, z + zTop + e],
      [x - c, y1, z + zTop + e]
    ],
    zone
  );
}

export function vec(x, y, z) {
  return new Vector3(x, y, z);
}
