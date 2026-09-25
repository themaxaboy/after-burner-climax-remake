import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { Rng } from '../../core/rng.js';
import { makeNoise } from './noise.js';
import { applyWorldFog } from '../../render/worldUniforms.js';
import { makeFrame } from '../../sim/rail.js';

// Terrain obstacles (CONTRACTS §6 `terrain.obstacles`): rock pillars and
// spires to steer around, arches and bridges to fly under, striped towers.
// Layout is pure and deterministic (seeded) so tests and the game agree; every
// layout keeps a lateral free gap of at least MIN_GAP metres at each s.
// Collision shapes live in rail space (s, x, world y): vertical (tapered)
// cylinders for pillars / spires / legs / piers / towers and boxes for arch
// beams and bridge decks.

export const MIN_GAP = 45;
export const OBSTACLE_KINDS = ['pillar', 'spire', 'arch', 'tower', 'bridge'];

const DEFAULTS = {
  pillar: { r: [14, 22], h: [150, 240] },
  spire: { r: [9, 14], h: [100, 170] },
  arch: { h: 70, r: 16, thick: 24, depth: 26 },
  tower: { r: [4.5, 6], h: [110, 150] },
  bridge: { h: 55, r: 6, thick: 8, depth: 18, gap: 72 }
};
const TOWER_BULB = 2.6; // bulb radius / shaft radius
const MIN_SPACING = 80; // min distance along s between two obstacles

const pickNum = (v, rng, def) => {
  const x = v ?? def;
  if (Array.isArray(x)) return rng.range(x[0], x[1]);
  return x;
};

/**
 * Deterministic obstacle layout.
 * @param {object} def terrain def ({ seed, obstacles })
 * @param {{ shape, railY: (s:number)=>number, boxX?: number, length?: number }} env
 * @returns {{ list: object[], parts: object[], maxHalf: number }}
 *   list: obstacles { kind, s, x, l, r, h, base, top, ... }, parts sorted by s0
 */
export function layoutObstacles(def, env) {
  const specs = def.obstacles || [];
  const shape = env.shape;
  const boxX = env.boxX ?? 200;
  const length = env.length ?? Infinity;
  const list = [];
  const parts = [];
  const ground = (s, x) => shape.heightAt(s, x, env.railY(s));
  const floorY = (s, x) => {
    const f = shape.floorAt(s, x, env.railY(s));
    return shape.waterLevel != null ? Math.max(f, shape.waterLevel) : f;
  };
  const corridor = (s) => {
    const c = shape.centreAt(s);
    const fw = Math.min(shape.flyableHalfWidth(s), 320);
    return { c, xa: Math.max(c - fw, -boxX), xb: Math.min(c + fw, boxX) };
  };
  const baseOf = (s, x, r) => {
    let b = ground(s, x);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      b = Math.min(b, ground(s + Math.cos(a) * r, x + Math.sin(a) * r));
    }
    return b - 4;
  };

  function build(kind, s, x, spec, rng) {
    const D = DEFAULTS[kind];
    const o = { kind, s, x, parts: [] };
    const cyl = (px, r, rTop, y0, y1, role) => o.parts.push({ type: 'cyl', s, x: px, r, rTop, y0, y1, role, s0: s - Math.max(r, rTop), s1: s + Math.max(r, rTop) });
    if (kind === 'pillar' || kind === 'spire') {
      o.r = pickNum(spec.r, rng, D.r);
      o.h = pickNum(spec.h, rng, D.h);
      o.base = baseOf(s, x, o.r);
      o.top = floorY(s, x) + o.h;
      if (kind === 'pillar') cyl(x, o.r * 0.92, o.r * 0.72, o.base, o.top, 'rock');
      else cyl(x, o.r * 0.9, o.r * 0.12, o.base, o.top, 'rock');
    } else if (kind === 'tower') {
      o.r = pickNum(spec.r, rng, D.r);
      o.h = pickNum(spec.h, rng, D.h);
      o.base = baseOf(s, x, o.r) + 2;
      o.top = floorY(s, x) + o.h;
      const H = o.top - o.base;
      cyl(x, o.r, o.r, o.base, o.base + H * 0.86, 'shaft');
      cyl(x, o.r * TOWER_BULB, o.r * TOWER_BULB, o.base + H * 0.84, o.base + H * 0.96, 'bulb');
    } else if (kind === 'arch') {
      const { xa, xb } = corridor(s);
      o.r = pickNum(spec.r, rng, D.r);
      o.w = Math.max(MIN_GAP + 2 * o.r + 6, pickNum(spec.w, rng, Math.min(260, Math.max(90, (xb - xa) * 0.92))));
      o.h = Math.max(38, pickNum(spec.h, rng, D.h));
      o.thick = spec.thick ?? D.thick;
      o.depth = spec.depth ?? D.depth;
      const fl = floorY(s, x);
      o.beamY0 = fl + o.h;
      o.beamY1 = o.beamY0 + o.thick;
      o.legs = [x - o.w / 2, x + o.w / 2];
      o.legBase = o.legs.map((lx) => baseOf(s, lx, o.r));
      for (let i = 0; i < 2; i++) cyl(o.legs[i], o.r, o.r * 0.85, o.legBase[i], o.beamY1, 'leg');
      o.base = Math.min(...o.legBase);
      o.top = o.beamY1;
      o.parts.push({ type: 'box', s0: s - o.depth / 2, s1: s + o.depth / 2, x0: o.legs[0] - o.r, x1: o.legs[1] + o.r, y0: o.beamY0, y1: o.beamY1, role: 'beam' });
    } else if (kind === 'bridge') {
      const { c, xa, xb } = corridor(s);
      o.h = Math.max(36, pickNum(spec.h, rng, D.h));
      o.thick = spec.thick ?? D.thick;
      o.depth = spec.depth ?? D.depth;
      o.r = spec.r ?? D.r;
      const gap = Math.max(MIN_GAP + 2 * o.r + 4, spec.gap ?? D.gap);
      const fl = floorY(s, x);
      o.deckY0 = fl + o.h;
      o.deckY1 = o.deckY0 + o.thick;
      const halfW = (spec.w ?? Math.max(xb - xa, 120) + 320) / 2;
      o.w = halfW * 2;
      o.x0 = x - halfW;
      o.x1 = x + halfW;
      o.base = fl;
      o.top = o.deckY1;
      // piers: the central gap is centred on x, then every `gap` metres while the ground is below the deck
      o.piers = [];
      for (let k = 0; k < 40; k++) {
        const off = gap / 2 + k * gap;
        if (off > halfW - 10) break;
        for (const sg of [-1, 1]) {
          const px = x + sg * off;
          const g = ground(s, px);
          if (g > o.deckY0 - 6) continue; // inside the valley wall: no pier needed
          const pb = baseOf(s, px, o.r);
          o.piers.push({ x: px, base: pb });
          cyl(px, o.r, o.r, pb, o.deckY0, 'pier');
        }
      }
      void c;
      o.parts.push({ type: 'box', s0: s - o.depth / 2, s1: s + o.depth / 2, x0: o.x0, x1: o.x1, y0: o.deckY0, y1: o.deckY1, role: 'deck' });
    } else return null;
    o.s0 = Math.min(...o.parts.map((p) => p.s0));
    o.s1 = Math.max(...o.parts.map((p) => p.s1));
    return o;
  }

  const allParts = [];
  const fits = (o) => {
    // spacing along s
    for (const q of list) if (o.s0 - MIN_SPACING < q.s1 && o.s1 + MIN_SPACING > q.s0) return false;
    const cand = allParts.concat(o.parts);
    for (let s = o.s0 - 2; s <= o.s1 + 2; s += 3) {
      const { xa, xb } = corridor(s);
      if (maxFreeGap(cand, s, xa, xb) < MIN_GAP) return false;
    }
    return true;
  };
  const accept = (o) => {
    list.push(o);
    for (const p of o.parts) {
      p.o = list.length - 1;
      allParts.push(p);
    }
  };

  const seed = def.seed || 1;
  // explicit obstacles first (l relative to the corridor centre); nudged toward a wall if they would close the gap
  specs.forEach((sp, i) => {
    if (sp.from != null || !sp.kind || sp.s == null) return;
    if (sp.s < 0 || sp.s > length) return;
    const rng = new Rng(seed * 131 + i * 17 + 5);
    const c = shape.centreAt(sp.s);
    const l0 = sp.l ?? 0;
    for (let t = 0; t < 24; t++) {
      const nudge = t === 0 ? 0 : Math.ceil(t / 2) * 6 * (t % 2 ? Math.sign(l0 || 1) : -Math.sign(l0 || 1));
      const o = build(sp.kind, sp.s, c + l0 + nudge, sp, rng);
      if (!o) break;
      o.l = o.x - c;
      o.explicit = true;
      if (fits(o)) {
        accept(o);
        return;
      }
    }
    if (typeof console !== 'undefined') console.warn(`terrain obstacle ${sp.kind} at s=${sp.s} dropped: would close the ${MIN_GAP} m gap`);
  });

  // scatter rules
  specs.forEach((sp, i) => {
    if (sp.from == null || sp.to == null) return;
    const rng = new Rng((sp.seed ?? seed) * 977 + i * 7919 + 1);
    const kinds = sp.kinds && sp.kinds.length ? sp.kinds : ['pillar'];
    const every = Array.isArray(sp.every) ? sp.every : [sp.every ?? 500, sp.every ?? 500];
    const lat = sp.lat ?? [-0.9, 0.9];
    let s = sp.from + rng.range(every[0], every[1]) * 0.5;
    const end = Math.min(sp.to, length - 100);
    while (s < end) {
      const kind = rng.pick(kinds);
      const { c, xa, xb } = corridor(s);
      const mid = (xa + xb) / 2, half = (xb - xa) / 2;
      if (half * 2 >= MIN_GAP + 10) {
        let placed = false;
        for (let t = 0; t < 4 && !placed; t++) {
          const f = t === 0 ? rng.range(lat[0], lat[1]) : t === 1 ? -rng.range(lat[0], lat[1]) : rng.range(lat[0], lat[1]) * 0.5;
          const span = kind === 'arch' || kind === 'bridge' ? 0.25 : 1;
          const o = build(kind, s, mid + f * half * span, sp, rng);
          if (!o) break;
          o.l = o.x - c;
          if (fits(o)) {
            accept(o);
            placed = true;
          }
        }
      }
      s += rng.range(every[0], every[1]);
    }
  });

  allParts.sort((a, b) => a.s0 - b.s0);
  for (const p of allParts) parts.push(p);
  let maxHalf = 0;
  for (const p of parts) maxHalf = Math.max(maxHalf, p.s1 - p.s0);
  return { list, parts, maxHalf };
}

// ------------------------------------------------------------------ queries
const _iv = [];

/** Lateral blocked intervals of cylinder parts at s (optionally only those spanning world altitude y). */
function blocked(parts, s, y, out, margin = 0) {
  out.length = 0;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (s < p.s0 - margin || s > p.s1 + margin) continue;
    if (p.type === 'cyl') {
      if (y != null && (y < p.y0 - 20 || y > p.y1 + 8)) continue;
      const r = Math.max(p.r, p.rTop) + margin;
      const ds = s - p.s;
      if (Math.abs(ds) >= r) continue;
      const hc = Math.sqrt(r * r - ds * ds);
      out.push(p.x - hc, p.x + hc);
    } else if (y != null) {
      if (y < p.y0 - 8 || y > p.y1 + 8) continue;
      out.push(p.x0 - margin, p.x1 + margin);
    }
  }
  return out;
}

/** Free intervals [a0, b0, a1, b1, …] of [xa, xb] given blocked intervals (pairs). */
function freeFrom(bl, xa, xb, out) {
  out.length = 0;
  // insertion sort by start (lists are tiny)
  for (let i = 2; i < bl.length; i += 2) {
    const a = bl[i], b = bl[i + 1];
    let j = i - 2;
    while (j >= 0 && bl[j] > a) {
      bl[j + 2] = bl[j];
      bl[j + 3] = bl[j + 1];
      j -= 2;
    }
    bl[j + 2] = a;
    bl[j + 3] = b;
  }
  let cur = xa;
  for (let i = 0; i < bl.length; i += 2) {
    const a = bl[i], b = bl[i + 1];
    if (b <= cur) continue;
    if (a > cur) out.push(cur, Math.min(a, xb));
    cur = Math.max(cur, b);
    if (cur >= xb) break;
  }
  if (cur < xb) out.push(cur, xb);
  return out;
}

const _free = [];
/** Widest lateral free interval inside [xa, xb] at s (cylinders only: beams are flown under). */
export function maxFreeGap(parts, s, xa, xb) {
  blocked(parts, s, null, _iv);
  freeFrom(_iv, xa, xb, _free);
  let best = 0;
  for (let i = 0; i < _free.length; i += 2) best = Math.max(best, _free[i + 1] - _free[i]);
  return best;
}

/** Signed distance from (s, x, y) to one collision part (negative inside). */
export function partDistance(p, s, x, y) {
  if (p.type === 'cyl') {
    const d = Math.hypot(s - p.s, x - p.x);
    const t = Math.min(1, Math.max(0, (y - p.y0) / Math.max(1, p.y1 - p.y0)));
    const r = p.r + (p.rTop - p.r) * t;
    if (y > p.y1) return Math.hypot(Math.max(0, d - p.rTop), y - p.y1);
    const dh = d - r;
    return dh < 0 ? Math.max(dh, y - p.y1) : dh;
  }
  const cs = (p.s0 + p.s1) / 2, cx = (p.x0 + p.x1) / 2, cy = (p.y0 + p.y1) / 2;
  const qs = Math.abs(s - cs) - (p.s1 - p.s0) / 2;
  const qx = Math.abs(x - cx) - (p.x1 - p.x0) / 2;
  const qy = Math.abs(y - cy) - (p.y1 - p.y0) / 2;
  const out = Math.hypot(Math.max(qs, 0), Math.max(qx, 0), Math.max(qy, 0));
  return out + Math.min(Math.max(qs, qx, qy), 0);
}

// ------------------------------------------------------------------ geometry
function orientOutward(pos, idx, axisPoint) {
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), m = new Vector3(), ref = new Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromArray(pos, idx[i] * 3);
    b.fromArray(pos, idx[i + 1] * 3);
    c.fromArray(pos, idx[i + 2] * 3);
    m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    n.subVectors(b, a).cross(ref.subVectors(c, a));
    axisPoint(m, ref);
    if (n.dot(m.sub(ref)) < 0) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  }
}

function finish(pos, idx, extra = {}) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, new BufferAttribute(new Float32Array(v.data), v.size));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Rock column / spire: noisy lathe with strata ledges and a domed (or pointed) top. Unit radius & height. */
export function rockColumnGeometry({ spire = false, seed = 3, rows = 18, segs = 16 } = {}) {
  const noise = makeNoise(seed);
  const pos = [], cav = [], rel = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const y = -0.08 + t * 1.08;
    const tt = Math.max(0, y);
    let r = spire ? Math.pow(1 - tt, 0.85) * 1.05 + 0.04 : 1 - 0.28 * tt + 0.07 * Math.sin(tt * 19) * (1 - tt * 0.5);
    if (!spire) r *= 1 - 0.55 * Math.pow(Math.max(0, (tt - 0.93) / 0.07), 2); // rounded shoulder
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const n = noise.fbm(Math.cos(a) * 1.3 + 4, y * (spire ? 4 : 6) + Math.sin(a) * 1.3, 3);
      const rr = Math.max(0.02, r * (1 + n * 0.28));
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      cav.push(Math.max(-1, Math.min(1, -n * 2.2)));
      rel.push(tt);
    }
  }
  const top = pos.length / 3;
  pos.push(0, spire ? 1.02 : 1.015, 0);
  cav.push(0);
  rel.push(1);
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
      idx.push(a, c, b, b, c, d);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(rows * segs + j, top, rows * segs + ((j + 1) % segs));
  orientOutward(pos, idx, (m, out) => out.set(0, Math.min(m.y, 0.9), 0));
  return finish(pos, idx, { aCavity: { data: cav, size: 1 }, aRel: { data: rel, size: 1 } });
}

/** Underside of the arch beam (in thickness units): an elliptical opening that drops into the legs. */
const archBottom = (x) => -2.4 * (1 - Math.sqrt(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(2 * x)), 2.2))));

/** Arch beam: x ∈ [-0.5, 0.5] span, y ∈ [0, 1] thickness (arching down into the legs), z ∈ [-0.5, 0.5] depth. */
export function archBeamGeometry({ seed = 11, nx = 36, ring = 14 } = {}) {
  const noise = makeNoise(seed);
  const pos = [], cav = [], rel = [], idx = [];
  for (let i = 0; i <= nx; i++) {
    const x = -0.5 + i / nx;
    const yb = archBottom(x);
    for (let k = 0; k < ring; k++) {
      const ph = (k / ring) * Math.PI * 2;
      const sy = Math.sin(ph), cz = Math.cos(ph);
      const v = 0.5 + 0.5 * Math.sign(sy) * Math.pow(Math.abs(sy), 0.45);
      const z = 0.5 * Math.sign(cz) * Math.pow(Math.abs(cz), 0.45);
      const n = noise.fbm(x * 5 + 2, ph * 0.9 + 3, 3);
      const y = yb + (1 - yb) * v;
      pos.push(x, y + n * 0.12, z * (1 + n * 0.25));
      cav.push(Math.max(-1, Math.min(1, -n * 2)));
      rel.push(Math.max(0, y));
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < ring; k++) {
      const a = i * ring + k, b = i * ring + ((k + 1) % ring), c = a + ring, d = b + ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  for (const i of [0, nx]) {
    const ci = pos.length / 3;
    const x = -0.5 + i / nx;
    pos.push(x, (archBottom(x) + 1) / 2, 0);
    cav.push(0);
    rel.push(0);
    for (let k = 0; k < ring; k++) idx.push(ci, i * ring + k, i * ring + ((k + 1) % ring));
  }
  orientOutward(pos, idx, (m, out) => out.set(Math.abs(m.x) > 0.499 ? m.x * 0.9 : m.x, (archBottom(m.x) + 1) / 2, 0));
  return finish(pos, idx, { aCavity: { data: cav, size: 1 }, aRel: { data: rel, size: 1 } });
}

function pushCylinder(P, { r0, r1, y0, y1, segs, col, col2, bands = 1, x = 0, z = 0 }) {
  const { pos, colr, idx } = P;
  for (let b = 0; b < bands; b++) {
    const ya = y0 + ((y1 - y0) * b) / bands, yb = y0 + ((y1 - y0) * (b + 1)) / bands;
    const ra = r0 + ((r1 - r0) * b) / bands, rb = r0 + ((r1 - r0) * (b + 1)) / bands;
    const c = b % 2 && col2 ? col2 : col;
    const base = pos.length / 3;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(x + Math.cos(a) * ra, ya, z + Math.sin(a) * ra, x + Math.cos(a) * rb, yb, z + Math.sin(a) * rb);
      colr.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let j = 0; j < segs; j++) {
      const a = base + j * 2, bb = a + 1, cc = a + 2, d = a + 3;
      idx.push(a, bb, cc, cc, bb, d);
    }
  }
}

function pushBox(P, x0, x1, y0, y1, z0, z1, cSide, cTop, cBottom) {
  const { pos, colr, idx } = P;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const faces = [
    [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], cTop],
    [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], cBottom],
    [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], cSide],
    [[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], cSide],
    [[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], cSide],
    [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], cSide]
  ];
  for (const f of faces) {
    const b = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      pos.push(...f[k]);
      colr.push(f[4].r, f[4].g, f[4].b);
    }
    // wind each face so it faces away from the box centre
    const [a, bb, c] = f;
    const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const fx = (a[0] + c[0]) / 2 - cx, fy = (a[1] + c[1]) / 2 - cy, fz = (a[2] + c[2]) / 2 - cz;
    if (nx * fx + ny * fy + nz * fz >= 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    else idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
}

function manMade(P) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(P.colr), 3));
  g.setIndex(P.idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const hex = (h) => new Color(h);

/** Striped obstacle tower: shaft r = 1 (0 → 0.86), bulb r = TOWER_BULB, antenna to y = 1. */
export function towerGeometry() {
  const P = { pos: [], colr: [], idx: [] };
  const white = hex('#f2f2ee'), red = hex('#e2321e');
  pushCylinder(P, { r0: 1.15, r1: 0.9, y0: -0.03, y1: 0.86, segs: 10, col: red, col2: white, bands: 7 });
  pushCylinder(P, { r0: 0.9, r1: TOWER_BULB, y0: 0.84, y1: 0.88, segs: 14, col: white });
  pushCylinder(P, { r0: TOWER_BULB, r1: TOWER_BULB, y0: 0.88, y1: 0.93, segs: 14, col: red });
  pushCylinder(P, { r0: TOWER_BULB, r1: 0.5, y0: 0.93, y1: 0.96, segs: 14, col: white });
  pushCylinder(P, { r0: 0.18, r1: 0.1, y0: 0.96, y1: 1.0, segs: 6, col: red });
  return manMade(P);
}

/** Bridge deck: unit box (x span, y thickness, z depth) with a darker road top and truss girders. */
export function deckGeometry() {
  const P = { pos: [], colr: [], idx: [] };
  const steel = hex('#d4432a'), road = hex('#4a4a4e'), under = hex('#9c3020');
  pushBox(P, -0.5, 0.5, 0.35, 1, -0.5, 0.5, steel, road, under);
  pushBox(P, -0.5, 0.5, 0, 0.35, -0.5, -0.36, under, steel, under);
  pushBox(P, -0.5, 0.5, 0, 0.35, 0.36, 0.5, under, steel, under);
  return manMade(P);
}

/** Bridge pier: concrete cylinder, unit radius & height. */
export function pierGeometry() {
  const P = { pos: [], colr: [], idx: [] };
  pushCylinder(P, { r0: 1.2, r1: 1, y0: -0.02, y1: 1, segs: 10, col: hex('#c9c3b8') });
  return manMade(P);
}

/** Pine tree: trunk + three cone tiers, unit height (instanced by the terrain streamer). */
export function pineGeometry() {
  const P = { pos: [], colr: [], idx: [] };
  pushCylinder(P, { r0: 0.05, r1: 0.04, y0: -0.05, y1: 0.28, segs: 5, col: hex('#5a3a22') });
  const tiers = [
    [0.14, 0.62, 0.27, hex('#1d5a26')],
    [0.4, 0.84, 0.2, hex('#236a2c')],
    [0.62, 1.0, 0.13, hex('#2c7a34')]
  ];
  for (const [y0, y1, r, col] of tiers) pushCylinder(P, { r0: r, r1: 0.005, y0, y1, segs: 7, col });
  return manMade(P);
}

/** Material for man-made obstacles and trees (vertex colours, world fog). */
export function createPropMaterial({ roughness = 0.6, metalness = 0.15 } = {}) {
  return applyWorldFog(new MeshStandardMaterial({ vertexColors: true, roughness, metalness }));
}

// ------------------------------------------------------------------ field
const _f = makeFrame();
const _up = new Vector3(0, 1, 0);
const _rh = new Vector3();
const _th = new Vector3();
const _zb = new Vector3();
const _p = new Vector3();
const _q = new Quaternion();
const _qs = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();
const _mb = new Matrix4();

/**
 * Obstacles of a terrain stage: layout + instanced meshes (≤ 2 draw calls per
 * kind; arch legs share the pillar mesh) + rail-space collision queries.
 * Create before the stage precompiles; call update(playerS) every step (cheap
 * unless an obstacle enters / leaves the visible window).
 */
export class ObstacleField {
  constructor({ def, shape, rail, scene, rockMaterial, propMaterial, csm = null, boxX = 200, range = 6000 }) {
    this.shape = shape;
    this.rail = rail;
    this.scene = scene;
    this.range = range;
    const railY = (s) => rail.positionAt(Math.max(0, Math.min(rail.length, s)), _p).y;
    const lay = layoutObstacles(def, { shape, railY, boxX, length: rail.length });
    this.list = lay.list;
    this.parts = lay.parts;
    this.maxHalf = lay.maxHalf;
    this.meshes = [];
    this.propMaterial = propMaterial;
    this.rockMaterial = rockMaterial;
    csm?.setupMaterial(rockMaterial);
    csm?.setupMaterial(propMaterial);
    // instance records per mesh kind
    const rec = { pillar: [], spire: [], beam: [], tower: [], deck: [], pier: [] };
    const add = (key, s, x, y, sx, sy, sz, spin = 0) => {
      rail.frameAt(Math.max(0, Math.min(rail.length, s)), _f);
      _rh.crossVectors(_f.T, _up).normalize();
      _th.set(_f.T.x, 0, _f.T.z).normalize();
      _zb.copy(_th).negate();
      _mb.makeBasis(_rh, _up, _zb);
      _q.setFromRotationMatrix(_mb);
      if (spin) _q.multiply(_qs.setFromAxisAngle(_up, spin));
      _p.copy(_f.pos).addScaledVector(_rh, x);
      _p.y = y;
      _m.compose(_p, _q, _s.set(sx, sy, sz));
      rec[key].push({ s, e: new Float32Array(_m.elements) });
    };
    for (const o of this.list) {
      const spin = (o.s * 0.0137) % (Math.PI * 2);
      if (o.kind === 'pillar') add('pillar', o.s, o.x, o.base, o.r, o.top - o.base, o.r, spin);
      else if (o.kind === 'spire') add('spire', o.s, o.x, o.base, o.r, o.top - o.base, o.r, spin);
      else if (o.kind === 'tower') add('tower', o.s, o.x, o.base, o.r, o.top - o.base, o.r);
      else if (o.kind === 'arch') {
        for (let i = 0; i < 2; i++) add('pillar', o.s, o.legs[i], o.legBase[i], o.r * 1.08, o.beamY1 + 6 - o.legBase[i], o.r * 1.08, spin + i);
        add('beam', o.s, (o.legs[0] + o.legs[1]) / 2, o.beamY0, o.w + o.r * 2.4, o.thick, o.depth);
      } else if (o.kind === 'bridge') {
        add('deck', o.s, (o.x0 + o.x1) / 2, o.deckY0, o.x1 - o.x0, o.thick, o.depth);
        for (const pr of o.piers) add('pier', o.s, pr.x, pr.base, o.r, o.deckY0 - pr.base + 0.5, o.r);
      }
    }
    const geos = {
      pillar: () => rockColumnGeometry({ seed: 3 }),
      spire: () => rockColumnGeometry({ spire: true, seed: 5, segs: 12 }),
      beam: () => archBeamGeometry(),
      tower: () => towerGeometry(),
      deck: () => deckGeometry(),
      pier: () => pierGeometry()
    };
    for (const key of Object.keys(rec)) {
      const list = rec[key].sort((a, b) => a.s - b.s);
      if (!list.length) continue;
      const rock = key === 'pillar' || key === 'spire' || key === 'beam';
      const mesh = new InstancedMesh(geos[key](), rock ? rockMaterial : propMaterial, list.length);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `obstacle-${key}`;
      scene.add(mesh);
      this.meshes.push({ key, mesh, list, lo: -1, hi: -1 });
    }
    this._free = [];
  }

  /** Show the obstacles in [s − 400, s + range]. */
  update(playerS) {
    const a = playerS - 400, b = playerS + this.range;
    for (const m of this.meshes) {
      const L = m.list;
      let lo = Math.max(0, m.lo);
      while (lo > 0 && L[lo - 1].s >= a) lo--;
      while (lo < L.length && L[lo].s < a) lo++;
      let hi = Math.max(lo, m.hi);
      while (hi > lo && L[hi - 1].s > b) hi--;
      while (hi < L.length && L[hi].s <= b) hi++;
      if (lo === m.lo && hi === m.hi) continue;
      m.lo = lo;
      m.hi = hi;
      const arr = m.mesh.instanceMatrix.array;
      for (let i = lo; i < hi; i++) arr.set(L[i].e, (i - lo) * 16);
      m.mesh.count = hi - lo;
      m.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Index of the first part that can overlap [s − margin, …] (parts are sorted by s0). */
  firstIndex(s, margin = 0) {
    const P = this.parts;
    let lo = 0, hi = P.length;
    const key = s - margin - this.maxHalf;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (P[m].s0 < key) lo = m + 1;
      else hi = m;
    }
    return lo;
  }

  /**
   * Nearest obstacle part to (s, x, world y) within `margin` metres along s.
   * Fills `out` = { d, part } (d = signed distance, Infinity when nothing is near).
   */
  nearest(s, x, y, out, margin = 40) {
    out.d = Infinity;
    out.part = null;
    const P = this.parts;
    for (let i = this.firstIndex(s, margin); i < P.length; i++) {
      const p = P[i];
      if (p.s0 > s + margin) break;
      if (p.s1 < s - margin) continue;
      const d = partDistance(p, s, x, y);
      if (d < out.d) {
        out.d = d;
        out.part = p;
      }
    }
    return out;
  }

  /** Signed distance to the nearest obstacle surface (Infinity when none within 40 m along s). */
  query(s, x, y) {
    return this.nearest(s, x, y, this._hit || (this._hit = {}), 40).d;
  }

  /**
   * Free lateral intervals of [xa, xb] around s (±margin along s) at world altitude y:
   * fills out = [a0, b0, a1, b1, …].
   */
  freeIntervals(s, y, xa, xb, out, margin = 20) {
    return this.freeIntervalsIn(s - margin, s + margin, y, xa, xb, out);
  }

  /** s of the first part in [s0, s1] that blocks world altitude y (null = any altitude), or null. */
  nextBlocking(s0, s1, y) {
    const P = this.parts;
    for (let i = this.firstIndex(s0, 0); i < P.length; i++) {
      const p = P[i];
      if (p.s0 > s1) break;
      if (p.s1 < s0) continue;
      if (y != null) {
        if (p.type === 'cyl' && (y < p.y0 - 20 || y > p.y1 + 8)) continue;
        if (p.type === 'box' && (y < p.y0 - 10 || y > p.y1 + 8)) continue;
      }
      return p.type === 'cyl' ? p.s : (p.s0 + p.s1) / 2;
    }
    return null;
  }

  /** Free lateral intervals left by every part overlapping [s0, s1] (full radius) at world altitude y (null = any). */
  freeIntervalsIn(s0, s1, y, xa, xb, out) {
    const P = this.parts;
    const bl = this._free;
    bl.length = 0;
    for (let i = this.firstIndex(s0, 0); i < P.length; i++) {
      const p = P[i];
      if (p.s0 > s1) break;
      if (p.s1 < s0) continue;
      if (p.type === 'cyl') {
        if (y != null && (y < p.y0 - 20 || y > p.y1 + 8)) continue;
        const r = Math.max(p.r, p.rTop);
        bl.push(p.x - r, p.x + r);
      } else if (y != null && y > p.y0 - 10 && y < p.y1 + 8) bl.push(p.x0, p.x1);
    }
    return freeFrom(bl, xa, xb, out);
  }

  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m.mesh);
      m.mesh.geometry.dispose();
      m.mesh.dispose?.();
    }
    this.meshes.length = 0;
  }
}

export { blocked as _blocked, freeFrom as _freeFrom };
