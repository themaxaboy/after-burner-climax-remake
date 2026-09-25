import { makeNoise } from './noise.js';

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Rail-space canyon height field: h(s, l) where s = distance along the stage
 * rail and l = horizontal lateral offset. Pure & deterministic so the worker
 * (meshing) and the main thread (collision, prop placement) agree exactly.
 *
 * def: { seed, sections: [{ s, depth, width, clearance }] }
 *   depth     wall height above the floor (0 = open desert with mesas)
 *   width     canyon half-width at the floor
 *   clearance rail height above the canyon floor (or `floor`: absolute floor altitude)
 */
export function makeCanyonShape(def) {
  const noise = makeNoise(def.seed || 1);
  const keys = def.sections.slice().sort((a, b) => a.s - b.s);
  const out = { depth: 0, width: 0, clearance: 0, floor: null };

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

  /** Effective (noisy) wall start distance from the centreline. */
  function wallStart(s, side, w) {
    return w + noise.fbm(s * 0.0035, side > 0 ? 3.1 : 7.7, 3) * w * 0.32 + noise.fbm(s * 0.02, side > 0 ? 1.3 : 5.2, 2) * 5;
  }

  /**
   * @param {number} s rail distance
   * @param {number} l lateral offset (m)
   * @param {number} railY rail altitude at s
   */
  function heightAt(s, l, railY) {
    const sec = sectionAt(s);
    const D = sec.depth, w = sec.width;
    const floor = sec.floor != null ? sec.floor : railY - sec.clearance;
    const a = Math.abs(l);
    let h = floor;
    if (D > 1) {
      const ws = wallStart(s, l, w);
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
      if (mask > 0) {
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

  /** Safe lateral half-width for the player at s (smaller than the walls). */
  function flyableHalfWidth(s) {
    const sec = sectionAt(s);
    if (sec.depth < 20) return Infinity;
    const wl = wallStart(s, -1, sec.width), wr = wallStart(s, 1, sec.width);
    return Math.min(wl, wr);
  }

  return { heightAt, sectionAt: (s) => ({ ...sectionAt(s) }), flyableHalfWidth, wallStart, noise };
}
