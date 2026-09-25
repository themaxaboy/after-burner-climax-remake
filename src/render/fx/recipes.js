// Emitter recipes: pure functions that describe effects as sets of stateless
// particles. They write a reusable particle template `P` and hand it to a
// sink (the FX particle layers in-game, a counter in the unit tests):
//
//   sink.time        current world time (s)
//   sink.q           quality count multiplier
//   sink.flares      max flares per burst
//   sink.rand()      uniform [0,1)
//   sink.add(P)      additive layer (fire, sparks, flashes)
//   sink.smoke(P)    premultiplied-alpha layer (smoke, spray, debris)
//   sink.flareTrail(x,y,z, vx,vy,vz, k, ay, life, delay) -> bool  (ribbon follower)
//
// Delayed effects (secondary bursts, debris smoke trails) are expressed with
// t0 in the future: the GPU keeps those particles hidden until then.
import { motionAt, velocityAt } from './ballistic.js';
import {
  K_FIRE, K_FLASH, K_SPARK, K_GLOW, K_FLARE, K_RING, K_EMBER, K_MUZZLE,
  S_SMOKE, S_DEBRIS, S_SPRAY, S_MIST, S_FIRE
} from './config.js';

const TAU = Math.PI * 2;

/**
 * Soot albedo of explosion smoke. Not near-black: 0.07 read as holes in the
 * image (and blacked out the screen when the camera flew through a kill).
 */
export const SMOKE_SHADE = 0.13;
/** Size multiplier applied to kind 'big' explosions (a bomber kill at size 6 -> ~10). */
export const BIG_SCALE = 1.6;

/**
 * Smoke puffs grow sub-linearly with the explosion size: big blasts get more
 * spread-out billows instead of a few screen-filling blobs.
 */
function smokeScale(s) {
  return s <= 1 ? s : Math.pow(s, 0.8);
}

export function makeParticle() {
  return resetParticle({});
}

/** Particle template (fields map 1:1 onto the GPU instance attributes). */
export function resetParticle(P) {
  P.x = 0; P.y = 0; P.z = 0; P.t0 = 0;
  P.vx = 0; P.vy = 0; P.vz = 0; P.life = 1;
  P.s0 = 1; P.s1 = 1; P.rot = 0; P.spin = 0;
  P.drag = 0; P.ay = 0; P.seed = 0; P.kind = 0;
  P.r = 1; P.g = 1; P.b = 1; P.i = 1;
  P.p0 = 0; P.p1 = 0; P.p2 = 1; P.p3 = 0;
  return P;
}

/** mulberry32: tiny seedable PRNG (no allocations). */
export class FxRng {
  constructor(seed = 1) {
    this.s = seed >>> 0;
  }
  seed(s) {
    this.s = s >>> 0;
    return this;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const U = { x: 0, y: 0, z: 0 };
const M = { x: 0, y: 0, z: 0 };
const V = { x: 0, y: 0, z: 0 };
const B = { x: 0, y: 0, z: 0 };
const S = { x: 0, y: 0, z: 0 };

function randUnit(sink, out) {
  const z = sink.rand() * 2 - 1;
  const a = sink.rand() * TAU;
  const r = Math.sqrt(1 - z * z);
  out.x = r * Math.cos(a);
  out.y = z;
  out.z = r * Math.sin(a);
  return out;
}

function norm(o) {
  const l = Math.hypot(o.x, o.y, o.z) || 1;
  o.x /= l; o.y /= l; o.z /= l;
  return o;
}

export function countOf(sink, base, min = 1) {
  const n = Math.round(base * sink.q);
  return n < min ? min : n;
}

function begin(sink, P, x, y, z, kind) {
  resetParticle(P);
  P.x = x; P.y = y; P.z = z;
  P.t0 = sink.time;
  P.seed = sink.rand();
  P.rot = sink.rand() * TAU;
  P.kind = kind;
  return P;
}

// ---------------------------------------------------------------- pieces

function flash(sink, P, x, y, z, vx, vy, vz, s, delay, inten = 40) {
  begin(sink, P, x, y, z, K_FLASH);
  P.vx = vx * 0.5; P.vy = vy * 0.5; P.vz = vz * 0.5; P.drag = 3;
  P.t0 += delay;
  P.life = 0.09 + 0.03 * Math.sqrt(s);
  P.s0 = 6 * s; P.s1 = 13 * s; P.p2 = 2;
  P.r = 1; P.g = 0.8; P.b = 0.55; P.i = inten * 0.45;
  sink.add(P);
  begin(sink, P, x, y, z, K_GLOW);
  P.vx = vx * 0.5; P.vy = vy * 0.5; P.vz = vz * 0.5; P.drag = 3;
  P.t0 += delay;
  P.life = 0.7 + 0.25 * Math.sqrt(s);
  P.s0 = 16 * s; P.s1 = 26 * s; P.p0 = 2.5;
  P.life = 0.55 + 0.15 * Math.sqrt(s);
  P.r = 1; P.g = 0.4; P.b = 0.1; P.i = 0.7;
  sink.add(P);
}

function fireball(sink, P, x, y, z, vx, vy, vz, s, n, delay, inherit = 0.85, heat = 1, lifeMul = 1) {
  const ls = Math.pow(s, 0.3) * lifeMul;
  for (let i = 0; i < n; i++) {
    randUnit(sink, U);
    const rr = Math.cbrt(sink.rand()) * 2.6 * s;
    const r = sink.rand();
    begin(sink, P, x + U.x * rr, y + U.y * rr * 0.8, z + U.z * rr, S_FIRE);
    randUnit(sink, U);
    const sp = (8 + 16 * r) * s;
    P.vx = vx * inherit + U.x * sp;
    P.vy = vy * inherit + U.y * sp + 2 * s;
    P.vz = vz * inherit + U.z * sp;
    P.drag = 3.2 + sink.rand();
    P.ay = 4;
    P.t0 += delay + sink.rand() * 0.07;
    P.life = (0.6 + 0.6 * sink.rand()) * ls;
    P.s0 = (4 + 2.5 * sink.rand()) * s;
    P.s1 = (9 + 6 * r) * s;
    P.spin = (sink.rand() - 0.5) * 1.6;
    P.p0 = heat * (0.85 + 0.3 * sink.rand());
    P.p1 = 1;
    P.p2 = 2.4;
    P.i = 0.95;
    sink.smoke(P);
  }
  // additive glowing heart: reads as a bright fireball through its own smoke (and feeds bloom)
  const ng = n > 6 ? 4 : 2;
  for (let i = 0; i < ng; i++) {
    randUnit(sink, U);
    const rr = sink.rand() * 1.4 * s;
    begin(sink, P, x + U.x * rr, y + U.y * rr, z + U.z * rr, K_FIRE);
    randUnit(sink, U);
    P.vx = vx * inherit + U.x * 6 * s; P.vy = vy * inherit + U.y * 6 * s + 2 * s; P.vz = vz * inherit + U.z * 6 * s;
    P.drag = 3.5;
    P.ay = 3;
    P.t0 += delay + sink.rand() * 0.05;
    P.life = (0.45 + 0.3 * sink.rand()) * ls;
    P.s0 = (4 + 1.5 * sink.rand()) * s; P.s1 = (9 + 3 * sink.rand()) * s;
    P.spin = (sink.rand() - 0.5) * 1.5;
    P.p0 = heat * (0.9 + 0.25 * sink.rand());
    P.p1 = 1;
    P.p2 = 1.8;
    P.i = 0.8;
    sink.add(P);
  }
  // hot core
  const nc = n > 6 ? 3 : 1;
  for (let i = 0; i < nc; i++) {
    begin(sink, P, x, y, z, S_FIRE);
    randUnit(sink, U);
    P.vx = vx * inherit + U.x * 3 * s; P.vy = vy * inherit + U.y * 3 * s; P.vz = vz * inherit + U.z * 3 * s;
    P.drag = 4;
    P.ay = 3;
    P.t0 += delay + i * 0.03;
    P.life = (0.4 + 0.15 * sink.rand()) * ls;
    P.s0 = 4.5 * s; P.s1 = 11 * s;
    P.spin = (sink.rand() - 0.5) * 2;
    P.p0 = heat * 1.35;
    P.p1 = 0.7;
    P.p2 = 2.0;
    P.i = 1;
    sink.smoke(P);
  }
}

function smokeBall(sink, P, x, y, z, vx, vy, vz, s, n, delay, lifeMul = 1, shade = SMOKE_SHADE, glow = 1.2) {
  const ls = Math.pow(s, 0.3) * lifeMul;
  const sz = smokeScale(s);
  for (let i = 0; i < n; i++) {
    randUnit(sink, U);
    const rr = Math.cbrt(sink.rand()) * 2.4 * s;
    begin(sink, P, x + U.x * rr, y + U.y * rr * 0.7, z + U.z * rr, S_SMOKE);
    randUnit(sink, U);
    const sp = (3 + 9 * sink.rand()) * s;
    P.vx = vx * 0.5 + U.x * sp;
    P.vy = vy * 0.5 + U.y * sp * 0.7 + 1.5 * s;
    P.vz = vz * 0.5 + U.z * sp;
    P.drag = 1.3 + 0.4 * sink.rand();
    P.ay = 1.2;
    P.t0 += delay + 0.06 + 0.2 * sink.rand();
    P.life = (4 + 3 * sink.rand()) * ls;
    P.s0 = (5 + 2 * sink.rand()) * sz;
    P.s1 = (17 + 10 * sink.rand()) * sz;
    P.spin = (sink.rand() - 0.5) * 0.35;
    const a = shade * (0.8 + 0.5 * sink.rand());
    P.r = a * 1.02; P.g = a * 0.97; P.b = a * 0.93;
    P.i = 0.94;
    P.p0 = glow * (0.7 + 0.6 * sink.rand());
    P.p2 = 2.2;
    P.p3 = 0.08;
    sink.smoke(P);
  }
  // a few late puffs rising out of the top: breaks the round silhouette
  const nr = n > 6 ? 3 : 1;
  for (let i = 0; i < nr; i++) {
    begin(sink, P, x + (sink.rand() - 0.5) * 4 * s, y + 3 * s, z + (sink.rand() - 0.5) * 4 * s, S_SMOKE);
    P.vx = vx * 0.3 + (sink.rand() - 0.5) * 6 * s;
    P.vy = vy * 0.3 + (7 + 6 * sink.rand()) * s;
    P.vz = vz * 0.3 + (sink.rand() - 0.5) * 6 * s;
    P.drag = 1.1; P.ay = 2.5;
    P.t0 += delay + 0.25 + 0.35 * sink.rand();
    P.life = (4.5 + 3 * sink.rand()) * ls;
    P.s0 = 4 * sz; P.s1 = (14 + 8 * sink.rand()) * sz;
    P.spin = (sink.rand() - 0.5) * 0.3;
    const a = shade * (0.9 + 0.5 * sink.rand());
    P.r = a; P.g = a * 0.97; P.b = a * 0.94;
    P.i = 0.7;
    P.p0 = glow * 0.4;
    P.p2 = 1.8;
    P.p3 = 0.12;
    sink.smoke(P);
  }
}

function sparks(sink, P, x, y, z, vx, vy, vz, s, n, delay, inherit = 0.6) {
  const ss = Math.sqrt(s);
  for (let i = 0; i < n; i++) {
    begin(sink, P, x, y, z, K_SPARK);
    randUnit(sink, U);
    U.y += 0.25;
    norm(U);
    const sp = (50 + 130 * sink.rand()) * ss;
    P.vx = vx * inherit + U.x * sp; P.vy = vy * inherit + U.y * sp; P.vz = vz * inherit + U.z * sp;
    P.drag = 1.4 + sink.rand() * 0.6;
    P.ay = -9.8;
    P.t0 += delay + sink.rand() * 0.04;
    P.life = 0.45 + 0.9 * sink.rand();
    P.s0 = P.s1 = (0.15 + 0.15 * sink.rand()) * ss;
    P.r = 1; P.g = 0.55 + 0.2 * sink.rand(); P.b = 0.2;
    P.i = 18;
    P.p1 = 0.05;
    sink.add(P);
  }
}

function embers(sink, P, x, y, z, vx, vy, vz, s, n, delay) {
  const ss = Math.sqrt(s);
  for (let i = 0; i < n; i++) {
    begin(sink, P, x, y, z, K_EMBER);
    randUnit(sink, U);
    U.y += 0.4;
    norm(U);
    const sp = (12 + 35 * sink.rand()) * ss;
    P.vx = vx * 0.5 + U.x * sp; P.vy = vy * 0.5 + U.y * sp; P.vz = vz * 0.5 + U.z * sp;
    P.drag = 0.9;
    P.ay = -5;
    P.t0 += delay;
    P.life = 1.2 + 1.4 * sink.rand();
    P.s0 = 0.35 * ss; P.s1 = 0.12 * ss;
    P.r = 1; P.g = 0.4; P.b = 0.1;
    P.i = 9;
    sink.add(P);
  }
}

function ring(sink, P, x, y, z, radius, life, inten, delay = 0) {
  begin(sink, P, x, y, z, K_RING);
  P.t0 += delay;
  P.life = life;
  P.s0 = radius * 0.06;
  P.s1 = radius;
  P.p2 = 2.6;
  P.r = 1; P.g = 0.94; P.b = 0.86;
  P.i = inten;
  sink.add(P);
}

// ---------------------------------------------------------------- recipes

/** Tumbling hot fragments with dark smoke trails (stateless: trail puffs are pre-scheduled along the analytic path). */
export function recipeDebris(sink, P, x, y, z, vx, vy, vz, count, s = 1, shade = 0.3, delay = 0) {
  const ss = Math.sqrt(s);
  const nT = countOf(sink, 13, 4);
  for (let i = 0; i < count; i++) {
    randUnit(sink, U);
    U.y += 0.35;
    norm(U);
    const sp = (20 + 45 * sink.rand()) * ss;
    const dvx = vx * 0.65 + U.x * sp, dvy = vy * 0.65 + U.y * sp, dvz = vz * 0.65 + U.z * sp;
    const k = 0.4 + 0.3 * sink.rand();
    const life = 2.2 + 2.3 * sink.rand();
    const t0 = sink.time + delay;
    begin(sink, P, x, y, z, S_DEBRIS);
    P.vx = dvx; P.vy = dvy; P.vz = dvz; P.drag = k; P.ay = -9.8;
    P.t0 = t0;
    P.life = life;
    P.s0 = P.s1 = (0.6 + 1.1 * sink.rand()) * (0.8 + 0.4 * ss);
    P.spin = (sink.rand() < 0.5 ? -1 : 1) * (5 + 10 * sink.rand());
    const a = shade * (0.8 + 0.4 * sink.rand());
    P.r = a; P.g = a; P.b = a * 1.05;
    P.i = 1;
    P.p0 = shade > 0.2 ? 1 : 0; // glowing hot metal (not for dirt)
    sink.smoke(P);
    // smoke trail puffs scheduled along the path
    const dt = 0.055 + 0.025 * sink.rand();
    for (let j = 0; j < nT; j++) {
      const tj = 0.04 + j * dt * (1 + 0.12 * j);
      if (tj > life * 0.85) break;
      motionAt(M, x, y, z, dvx, dvy, dvz, k, -9.8, tj);
      velocityAt(V, dvx, dvy, dvz, k, -9.8, tj);
      begin(sink, P, M.x, M.y, M.z, S_SMOKE);
      P.vx = V.x * 0.06 + (sink.rand() - 0.5) * 2;
      P.vy = V.y * 0.06 + (sink.rand() - 0.5) * 2;
      P.vz = V.z * 0.06 + (sink.rand() - 0.5) * 2;
      P.drag = 1.2; P.ay = 0.6;
      P.t0 = t0 + tj;
      P.life = 1.0 + 1.0 * sink.rand();
      P.s0 = (1.8 + 0.8 * sink.rand()) * (0.7 + 0.3 * ss);
      P.s1 = (5 + 3 * sink.rand()) * (0.7 + 0.3 * ss);
      const g = shade > 0.2 ? 0.11 + 0.05 * sink.rand() : shade * 0.8;
      P.r = g * 1.02; P.g = g; P.b = g * 0.95;
      P.i = 0.6 * (1 - (j / nT) * 0.5);
      P.p0 = j < 2 && shade > 0.2 ? 0.7 : 0;
      P.p2 = 1.8;
      P.p3 = 0.1;
      sink.smoke(P);
      if (j < 3 && shade > 0.2) {
        begin(sink, P, M.x, M.y, M.z, K_FIRE);
        P.vx = V.x * 0.2; P.vy = V.y * 0.2; P.vz = V.z * 0.2; P.drag = 2;
        P.t0 = t0 + tj;
        P.life = 0.28 + 0.1 * sink.rand();
        P.s0 = 0.9 * ss; P.s1 = 2.6 * ss;
        P.p0 = 0.95; P.p1 = 1; P.p2 = 1.5;
        sink.add(P);
      }
    }
  }
}

function airExplosion(sink, P, x, y, z, vx, vy, vz, s, opt) {
  const cm = opt.countMul || 1;
  const d = opt.delay || 0;
  if (opt.flash !== false) flash(sink, P, x, y, z, vx, vy, vz, s, d, opt.flashI || 30);
  // smoke first: within the premultiplied layer later slots draw on top, so the fire stays in front
  if (opt.smoke !== false) smokeBall(sink, P, x, y, z, vx, vy, vz, s, countOf(sink, 12 * cm, 4), d, opt.smokeLife || 1);
  fireball(sink, P, x, y, z, vx, vy, vz, s, countOf(sink, 18 * cm, 5), d, 0.85, opt.heat || 1.3, opt.fireLife || 1);
  sparks(sink, P, x, y, z, vx, vy, vz, s, countOf(sink, 26 * cm, 6), d);
  embers(sink, P, x, y, z, vx, vy, vz, s, countOf(sink, 8 * cm, 2), d);
  if (opt.debris !== false) recipeDebris(sink, P, x, y, z, vx, vy, vz, countOf(sink, 6 * cm * Math.sqrt(s), 2), s, 0.3, d);
  if (opt.ring) ring(sink, P, x, y, z, 30 * s, 0.4 + 0.05 * s, 0.9, d);
}

/**
 * Explosion recipe. kind: 'air' | 'big' | 'ground' | 'water' | 'missile' | 'lite'.
 * size 1 = fireball ~25-40 m across (the stage uses ~2.6 for fighter kills);
 * 'big' multiplies the size by BIG_SCALE and adds delayed secondary bursts.
 * 'lite' is the cheap version used when many kills land at once (Climax
 * salvos): flash, a small fireball, sparks and a few smoke puffs (~25 particles).
 */
export function recipeExplosion(sink, P, x, y, z, vx, vy, vz, size = 1, kind = 'air') {
  const s = size;
  switch (kind) {
    case 'lite': {
      flash(sink, P, x, y, z, vx, vy, vz, s * 0.8, 0, 34);
      smokeBall(sink, P, x, y, z, vx, vy, vz, s * 0.8, countOf(sink, 4, 2), 0, 0.7);
      fireball(sink, P, x, y, z, vx, vy, vz, s * 0.85, countOf(sink, 7, 3), 0, 0.85, 1.1, 0.9);
      sparks(sink, P, x, y, z, vx, vy, vz, s, countOf(sink, 10, 3), 0);
      break;
    }
    case 'big': {
      const S2 = s * BIG_SCALE;
      airExplosion(sink, P, x, y, z, vx, vy, vz, S2, { countMul: 1.5, ring: true, smokeLife: 1.4, flashI: 50, fireLife: 1.3 });
      // secondary delayed bursts around the wreck
      for (let i = 0; i < 3; i++) {
        randUnit(sink, U);
        const off = 14 * S2 * (0.5 + 0.5 * sink.rand());
        const dl = 0.15 + i * 0.22 + sink.rand() * 0.12;
        airExplosion(sink, P, x + U.x * off + vx * dl * 0.4, y + U.y * off * 0.5 + vy * dl * 0.4, z + U.z * off + vz * dl * 0.4,
          vx * 0.4, vy * 0.4, vz * 0.4, S2 * 0.45, { countMul: 0.6, delay: dl, debris: i === 0, ring: false, flashI: 25 });
      }
      break;
    }
    case 'missile': {
      const S2 = s * 0.5;
      flash(sink, P, x, y, z, vx, vy, vz, S2, 0, 25);
      smokeBall(sink, P, x, y, z, vx, vy, vz, S2, countOf(sink, 4, 2), 0, 0.7, 0.12, 0.8);
      fireball(sink, P, x, y, z, vx, vy, vz, S2, countOf(sink, 8, 3), 0, 0.7, 1.1, 0.8);
      sparks(sink, P, x, y, z, vx, vy, vz, S2, countOf(sink, 12, 4), 0, 0.5);
      break;
    }
    case 'ground': {
      flash(sink, P, x, y + 2 * s, z, 0, 0, 0, s, 0, 30);
      sparks(sink, P, x, y + 2 * s, z, 0, 0, 0, s, countOf(sink, 16, 4), 0);
      // dust ring hugging the ground
      const nd = countOf(sink, 12, 4);
      for (let i = 0; i < nd; i++) {
        const a = (i / nd) * TAU + sink.rand() * 0.4;
        const r = sink.rand();
        begin(sink, P, x + Math.cos(a) * 3 * s, y + 2 * s, z + Math.sin(a) * 3 * s, S_SMOKE);
        const sp = (15 + 15 * r) * s;
        P.vx = Math.cos(a) * sp; P.vy = 3 * s * sink.rand(); P.vz = Math.sin(a) * sp;
        P.drag = 1.8; P.ay = 0.8;
        P.t0 += 0.03 + 0.1 * sink.rand();
        P.life = 3 + 2 * sink.rand();
        P.s0 = 3 * s; P.s1 = (14 + 8 * r) * s;
        P.r = 0.3; P.g = 0.22; P.b = 0.15; P.i = 0.75;
        P.p2 = 2.2; P.p3 = 0.05;
        sink.smoke(P);
      }
      // dirt thrown up
      const ns = countOf(sink, 12, 4);
      for (let i = 0; i < ns; i++) {
        begin(sink, P, x, y + 1.5 * s, z, S_SPRAY);
        U.x = (sink.rand() - 0.5) * 0.9; U.y = 1; U.z = (sink.rand() - 0.5) * 0.9;
        norm(U);
        const sp = (20 + 25 * sink.rand()) * Math.sqrt(s);
        P.vx = U.x * sp; P.vy = U.y * sp; P.vz = U.z * sp;
        P.drag = 0.8; P.ay = -9.8;
        P.t0 += sink.rand() * 0.08;
        P.life = 1.2 + 1.0 * sink.rand();
        P.s0 = 1.4 * s; P.s1 = (5 + 3 * sink.rand()) * s;
        P.r = 0.2; P.g = 0.15; P.b = 0.1; P.i = 0.9;
        P.p1 = 0.04; P.p2 = 1.6;
        sink.smoke(P);
      }
      // dark smoke column
      const nc = countOf(sink, 6, 2);
      for (let i = 0; i < nc; i++) {
        begin(sink, P, x + (sink.rand() - 0.5) * 4 * s, y + 4 * s, z + (sink.rand() - 0.5) * 4 * s, S_SMOKE);
        P.vy = (6 + 8 * sink.rand()) * s; P.vx = (sink.rand() - 0.5) * 3; P.vz = (sink.rand() - 0.5) * 3;
        P.drag = 0.6; P.ay = 1.5;
        P.t0 += 0.1 + 0.3 * sink.rand();
        P.life = 6 + 3 * sink.rand();
        P.s0 = 5 * s; P.s1 = (20 + 8 * sink.rand()) * s;
        P.r = P.g = P.b = SMOKE_SHADE * 0.9; P.i = 0.85;
        P.p0 = 1; P.p2 = 1.8; P.p3 = 0.06;
        sink.smoke(P);
      }
      fireball(sink, P, x, y + 5 * s, z, 0, 0, 0, s, countOf(sink, 12, 4), 0, 0, 1, 1);
      recipeDebris(sink, P, x, y + 2 * s, z, 0, 0, 0, countOf(sink, 5, 2), s, 0.12);
      if (s >= 2) ring(sink, P, x, y + 3 * s, z, 22 * s, 0.4 + 0.04 * s, 0.8);
      break;
    }
    case 'water': {
      flash(sink, P, x, y + 3 * s, z, 0, 0, 0, s * 0.8, 0, 30);
      sparks(sink, P, x, y + 2 * s, z, 0, 0, 0, s * 0.7, countOf(sink, 10, 3), 0);
      recipeSplash(sink, P, x, y, z, s * 1.2);
      fireball(sink, P, x, y + 4 * s, z, vx * 0.2, 0, vz * 0.2, s * 0.6, countOf(sink, 6, 2), 0, 0, 1, 0.7);
      if (s >= 2) ring(sink, P, x, y + 3 * s, z, 22 * s, 0.4 + 0.04 * s, 0.8);
      break;
    }
    default:
      airExplosion(sink, P, x, y, z, vx, vy, vz, s, { ring: s >= 2, flashI: 40 });
  }
}

/** White plume + spray crown + mist when something hits the sea. */
export function recipeSplash(sink, P, x, y, z, s = 1) {
  const ss = Math.sqrt(s);
  const nCol = countOf(sink, 22, 6);
  for (let i = 0; i < nCol; i++) {
    begin(sink, P, x + (sink.rand() - 0.5) * 2 * s, y + 1, z + (sink.rand() - 0.5) * 2 * s, S_SPRAY);
    U.x = (sink.rand() - 0.5) * 0.55; U.y = 1; U.z = (sink.rand() - 0.5) * 0.55;
    norm(U);
    const sp = (25 + 45 * sink.rand()) * ss;
    P.vx = U.x * sp; P.vy = U.y * sp; P.vz = U.z * sp;
    P.drag = 0.7; P.ay = -9.8;
    P.t0 += sink.rand() * 0.12;
    P.life = 2.0 + 1.6 * sink.rand();
    P.s0 = (2.2 + 2 * sink.rand()) * s; P.s1 = (8 + 6 * sink.rand()) * s;
    P.r = 0.92; P.g = 0.95; P.b = 0.97; P.i = 1;
    P.p1 = 0.05; P.p2 = 1.5;
    sink.smoke(P);
  }
  const nRing = countOf(sink, 14, 5);
  for (let i = 0; i < nRing; i++) {
    const a = (i / nRing) * TAU + sink.rand() * 0.3;
    begin(sink, P, x + Math.cos(a) * 2 * s, y + 0.5, z + Math.sin(a) * 2 * s, S_SPRAY);
    const sp = (14 + 10 * sink.rand()) * ss;
    P.vx = Math.cos(a) * sp; P.vy = sp * 0.7; P.vz = Math.sin(a) * sp;
    P.drag = 1.2; P.ay = -9.8;
    P.t0 += 0.02 + sink.rand() * 0.06;
    P.life = 1.2 + 0.8 * sink.rand();
    P.s0 = 1.5 * s; P.s1 = 5 * s;
    P.r = 0.92; P.g = 0.95; P.b = 0.97; P.i = 0.85;
    P.p1 = 0.035; P.p2 = 1.5;
    sink.smoke(P);
  }
  const nMist = countOf(sink, 8, 3);
  for (let i = 0; i < nMist; i++) {
    const a = sink.rand() * TAU;
    begin(sink, P, x + Math.cos(a) * 4 * s, y + 2 * s + sink.rand() * 6 * s, z + Math.sin(a) * 4 * s, S_MIST);
    const sp = (4 + 6 * sink.rand()) * s;
    P.vx = Math.cos(a) * sp; P.vy = 3; P.vz = Math.sin(a) * sp;
    P.drag = 0.8; P.ay = 0.3;
    P.t0 += 0.2 + sink.rand() * 0.4;
    P.life = 3.5 + 2 * sink.rand();
    P.s0 = 7 * s; P.s1 = (22 + 10 * sink.rand()) * s;
    P.r = 0.92; P.g = 0.94; P.b = 0.97; P.i = 0.55;
    P.p2 = 1.6; P.p3 = 0.15;
    sink.smoke(P);
  }
  const nFoam = countOf(sink, 6, 2);
  for (let i = 0; i < nFoam; i++) {
    const a = (i / nFoam) * TAU;
    begin(sink, P, x, y + 1.5 * s, z, S_MIST);
    P.vx = Math.cos(a) * 12 * s; P.vz = Math.sin(a) * 12 * s;
    P.drag = 1.0;
    P.life = 3.5;
    P.s0 = 4 * s; P.s1 = 16 * s;
    P.r = 0.95; P.g = 0.97; P.b = 1; P.i = 0.5;
    P.p2 = 2; P.p3 = 0.1;
    sink.smoke(P);
  }
}

/**
 * Vulcan impact: sparks bouncing back along -dir + flash + glow + puff. Sized
 * for readability at combat range (a hit on a fighter 400 m out must pop).
 */
export function recipeHitSparks(sink, P, x, y, z, dx, dy, dz, count = 12) {
  const n = Math.max(2, Math.round(count * Math.max(0.6, sink.q)));
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  for (let i = 0; i < n; i++) {
    begin(sink, P, x, y, z, K_SPARK);
    randUnit(sink, U);
    U.x = U.x * 0.9 - dx * 0.6; U.y = U.y * 0.9 - dy * 0.6 + 0.15; U.z = U.z * 0.9 - dz * 0.6;
    norm(U);
    const sp = 50 + 100 * sink.rand();
    P.vx = U.x * sp; P.vy = U.y * sp; P.vz = U.z * sp;
    P.drag = 2.0; P.ay = -9.8;
    P.life = 0.18 + 0.32 * sink.rand();
    P.s0 = P.s1 = 0.12 + 0.08 * sink.rand();
    P.r = 1; P.g = 0.68; P.b = 0.3; P.i = 24;
    P.p1 = 0.04;
    sink.add(P);
  }
  begin(sink, P, x, y, z, K_FLASH);
  P.life = 0.08;
  P.s0 = 3.5; P.s1 = 5.2;
  P.r = 1; P.g = 0.88; P.b = 0.65; P.i = 30;
  sink.add(P);
  begin(sink, P, x, y, z, K_GLOW);
  P.life = 0.2;
  P.s0 = 5; P.s1 = 6.5;
  P.r = 1; P.g = 0.52; P.b = 0.2; P.i = 5; P.p0 = 1.5;
  sink.add(P);
  begin(sink, P, x, y, z, S_SMOKE);
  P.vx = -dx * 4; P.vy = -dy * 4 + 1; P.vz = -dz * 4; P.drag = 1.5; P.ay = 0.5;
  P.life = 0.6 + 0.3 * sink.rand();
  P.s0 = 1.0; P.s1 = 4.5;
  P.r = P.g = P.b = 0.32; P.i = 0.45;
  P.p2 = 2; P.p3 = 0.1;
  sink.smoke(P);
}

/** Vulcan muzzle flash (vel = shooter velocity so it stays on the gun). */
export function recipeMuzzle(sink, P, x, y, z, dx, dy, dz, vx = 0, vy = 0, vz = 0) {
  const dl = Math.hypot(dx, dy, dz) || 1;
  begin(sink, P, x, y, z, K_MUZZLE);
  P.vx = vx; P.vy = vy; P.vz = vz;
  P.life = 0.045 + 0.015 * sink.rand();
  P.s0 = P.s1 = 0.7 + 0.2 * sink.rand();
  P.r = dx / dl; P.g = dy / dl; P.b = dz / dl; // direction (colour is fixed in shader)
  P.i = 1.3;
  P.p1 = 3.5 + 2.0 * sink.rand(); // flame length (m)
  sink.add(P);
  begin(sink, P, x, y, z, K_GLOW);
  P.vx = vx; P.vy = vy; P.vz = vz;
  P.life = 0.06;
  P.s0 = 2.2; P.s1 = 3.0;
  P.r = 1; P.g = 0.6; P.b = 0.25; P.i = 4; P.p0 = 1; P.p3 = 1;
  sink.add(P);
}

/** Countermeasure flares: arcing magnesium flares with white smoke tails. */
export function recipeFlares(sink, P, x, y, z, vx, vy, vz) {
  const maxN = Math.max(3, Math.min(6, sink.flares | 0 || 5));
  let n = maxN - (sink.rand() < 0.5 ? 1 : 0);
  if (n < 3) n = 3;
  const sp0 = Math.hypot(vx, vy, vz);
  if (sp0 > 1) {
    B.x = -vx / sp0; B.y = -vy / sp0; B.z = -vz / sp0;
  } else {
    B.x = 0; B.y = 0; B.z = 1;
  }
  // side = back x up
  S.x = B.y * 0 - B.z * 1; S.y = B.z * 0 - B.x * 0; S.z = B.x * 1 - B.y * 0;
  if (Math.hypot(S.x, S.y, S.z) < 1e-3) { S.x = 1; S.y = 0; S.z = 0; }
  norm(S);
  for (let i = 0; i < n; i++) {
    const lat = n > 1 ? (i / (n - 1) - 0.5) * 2 : 0;
    U.x = B.x * 0.55 + S.x * lat * 0.8 + (sink.rand() - 0.5) * 0.25;
    U.y = B.y * 0.55 - 0.65 + S.y * lat * 0.8 + (sink.rand() - 0.5) * 0.25;
    U.z = B.z * 0.55 + S.z * lat * 0.8 + (sink.rand() - 0.5) * 0.25;
    norm(U);
    const sp = 28 + 14 * sink.rand();
    const fvx = vx + U.x * sp, fvy = vy + U.y * sp, fvz = vz + U.z * sp;
    const k = 1.25 + 0.3 * sink.rand();
    const life = 2.6 + 1.0 * sink.rand();
    const t0 = sink.time + i * 0.07;
    begin(sink, P, x, y, z, K_FLARE);
    P.vx = fvx; P.vy = fvy; P.vz = fvz; P.drag = k; P.ay = -9.8;
    P.t0 = t0; P.life = life;
    P.s0 = 3.6; P.s1 = 2.4; P.p2 = 1;
    P.r = 1; P.g = 0.88; P.b = 0.72; P.i = 1;
    sink.add(P);
    const pSeed = P.seed;
    begin(sink, P, x, y, z, K_GLOW);
    P.vx = fvx; P.vy = fvy; P.vz = fvz; P.drag = k; P.ay = -9.8;
    P.t0 = t0; P.life = life;
    P.s0 = 15; P.s1 = 10;
    P.r = 1; P.g = 0.8; P.b = 0.55; P.i = 3.2; P.p0 = 0.5; P.p3 = 1;
    P.seed = pSeed;
    sink.add(P);
    const hasTrail = sink.flareTrail(x, y, z, fvx, fvy, fvz, k, -9.8, life, i * 0.07);
    const nE = countOf(sink, 4, 1);
    for (let j = 0; j < nE; j++) {
      const tj = 0.15 + j * (life * 0.8) / nE;
      motionAt(M, x, y, z, fvx, fvy, fvz, k, -9.8, tj);
      velocityAt(V, fvx, fvy, fvz, k, -9.8, tj);
      begin(sink, P, M.x, M.y, M.z, K_EMBER);
      P.vx = V.x * 0.3 + (sink.rand() - 0.5) * 6; P.vy = V.y * 0.3; P.vz = V.z * 0.3 + (sink.rand() - 0.5) * 6;
      P.drag = 0.8; P.ay = -9.8;
      P.t0 = t0 + tj; P.life = 0.5 + 0.3 * sink.rand();
      P.s0 = 0.3; P.s1 = 0.1;
      P.r = 1; P.g = 0.8; P.b = 0.55; P.i = 12;
      sink.add(P);
    }
    if (!hasTrail) {
      // fallback: puffs along the path
      for (let j = 0; j < 10; j++) {
        const tj = 0.05 + j * 0.2;
        if (tj > life) break;
        motionAt(M, x, y, z, fvx, fvy, fvz, k, -9.8, tj);
        begin(sink, P, M.x, M.y, M.z, S_SMOKE);
        P.drag = 1; P.ay = 0.3;
        P.t0 = t0 + tj; P.life = 2;
        P.s0 = 1.2; P.s1 = 6;
        P.r = P.g = P.b = 0.85; P.i = 0.5;
        P.p2 = 1.6; P.p3 = 0.1;
        sink.smoke(P);
      }
    }
  }
  return n;
}

export function recipeShockRing(sink, P, x, y, z, size = 40) {
  ring(sink, P, x, y, z, size, 0.25 + 0.0025 * size, 1.8);
}

export function recipeSmokePuff(sink, P, x, y, z, vx, vy, vz, size = 4, life = 2) {
  begin(sink, P, x, y, z, S_SMOKE);
  P.vx = vx; P.vy = vy; P.vz = vz;
  P.drag = 1.0; P.ay = 0.4;
  P.life = life;
  P.s0 = size * 0.5; P.s1 = size * 1.6;
  P.spin = (sink.rand() - 0.5) * 0.5;
  P.r = P.g = P.b = 0.32; P.i = 0.7;
  P.p2 = 1.8; P.p3 = 0.1;
  sink.smoke(P);
}

/** One puff (and optional flame lick) of a burning-wreck smoke emitter. */
export function recipeEmitterPuff(sink, P, x, y, z, vx, vy, vz, intensity, fire, t0) {
  const it = intensity < 0 ? 0 : intensity > 1.5 ? 1.5 : intensity;
  begin(sink, P, x, y, z, S_SMOKE);
  P.vx = vx * 0.12 + (sink.rand() - 0.5) * 3;
  P.vy = vy * 0.12 + (sink.rand() - 0.5) * 3 + 1;
  P.vz = vz * 0.12 + (sink.rand() - 0.5) * 3;
  P.drag = 1.2; P.ay = 1.0;
  P.t0 = t0;
  P.life = 2.4 + 1.2 * sink.rand();
  P.s0 = 2 + 2 * it; P.s1 = (8 + 8 * it) * (0.8 + 0.4 * sink.rand());
  P.spin = (sink.rand() - 0.5) * 0.6;
  const a = fire ? SMOKE_SHADE * 0.9 : 0.16;
  P.r = a * 1.03; P.g = a; P.b = a * 0.95; P.i = 0.55 + 0.3 * it;
  P.p0 = fire ? 0.8 : 0;
  P.p2 = 1.8; P.p3 = 0.06;
  sink.smoke(P);
  if (fire) {
    begin(sink, P, x, y, z, K_FIRE);
    P.vx = vx * 0.55; P.vy = vy * 0.55 + 2; P.vz = vz * 0.55;
    P.drag = 2.2; P.ay = 3;
    P.t0 = t0;
    P.life = 0.22 + 0.18 * sink.rand();
    P.s0 = 1.6 + 1.2 * it; P.s1 = 3.5 + 3 * it;
    P.spin = (sink.rand() - 0.5) * 3;
    P.p0 = 1.0; P.p1 = 0.9; P.p2 = 1.6;
    sink.add(P);
  }
}

/**
 * Black smoke plume left in the air by a kill: puffs pre-scheduled along the
 * drifting (decelerating, slowly sinking) path over `dur` seconds, dense and
 * fire-lit at first, thinning out. Stateless like the debris trails: no
 * emitter slot and no per-frame CPU.
 */
export function recipeSmokePlume(sink, P, x, y, z, vx, vy, vz, s = 1, dur = 2, fire = true) {
  const n = countOf(sink, 12, 5);
  const k = 1.3, ay = -2.5, inh = 0.55;
  const ivx = vx * inh, ivy = vy * inh, ivz = vz * inh;
  const sz = smokeScale(s);
  const nf = fire ? Math.max(1, Math.round(n * 0.35)) : 0;
  for (let j = 0; j < n; j++) {
    const f = j / n;
    const tj = 0.05 + dur * Math.pow(f, 1.35);
    const it = 1 - f;
    motionAt(M, x, y, z, ivx, ivy, ivz, k, ay, tj);
    velocityAt(V, ivx, ivy, ivz, k, ay, tj);
    begin(sink, P, M.x + (sink.rand() - 0.5) * 2 * sz, M.y + (sink.rand() - 0.5) * 2 * sz, M.z + (sink.rand() - 0.5) * 2 * sz, S_SMOKE);
    P.vx = V.x * 0.15 + (sink.rand() - 0.5) * 4 * sz;
    P.vy = V.y * 0.15 + (sink.rand() - 0.5) * 3 * sz + 1.5;
    P.vz = V.z * 0.15 + (sink.rand() - 0.5) * 4 * sz;
    P.drag = 1.2; P.ay = 1.2;
    P.t0 = sink.time + tj;
    P.life = (2.4 + 1.6 * sink.rand()) * (0.8 + 0.4 * it);
    P.s0 = (2.5 + 2 * it) * sz;
    P.s1 = (9 + 9 * it) * sz * (0.8 + 0.4 * sink.rand());
    P.spin = (sink.rand() - 0.5) * 0.5;
    const a = SMOKE_SHADE * (0.8 + 0.4 * sink.rand());
    P.r = a * 1.03; P.g = a; P.b = a * 0.95;
    P.i = 0.5 + 0.4 * it;
    P.p0 = j < nf ? 0.9 * it : 0;
    P.p2 = 1.8; P.p3 = 0.08;
    sink.smoke(P);
    if (j < nf) {
      begin(sink, P, M.x, M.y, M.z, K_FIRE);
      P.vx = V.x * 0.5; P.vy = V.y * 0.5 + 2; P.vz = V.z * 0.5;
      P.drag = 2.2; P.ay = 3;
      P.t0 = sink.time + tj;
      P.life = 0.25 + 0.2 * sink.rand();
      P.s0 = (1.6 + 1.2 * it) * sz; P.s1 = (3.5 + 3 * it) * sz;
      P.spin = (sink.rand() - 0.5) * 3;
      P.p0 = 1.0; P.p1 = 0.9; P.p2 = 1.6;
      sink.add(P);
    }
  }
}

/** Motor glow at the head of a missile trail (lives ~2 frames, moves with the head). */
export function recipeHeadGlow(sink, P, x, y, z, vx, vy, vz, size = 1) {
  begin(sink, P, x, y, z, K_GLOW);
  P.vx = vx; P.vy = vy; P.vz = vz;
  P.life = 0.05;
  P.s0 = P.s1 = 2.4 * size;
  P.r = 1; P.g = 0.75; P.b = 0.45; P.i = 7; P.p0 = 0.5; P.p3 = 1; // p3: no fade-in
  sink.add(P);
}
