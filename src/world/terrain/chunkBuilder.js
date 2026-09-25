/**
 * Build one terrain chunk (rows along the rail × lateral columns).
 * Heights are evaluated on a grid padded by one row/column on every side so
 * normals and cavity terms are continuous across chunk borders.
 *
 * The corridor centre c(s) is baked into every row: column l is placed at
 * lateral offset lt = l + c(s)·w(l), where w = 1 over the dense inner columns
 * (|l| ≤ inner) and fades to 0 at the outermost column. The dense columns
 * follow the swinging corridor while the ribbon's outer edge stays where it
 * was (no extra fold risk on tight rail turns).
 *
 * msg: { rows, cols, lat: Float32Array(cols), s: Float32Array(rows + 2),
 *        frames: Float32Array((rows + 2) * 5) [px, py, pz, rx, rz], origin: [x, z],
 *        inner?: number, trees?: { density, max, snowLine, seed } }
 * returns { pos, nor, cav, rel, trees? } (positions relative to origin; rel = height above the section floor;
 *          trees = Float32Array(n * 4) [x, y, z, scale] relative to origin, `treeCount`)
 */
export function buildChunk(shape, msg) {
  const { rows, cols, lat, s, frames, origin } = msg;
  const R = rows + 2, C = cols + 2;
  const gx = new Float32Array(R * C), gy = new Float32Array(R * C), gz = new Float32Array(R * C);
  const latP = new Float32Array(C);
  latP[0] = lat[0] - (lat[1] - lat[0]);
  latP[C - 1] = lat[cols - 1] + (lat[cols - 1] - lat[cols - 2]);
  for (let c = 0; c < cols; c++) latP[c + 1] = lat[c];
  const wts = corridorWeights(latP, msg.inner);
  const floors = new Float32Array(R);
  const cen = new Float32Array(R);
  const hasCentre = !!(shape.centre && shape.centre.active);
  for (let r = 0; r < R; r++) {
    const f = r * 5;
    const px = frames[f], py = frames[f + 1], pz = frames[f + 2], rx = frames[f + 3], rz = frames[f + 4];
    const sr = s[r];
    const cr = hasCentre ? shape.centreAt(sr) : 0;
    cen[r] = cr;
    floors[r] = shape.floorLevel ? shape.floorLevel(sr, py) : py - 45;
    for (let c = 0; c < C; c++) {
      const lt = latP[c] + cr * wts[c];
      const i = r * C + c;
      gx[i] = px + rx * lt - origin[0];
      gz[i] = pz + rz * lt - origin[1];
      gy[i] = shape.heightAtLocal ? shape.heightAtLocal(sr, lt - cr, py) : shape.heightAt(sr, lt, py);
    }
  }
  const n = rows * cols;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const cav = new Float32Array(n);
  const rel = new Float32Array(n);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gi = (r + 1) * C + (c + 1);
      const o = (r * cols + c) * 3;
      pos[o] = gx[gi];
      pos[o + 1] = gy[gi];
      pos[o + 2] = gz[gi];
      // tangents: along l (right) and along s (forward)
      const li = gi - 1, ri = gi + 1, bi = gi - C, fi = gi + C;
      const ax = gx[ri] - gx[li], ay = gy[ri] - gy[li], az = gz[ri] - gz[li];
      const bx = gx[fi] - gx[bi], by = gy[fi] - gy[bi], bz = gz[fi] - gz[bi];
      // n = a × b (right × forward = up)
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      nor[o] = nx / len;
      nor[o + 1] = ny / len;
      nor[o + 2] = nz / len;
      // cavity: how much lower than the neighbour average (crevices darker)
      const avg = (gy[li] + gy[ri] + gy[bi] + gy[fi]) * 0.25;
      cav[r * cols + c] = Math.max(-1, Math.min(1, (avg - gy[gi]) * 0.25));
      rel[r * cols + c] = gy[gi] - floors[r + 1];
    }
  }
  const res = { pos, nor, cav, rel };
  if (msg.trees) Object.assign(res, placeTrees(msg, { pos, nor, rel, latP, wts, cen, s, frames, origin, shape }));
  return res;
}

/** Per-column weight of the corridor offset: 1 on the dense core, fading to 0 at the ribbon edge. */
export function corridorWeights(latP, inner) {
  const C = latP.length;
  const w = new Float32Array(C);
  const half = Math.max(Math.abs(latP[0]), Math.abs(latP[C - 1]));
  const core = inner != null ? inner + 40 : half;
  for (let c = 0; c < C; c++) {
    const a = Math.abs(latP[c]);
    w[c] = a <= core ? 1 : Math.max(0, (half - a) / Math.max(1, half - core));
  }
  return w;
}

const hash = (a, b, seed) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/**
 * Instanced pines on the valley slopes: picked from the chunk's dense grid
 * (slope, height band above the river and below the snow line, clumped by a
 * forest noise), jittered inside the cell.
 */
function placeTrees(msg, g) {
  const { rows, cols } = msg;
  const { pos, nor, rel, latP, shape } = g;
  const cfg = msg.trees;
  const max = cfg.max || 200;
  const out = new Float32Array(max * 4);
  const snow = cfg.snowLine ?? 260;
  const water = shape.waterLevel;
  const seed = cfg.seed || 1;
  const noise = shape.noise;
  const inner = msg.inner ?? Infinity;
  let n = 0;
  for (let r = 0; r < rows - 1 && n < max; r++) {
    const sr = g.s[r + 1];
    for (let c = 0; c < cols - 1 && n < max; c++) {
      if (Math.abs(latP[c + 1]) > inner) continue;
      const i = r * cols + c;
      const ny = nor[i * 3 + 1];
      if (ny < 0.62 || ny > 0.985) continue; // slopes, not flats or cliffs
      const hr = rel[i];
      if (hr < 6 || hr > snow - 35) continue;
      const y = pos[i * 3 + 1];
      if (water != null && y < water + 2.5) continue;
      const lat = latP[c + 1];
      const forest = noise.fbm(sr * 0.006 + 31.7, lat * 0.006, 2) + 0.28 - (hr / snow) * 0.5;
      const h0 = hash(Math.round(sr * 0.5), c, seed);
      if (h0 > cfg.density * 0.55 * Math.max(0, forest * 2.2)) continue;
      // jitter inside the cell (bilinear between the 4 grid corners)
      const u = hash(c, Math.round(sr), seed + 7), v = hash(Math.round(sr), c + 3, seed + 13);
      const a = i * 3, b = (i + 1) * 3, d = (i + cols) * 3, e = (i + cols + 1) * 3;
      const x = (pos[a] * (1 - u) + pos[b] * u) * (1 - v) + (pos[d] * (1 - u) + pos[e] * u) * v;
      const yy = (pos[a + 1] * (1 - u) + pos[b + 1] * u) * (1 - v) + (pos[d + 1] * (1 - u) + pos[e + 1] * u) * v;
      const z = (pos[a + 2] * (1 - u) + pos[b + 2] * u) * (1 - v) + (pos[d + 2] * (1 - u) + pos[e + 2] * u) * v;
      const o = n * 4;
      out[o] = x;
      out[o + 1] = yy - 1.2;
      out[o + 2] = z;
      out[o + 3] = 0.75 + hash(c + 11, Math.round(sr * 3), seed) * 0.6;
      n++;
    }
  }
  return { trees: out, treeCount: n };
}
