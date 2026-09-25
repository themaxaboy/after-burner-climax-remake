// Deterministic 2D value noise / fbm / ridged noise shared by the terrain
// worker (mesh building) and the main thread (collision queries).
export function makeNoise(seed = 1) {
  const perm = new Uint16Array(512);
  const vals = new Float32Array(256);
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  const p = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    p[i] = i;
    vals[i] = rnd() * 2 - 1;
  }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  function value(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const X = xi & 255, Y = yi & 255;
    const a = vals[perm[perm[X] + Y]];
    const b = vals[perm[perm[X + 1] + Y]];
    const c = vals[perm[perm[X] + Y + 1]];
    const d = vals[perm[perm[X + 1] + Y + 1]];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function fbm(x, y, oct = 5, lac = 2.02, gain = 0.5) {
    let sum = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) {
      sum += amp * value(x * f, y * f);
      f *= lac;
      amp *= gain;
    }
    return sum; // ~[-1, 1]
  }

  function ridged(x, y, oct = 5) {
    let sum = 0, amp = 0.5, f = 1, prev = 1;
    for (let o = 0; o < oct; o++) {
      let n = 1 - Math.abs(value(x * f, y * f));
      n *= n;
      sum += n * amp * prev;
      prev = n;
      f *= 2.03;
      amp *= 0.5;
    }
    return sum; // ~[0, 1]
  }

  return { value, fbm, ridged };
}
