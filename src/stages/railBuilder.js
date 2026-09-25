import { Rng } from '../core/rng.js';

/**
 * Build a meandering rail from segment descriptors.
 * segs: [{ len, turn (deg over the segment), alt (target altitude at segment end) }]
 * Returns points [[x,y,z]...] starting at `start` heading along `heading` (deg, 0 = -Z).
 * Turn rates are box-filtered across segment boundaries so curvature stays
 * continuous (no radius spikes where opposite turns meet).
 */
export function buildRail({ start = [0, 60, 0], heading = 0, segs, step = 400, seed = 1, wobble = 0, smooth = 5 }) {
  const rng = new Rng(seed);
  // 1) per-sub-step heading deltas, lengths and target altitudes
  const dh = [], dl = [], alts = [];
  let y = start[1];
  for (const seg of segs) {
    const n = Math.max(1, Math.round(seg.len / step));
    const y0 = y;
    const y1 = seg.alt != null ? seg.alt : y;
    for (let i = 1; i <= n; i++) {
      dh.push(((seg.turn || 0) * Math.PI) / 180 / n + (wobble ? rng.range(-wobble, wobble) * 0.002 : 0));
      dl.push(seg.len / n);
      const t = i / n;
      const e = t * t * (3 - 2 * t);
      alts.push(y0 + (y1 - y0) * e);
    }
    y = y1;
  }
  // 2) smooth the turn rate (curvature) with a box filter
  const k = Math.max(0, Math.floor(smooth));
  const sm = dh.map((_, i) => {
    let s = 0, c = 0;
    for (let j = i - k; j <= i + k; j++) {
      if (j < 0 || j >= dh.length) continue;
      s += dh[j] / dl[j];
      c++;
    }
    return (s / c) * dl[i];
  });
  // keep the total turn identical
  const tot = dh.reduce((a, b) => a + b, 0);
  const totS = sm.reduce((a, b) => a + b, 0);
  const corr = (tot - totS) / sm.length;
  // 3) integrate
  const pts = [start.slice()];
  let [x, , z] = start;
  let hdg = (heading * Math.PI) / 180;
  for (let i = 0; i < sm.length; i++) {
    hdg += sm[i] + corr;
    x += Math.sin(hdg) * dl[i];
    z -= Math.cos(hdg) * dl[i];
    pts.push([x, alts[i], z]);
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
