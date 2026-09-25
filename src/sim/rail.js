import { CatmullRomCurve3, Vector3 } from 'three';
import { DEG, smoothstep } from '../core/math.js';

const _up = new Vector3(0, 1, 0);
const _p = new Vector3();
const _t = new Vector3();
const _r = new Vector3();
const _u = new Vector3();

/**
 * Stage flight path. Arc-length parameterised (s in metres) with a stable
 * banked frame: T (forward), R (right), U (up).
 *
 * Frames are derived from world-up rather than parallel transport so the
 * horizon never drifts; authored bank angles roll R/U around T.
 */
export class Rail {
  /**
   * @param {{points: number[][], bank?: number[][], tension?: number, spacing?: number}} def
   */
  constructor(def) {
    const pts = def.points.map((p) => new Vector3(p[0], p[1], p[2]));
    this.curve = new CatmullRomCurve3(pts, false, 'centripetal');
    this.bankKeys = (def.bank || []).slice().sort((a, b) => a[0] - b[0]);
    this.spacing = def.spacing || 2;
    this._build();
  }

  _build() {
    // 1) dense parameter sampling for arc length
    const curve = this.curve;
    const nPts = curve.points.length;
    const M = Math.max(4000, nPts * 400);
    const us = new Float64Array(M + 1);
    const cum = new Float64Array(M + 1);
    let prev = curve.getPoint(0, new Vector3());
    const cur = new Vector3();
    for (let i = 1; i <= M; i++) {
      const u = i / M;
      curve.getPoint(u, cur);
      cum[i] = cum[i - 1] + cur.distanceTo(prev);
      us[i] = u;
      prev.copy(cur);
    }
    this.length = cum[M];

    // 2) uniform-s tables
    const ds = this.spacing;
    const N = Math.ceil(this.length / ds) + 1;
    this.count = N;
    this.pos = new Float64Array(N * 3);
    this.tan = new Float32Array(N * 3);
    this.right = new Float32Array(N * 3);
    this.up = new Float32Array(N * 3);
    let j = 0;
    for (let k = 0; k < N; k++) {
      const s = Math.min(k * ds, this.length);
      while (j < M - 1 && cum[j + 1] < s) j++;
      const seg = cum[j + 1] - cum[j];
      const f = seg > 0 ? (s - cum[j]) / seg : 0;
      const u = us[j] + (us[j + 1] - us[j]) * f;
      curve.getPoint(u, _p);
      curve.getTangent(u, _t).normalize();
      this.pos[k * 3] = _p.x;
      this.pos[k * 3 + 1] = _p.y;
      this.pos[k * 3 + 2] = _p.z;
      // base frame from world up
      _r.crossVectors(_t, _up);
      if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
      _r.normalize();
      _u.crossVectors(_r, _t).normalize();
      // authored bank
      const bank = this.bankAt(s) * DEG;
      if (bank !== 0) {
        const c = Math.cos(bank), sn = Math.sin(bank);
        // positive bank = right wing down
        const rx = _r.x * c - _u.x * sn, ry = _r.y * c - _u.y * sn, rz = _r.z * c - _u.z * sn;
        const ux = _u.x * c + _r.x * sn, uy = _u.y * c + _r.y * sn, uz = _u.z * c + _r.z * sn;
        _r.set(rx, ry, rz);
        _u.set(ux, uy, uz);
      }
      this.tan[k * 3] = _t.x; this.tan[k * 3 + 1] = _t.y; this.tan[k * 3 + 2] = _t.z;
      this.right[k * 3] = _r.x; this.right[k * 3 + 1] = _r.y; this.right[k * 3 + 2] = _r.z;
      this.up[k * 3] = _u.x; this.up[k * 3 + 1] = _u.y; this.up[k * 3 + 2] = _u.z;
    }

    // 3) curvature (yaw rate per metre) for camera/plane lean
    this.curv = new Float32Array(N);
    for (let k = 1; k < N - 1; k++) {
      const ax = this.tan[(k - 1) * 3], az = this.tan[(k - 1) * 3 + 2];
      const bx = this.tan[(k + 1) * 3], bz = this.tan[(k + 1) * 3 + 2];
      const cross = ax * bz - az * bx; // > 0 when turning right
      this.curv[k] = cross / (2 * ds);
    }
  }

  bankAt(s) {
    const keys = this.bankKeys;
    if (!keys.length) return 0;
    if (s <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (s <= keys[i][0]) {
        const [s0, b0] = keys[i - 1];
        const [s1, b1] = keys[i];
        return b0 + (b1 - b0) * smoothstep(s0, s1, s);
      }
    }
    return keys[keys.length - 1][1];
  }

  /** Writes rail point at s into out (Vector3). */
  positionAt(s, out) {
    const x = Math.max(0, Math.min(this.length, s)) / this.spacing;
    const i = Math.min(Math.floor(x), this.count - 2);
    const f = x - i;
    const a = i * 3, b = a + 3, P = this.pos;
    return out.set(P[a] + (P[b] - P[a]) * f, P[a + 1] + (P[b + 1] - P[a + 1]) * f, P[a + 2] + (P[b + 2] - P[a + 2]) * f);
  }

  /**
   * Full frame at s. `frame` = {pos, T, R, U} of Vector3s (reused by caller).
   */
  frameAt(s, frame) {
    const x = Math.max(0, Math.min(this.length, s)) / this.spacing;
    const i = Math.min(Math.floor(x), this.count - 2);
    const f = x - i;
    const a = i * 3, b = a + 3;
    const P = this.pos, T = this.tan, R = this.right, U = this.up;
    frame.pos.set(P[a] + (P[b] - P[a]) * f, P[a + 1] + (P[b + 1] - P[a + 1]) * f, P[a + 2] + (P[b + 2] - P[a + 2]) * f);
    frame.T.set(T[a] + (T[b] - T[a]) * f, T[a + 1] + (T[b + 1] - T[a + 1]) * f, T[a + 2] + (T[b + 2] - T[a + 2]) * f).normalize();
    frame.R.set(R[a] + (R[b] - R[a]) * f, R[a + 1] + (R[b + 1] - R[a + 1]) * f, R[a + 2] + (R[b + 2] - R[a + 2]) * f);
    frame.U.set(U[a] + (U[b] - U[a]) * f, U[a + 1] + (U[b + 1] - U[a + 1]) * f, U[a + 2] + (U[b + 2] - U[a + 2]) * f);
    // re-orthonormalise after lerp
    frame.R.addScaledVector(frame.T, -frame.R.dot(frame.T)).normalize();
    frame.U.crossVectors(frame.R, frame.T).normalize();
    return frame;
  }

  curvatureAt(s) {
    const x = Math.max(0, Math.min(this.length, s)) / this.spacing;
    const i = Math.min(Math.floor(x), this.count - 2);
    const f = x - i;
    return this.curv[i] + (this.curv[i + 1] - this.curv[i]) * f;
  }

  /** World position of a rail-local point (x right, y up, z ahead along rail). */
  localToWorld(s, x, y, out, frame) {
    this.frameAt(s, frame);
    return out.copy(frame.pos).addScaledVector(frame.R, x).addScaledVector(frame.U, y);
  }

  /**
   * Nearest rail distance for a world point, searching around a hint.
   * Used by world-anchored entities to compute their rail-relative z.
   */
  project(point, hintS = 0, window = 3000) {
    const ds = this.spacing;
    let best = hintS, bestD = Infinity;
    const lo = Math.max(0, Math.floor((hintS - window) / ds));
    const hi = Math.min(this.count - 1, Math.ceil((hintS + window) / ds));
    const step = 8;
    for (let k = lo; k <= hi; k += step) {
      const dx = this.pos[k * 3] - point.x, dy = this.pos[k * 3 + 1] - point.y, dz = this.pos[k * 3 + 2] - point.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = k; }
    }
    const lo2 = Math.max(0, best - step), hi2 = Math.min(this.count - 1, best + step);
    for (let k = lo2; k <= hi2; k++) {
      const dx = this.pos[k * 3] - point.x, dy = this.pos[k * 3 + 1] - point.y, dz = this.pos[k * 3 + 2] - point.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = k; }
    }
    return best * ds;
  }
}

export function makeFrame() {
  return { pos: new Vector3(), T: new Vector3(), R: new Vector3(), U: new Vector3() };
}
