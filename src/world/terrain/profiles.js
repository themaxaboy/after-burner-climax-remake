import { makeNoise } from './noise.js';

// Rail-space terrain height fields for the terrain stages (see
// docs/overhaul/CONTRACTS.md §6). Pure & deterministic: the worker (meshing)
// and the main thread (collision, obstacle placement, autopilot) evaluate the
// exact same functions.
//
//   s  distance along the stage rail (m)
//   l  horizontal lateral offset from the rail (m, + = right)
//   l' = l − centre(s): offset from the corridor centre; every profile is
//        evaluated in l' so the whole corridor (floor, walls, dunes) swings
//        with `centre` and the player has to steer to stay in it.

/** Max corridor swing rate: |dc/ds|·v ≤ 0.6·lateralSpeed (v ≈ 240 m/s, lateralSpeed ≈ 150). */
export const CENTRE_MAX_SLOPE = 0.375;
/** Max corridor offset from the rail (player box is ±200 m on terrain stages). */
export const CENTRE_MAX_OFFSET = 150;

const TAU = Math.PI * 2;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Corridor centre c(s) in rail-space metres.
 *   { keys: [[s, off], …] }                          monotone cubic (Fritsch–Carlson), flat outside the keys
 *   { amp, wavelength, from, to, phase }             sine swing, smoothly ramped in after `from` and out before `to`
 * The curve is measured once and scaled down (never up) so that
 * |dc/ds| ≤ maxSlope and |c| ≤ maxOffset everywhere.
 */
export function makeCentre(def, { maxSlope = CENTRE_MAX_SLOPE, maxOffset = CENTRE_MAX_OFFSET } = {}) {
  if (!def || (!def.keys && !def.amp)) return { at: () => 0, scale: 1, rawMaxSlope: 0, lo: 0, hi: 0, active: false };
  let raw, lo, hi;
  if (def.keys && def.keys.length) {
    const ks = def.keys.slice().sort((a, b) => a[0] - b[0]);
    const n = ks.length;
    const xs = new Float64Array(n), ys = new Float64Array(n), ms = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = ks[i][0];
      ys[i] = ks[i][1];
    }
    // Fritsch–Carlson monotone tangents (no overshoot between keys)
    const d = new Float64Array(Math.max(1, n - 1));
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
    if (n > 1) {
      ms[0] = 0; // ease in/out at the ends: the corridor starts and ends parallel to the rail
      ms[n - 1] = 0;
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) ms[i] = 0;
        else {
          const w1 = 2 * (xs[i + 1] - xs[i]) + (xs[i] - xs[i - 1]);
          const w2 = (xs[i + 1] - xs[i]) + 2 * (xs[i] - xs[i - 1]);
          ms[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
        }
      }
    }
    lo = xs[0];
    hi = xs[n - 1];
    raw = (s) => {
      if (n === 1 || s <= xs[0]) return ys[0];
      if (s >= xs[n - 1]) return ys[n - 1];
      let a = 0, b = n - 1;
      while (b - a > 1) {
        const m = (a + b) >> 1;
        if (xs[m] <= s) a = m;
        else b = m;
      }
      const h = xs[b] - xs[a];
      const t = (s - xs[a]) / h;
      const t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[a] + (t3 - 2 * t2 + t) * h * ms[a] + (-2 * t3 + 3 * t2) * ys[b] + (t3 - t2) * h * ms[b];
    };
  } else {
    const amp = def.amp || 0;
    const wl = Math.max(200, def.wavelength || 2000);
    const from = def.from ?? 0;
    const to = def.to ?? Infinity;
    const ph = def.phase || 0;
    const ramp = Math.min(wl * 0.5, Number.isFinite(to) ? (to - from) * 0.5 : wl * 0.5);
    lo = from;
    hi = Number.isFinite(to) ? to : from + wl * 4;
    raw = (s) => {
      if (s <= from || s >= to) return 0;
      const r = smooth(from, from + ramp, s) * (Number.isFinite(to) ? 1 - smooth(to - ramp, to, s) : 1);
      return amp * Math.sin(((s - from) / wl) * TAU + ph) * r;
    };
  }
  // measure → uniform scale so the swing is always flyable
  let mS = 0, mO = 0;
  for (let s = lo; s <= hi; s += 4) {
    mS = Math.max(mS, Math.abs(raw(s + 2) - raw(s - 2)) / 4);
    mO = Math.max(mO, Math.abs(raw(s)));
  }
  const scale = Math.min(1, mS > 0 ? maxSlope / mS : 1, mO > 0 ? maxOffset / mO : 1);
  return { at: scale === 1 ? raw : (s) => raw(s) * scale, scale, rawMaxSlope: mS, lo, hi, active: true };
}

/**
 * Terrain shape for a stage (`def.terrain`, CONTRACTS §6).
 *
 * profile 'canyon'  sections {floor|clearance, depth = wall height, width = floor half-width}
 *                   depth ≈ 0 → open desert with mesas away from the path (legacy canyon run).
 * profile 'valley'  river/valley floor (floor may be below the water level 0 → fjord), U-shaped walls
 *                   rising to `depth` (peak height above the floor) with ridged peaks beyond.
 * profile 'dunes'   rolling transverse dunes of amplitude `depth`; a soft corridor of half-width `width`
 *                   keeps them low along the flight path, big dunes flank it.
 *
 * Returned API (all heights are world y):
 *   heightAt(s, l, railY)     full terrain height
 *   floorAt(s, l, railY)      ground ignoring walls / mesas / big dunes (movement floor, never above heightAt)
 *   centreAt(s)               corridor centre offset (m)
 *   flyableHalfWidth(s)       half-width of the free corridor around centreAt(s) (Infinity = open)
 *   floorLevel(s, railY)      base floor altitude of the section at s
 *   sectionAt(s), wallStart(s, side, w), heightAtLocal(s, l', railY), noise, profile, snowLine, waterLevel
 */
export function makeTerrainShape(def) {
  const profile = def.profile || 'canyon';
  const noise = makeNoise(def.seed || 1);
  const keys = (def.sections && def.sections.length ? def.sections : [{ s: 0, depth: 0, width: 300 }]).slice().sort((a, b) => a.s - b.s);
  const centre = makeCentre(def.centre, { maxSlope: def.centreMaxSlope ?? CENTRE_MAX_SLOPE, maxOffset: def.centreMaxOffset ?? CENTRE_MAX_OFFSET });
  const centreAt = centre.at;
  const out = { depth: 0, width: 0, clearance: 0, floor: null };
  const riverDepth = def.river?.depth ?? 7;
  const riverWidth = def.river?.width ?? 0.32;

  function sectionAt(s) {
    if (s <= keys[0].s) return set(keys[0], keys[0], 0);
    for (let i = 1; i < keys.length; i++) {
      if (s <= keys[i].s) {
        const a = keys[i - 1], b = keys[i];
        return set(a, b, smooth(a.s, b.s, s));
      }
    }
    const last = keys[keys.length - 1];
    return set(last, last, 0);
  }
  function set(a, b, t) {
    out.depth = a.depth + (b.depth - a.depth) * t;
    out.width = a.width + (b.width - a.width) * t;
    const ca = a.clearance ?? def.clearance ?? 45, cb = b.clearance ?? def.clearance ?? 45;
    out.clearance = ca + (cb - ca) * t;
    out.floor = a.floor != null && b.floor != null ? a.floor + (b.floor - a.floor) * t : null;
    return out;
  }
  const floorOf = (sec, railY) => (sec.floor != null ? sec.floor : railY - sec.clearance);

  // ------------------------------------------------------------ canyon
  function canyonWallStart(s, side, w) {
    return w + noise.fbm(s * 0.0035, side > 0 ? 3.1 : 7.7, 3) * w * 0.32 + noise.fbm(s * 0.02, side > 0 ? 1.3 : 5.2, 2) * 5;
  }

  function canyonLocal(s, l, railY, groundOnly) {
    const sec = sectionAt(s);
    const D = sec.depth, w = sec.width;
    const floor = floorOf(sec, railY);
    const a = Math.abs(l);
    let h = floor;
    if (D > 1 && !groundOnly) {
      const ws = canyonWallStart(s, l, w);
      const span = D * 0.42 + 14;
      const t = (a - ws) / span;
      if (t > 0) {
        const u = Math.min(t, 1);
        const bands = 4;
        const st = Math.floor(u * bands);
        const fr = u * bands - st;
        const stepped = (st + smooth(0.4, 1.0, fr)) / bands; // cliffs + ledges
        let prof = u * 0.28 + stepped * 0.72;
        // erosion gullies cutting into the walls
        prof *= 1 - 0.12 * Math.max(0, noise.ridged(s * 0.012, (h + u * D) * 0.02 + (l > 0 ? 0 : 50), 2) - 0.4);
        h += D * prof;
        if (t > 1) {
          // plateau beyond the rim + distant buttes
          const far = smooth(1, 4, t);
          h += noise.fbm(s * 0.0016, l * 0.0016, 4) * D * 0.18 + noise.ridged(s * 0.0006 + 5, l * 0.0006, 4) * D * 0.55 * far;
        }
      }
    }
    // open desert: flat-topped mesas and buttes away from the flight path
    const open = 1 - smooth(10, 90, D);
    if (open > 0.001) {
      const mask = smooth(120, 360, a) * open;
      if (mask > 0 && !groundOnly) {
        const m = noise.fbm(s * 0.0011 + 11.3, l * 0.0011 - 4.7, 4);
        const top = 110 + 90 * noise.value(s * 0.0004, l * 0.0004);
        const mesa = smooth(0.12, 0.2, m);
        // terraced sides
        const terr = Math.floor(mesa * 3) / 3 + smooth(0.6, 1, (mesa * 3) % 1) / 3;
        h += (mesa * 0.35 + terr * 0.65) * top * mask;
      }
      // gentle dunes / undulation
      h += noise.fbm(s * 0.0025, l * 0.0025, 3) * 14 * open;
    }
    // ground detail
    h += noise.fbm(s * 0.016, l * 0.016, 3) * 2.6 + noise.fbm(s * 0.07, l * 0.07, 2) * 0.7;
    return h;
  }

  // ------------------------------------------------------------ valley / fjord
  function valleyWallStart(s, side, w) {
    return w * (1 + noise.fbm(s * 0.0021, side > 0 ? 3.1 : 7.7, 3) * 0.34) + noise.fbm(s * 0.011, side > 0 ? 1.3 : 5.2, 2) * 9;
  }

  function valleyLocal(s, l, railY, groundOnly) {
    const sec = sectionAt(s);
    const D = sec.depth, w = sec.width;
    const floor = floorOf(sec, railY);
    const a = Math.abs(l);
    // meandering river inside the floor, meadows / gravel banks either side
    const rc = noise.fbm(s * 0.0016, 9.1, 2) * w * 0.3;
    const rw = Math.max(16, w * riverWidth);
    const bank = smooth(rw * 0.55, rw * 1.7, Math.abs(l - rc));
    let h = floor - riverDepth * (1 - bank) + bank * (2.4 + noise.fbm(s * 0.006, l * 0.006, 2) * 2.2);
    if (D > 1 && !groundOnly) {
      const side = l >= 0 ? 1 : -1;
      const ws = valleyWallStart(s, side, w);
      const span = D * 0.72 + 60;
      const t0 = (a - ws) / span;
      if (t0 > 0) {
        // irregular slopes (the foot stays at the wall start)
        const t = t0 * (1 + noise.fbm(s * 0.0035 + (side > 0 ? 0 : 13), a * 0.0035, 3) * 0.35);
        const u = Math.min(Math.max(t, 0), 1);
        // trough: ~45° foot steepening to ~57° mid-slope, rounded shoulder, soft rock bands (cliffs + ledges)
        let prof = (1 - (1 - u) * (1 - u)) * 0.45 + u * u * (3 - 2 * u) * 0.55;
        const st = Math.floor(u * 5), fr = u * 5 - st;
        const stepped = (st + smooth(0.25, 0.9, fr)) / 5;
        prof = prof * 0.72 + (1 - (1 - stepped) * (1 - stepped)) * 0.28;
        // spurs and gullies running down the slopes, rock ribs
        const g = noise.ridged(s * 0.0042 + (side > 0 ? 0 : 40), u * 0.7 + (side > 0 ? 0 : 9), 3);
        prof *= 0.8 + 0.34 * g;
        const rib = noise.ridged(s * 0.011 + (side > 0 ? 3 : 71), a * 0.011, 3);
        h += D * prof + (noise.fbm(s * 0.004, a * 0.004 + side * 30, 3) * 0.1 + (rib - 0.35) * 0.1) * D * u;
        // crags
        h += (noise.ridged(s * 0.028 + side * 5, a * 0.028, 2) - 0.3) * 10 * Math.min(1, u * 4);
        if (t > 1) {
          // jagged peaks behind the shoulders
          const far = smooth(1, 2.6, t);
          h += noise.ridged(s * 0.0011 + 5, a * 0.0011 + (side > 0 ? 0 : 17), 4) * D * 0.8 * far + noise.fbm(s * 0.0021, a * 0.0021, 3) * D * 0.14 * far;
        }
      }
    }
    // rock / soil detail
    h += noise.fbm(s * 0.018, l * 0.018, 2) * 1.6;
    return h;
  }

  // ------------------------------------------------------------ dunes
  function dunesLocal(s, l, railY, groundOnly) {
    const sec = sectionAt(s);
    const A = Math.max(0, sec.depth), w = sec.width;
    const floor = floorOf(sec, railY);
    const a = Math.abs(l);
    const outside = groundOnly ? 0 : smooth(w * 0.5, w * 1.2 + 30, a);
    // transverse dunes: gentle windward slope, sharp crest, steep slip face; warped crest lines
    const ph = s * 0.0024 + l * 0.0007 + noise.fbm(s * 0.0012, l * 0.0012, 3) * 1.3;
    const f = ph - Math.floor(ph);
    let crest;
    if (f < 0.78) {
      const u = f / 0.78;
      crest = u * 0.7 + u * u * (3 - 2 * u) * 0.3;
    } else {
      const v = (f - 0.78) / 0.22;
      crest = (1 - v) * (1 - v);
    }
    const amp = A * (0.6 + 0.4 * noise.fbm(s * 0.0009 + 3.3, l * 0.0009, 2)) * (0.42 + 0.58 * outside);
    let h = floor + crest * amp;
    if (outside > 0) {
      // star/draa dunes flanking the corridor
      const big = noise.ridged(s * 0.00065 + 1.7, l * 0.0011, 3);
      h += outside * A * (0.5 + 1.5 * big * big);
    }
    h += noise.fbm(s * 0.01, l * 0.01, 2) * 1.4;
    return h;
  }

  const local = profile === 'valley' ? valleyLocal : profile === 'dunes' ? dunesLocal : canyonLocal;
  const wallStart = profile === 'valley' ? valleyWallStart : canyonWallStart;

  /** Height with l' already relative to the corridor centre. */
  function heightAtLocal(s, lp, railY) {
    return local(s, lp, railY, false);
  }

  /**
   * @param {number} s rail distance
   * @param {number} l lateral offset from the rail (m)
   * @param {number} railY rail altitude at s
   */
  function heightAt(s, l, railY) {
    return local(s, l - centreAt(s), railY, false);
  }

  function floorAt(s, l, railY) {
    const lp = l - centreAt(s);
    return Math.min(local(s, lp, railY, false), local(s, lp, railY, true) + 1.5);
  }

  /** Safe lateral half-width around the corridor centre (smaller than the walls). */
  function flyableHalfWidth(s) {
    const sec = sectionAt(s);
    if (profile === 'dunes') return sec.width;
    if (sec.depth < 20) return Infinity;
    return Math.min(wallStart(s, -1, sec.width), wallStart(s, 1, sec.width));
  }

  return {
    profile,
    heightAt,
    heightAtLocal,
    floorAt,
    centreAt,
    centre,
    flyableHalfWidth,
    floorLevel: (s, railY) => floorOf(sectionAt(s), railY),
    sectionAt: (s) => ({ ...sectionAt(s) }),
    wallStart,
    noise,
    snowLine: def.snowLine ?? 260,
    waterLevel: def.water ? (def.water.level ?? 0) : null
  };
}
