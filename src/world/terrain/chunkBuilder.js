/**
 * Build one terrain chunk (rows along the rail × lateral columns).
 * Heights are evaluated on a grid padded by one row/column on every side so
 * normals and cavity terms are continuous across chunk borders.
 *
 * msg: { rows, cols, lat: Float32Array(cols), s: Float32Array(rows + 2),
 *        frames: Float32Array((rows + 2) * 5) [px, py, pz, rx, rz], origin: [x, z] }
 * returns { pos, nor, cav } (positions relative to origin)
 */
export function buildChunk(shape, msg) {
  const { rows, cols, lat, s, frames, origin } = msg;
  const R = rows + 2, C = cols + 2;
  const gx = new Float32Array(R * C), gy = new Float32Array(R * C), gz = new Float32Array(R * C);
  const latP = new Float32Array(C);
  latP[0] = lat[0] - (lat[1] - lat[0]);
  latP[C - 1] = lat[cols - 1] + (lat[cols - 1] - lat[cols - 2]);
  for (let c = 0; c < cols; c++) latP[c + 1] = lat[c];
  for (let r = 0; r < R; r++) {
    const f = r * 5;
    const px = frames[f], py = frames[f + 1], pz = frames[f + 2], rx = frames[f + 3], rz = frames[f + 4];
    const sr = s[r];
    for (let c = 0; c < C; c++) {
      const l = latP[c];
      const i = r * C + c;
      gx[i] = px + rx * l - origin[0];
      gz[i] = pz + rz * l - origin[1];
      gy[i] = shape.heightAt(sr, l, py);
    }
  }
  const n = rows * cols;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const cav = new Float32Array(n);
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
    }
  }
  return { pos, nor, cav };
}
