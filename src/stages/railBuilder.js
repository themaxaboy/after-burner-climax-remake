import { Rng } from '../core/rng.js';

/**
 * Build a meandering rail from segment descriptors.
 * segs: [{ len, turn (deg over the segment), alt (target altitude at segment end), climb? }]
 * Returns points [[x,y,z]...] starting at `start` heading along `heading` (deg, 0 = -Z).
 */
export function buildRail({ start = [0, 60, 0], heading = 0, segs, step = 400, seed = 1, wobble = 0 }) {
  const rng = new Rng(seed);
  const pts = [start.slice()];
  let [x, y, z] = start;
  let hdg = (heading * Math.PI) / 180;
  for (const seg of segs) {
    const n = Math.max(1, Math.round(seg.len / step));
    const dh = ((seg.turn || 0) * Math.PI) / 180 / n;
    const y0 = y;
    const y1 = seg.alt != null ? seg.alt : y;
    for (let i = 1; i <= n; i++) {
      hdg += dh + (wobble ? rng.range(-wobble, wobble) * 0.002 : 0);
      const d = seg.len / n;
      x += Math.sin(hdg) * d;
      z -= Math.cos(hdg) * d;
      const t = i / n;
      const e = t * t * (3 - 2 * t);
      y = y0 + (y1 - y0) * e;
      pts.push([x, y, z]);
    }
  }
  return pts;
}

/** Total length estimate of polyline points. */
export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return L;
}
