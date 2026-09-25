// Pure HUD layout math (no DOM): the layout unit and the anchor points of
// every HUD block in device pixels. Unit-tested in tests/unit/hud.test.js.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Layout unit: device pixels per reference pixel of a 1280×720 screen. Short
 * (phone) screens get a boost so the text stays readable.
 * @param {number} W canvas width (device px)
 * @param {number} H canvas height (device px)
 * @param {number} k device pixels per CSS pixel
 */
export function hudUnit(W, H, k = 1) {
  const base = Math.min(W / 1280, H / 720);
  const cssH = H / Math.max(k, 0.01);
  const boost = cssH < 620 ? 1 + 0.3 * clamp((620 - cssH) / 280, 0, 1) : 1;
  return base * boost;
}

/**
 * Anchors (device px) for each HUD block.
 * touch: keeps gauges clear of the on-screen buttons (see ui.css .touch-*):
 * pause button top-right, throttle slider on the right edge, fire buttons
 * bottom-right.
 */
export function hudLayout(W, H, k = 1, touch = false) {
  const u = hudUnit(W, H, k);
  const pad = 18 * u;
  // right edge keep-out for the touch pause button / throttle column (CSS px → device)
  const rightKeep = touch ? Math.max(pad, 66 * k) : pad;
  const L = {
    W,
    H,
    k,
    u,
    touch,
    pad,
    // top-left: badge + SCORE + combo
    score: { x: pad, y: 10 * u },
    // top-right: STAGE + rank stars (right edge)
    stage: { x: W - rightKeep, y: 10 * u },
    // bottom-left: missile row, CLIMAX + SPEED bars (left, bottom edge)
    gauges: { x: 26 * u, y: H - 20 * u },
    // armor C gauge centre and radius
    armor: touch
      ? { x: W - rightKeep - 56 * u, y: 196 * u, r: 46 * u, compact: true }
      : { x: W - 96 * u, y: H - 92 * u, r: 60 * u, compact: false },
    // bottom-centre EO sign
    eo: { x: W / 2, y: H - 34 * u },
    // top-centre radio panel
    radio: { x: W / 2, y: 62 * u, maxW: Math.max(260 * u, Math.min(620 * u, W - 2 * (rightKeep + 250 * u))) },
    // stage timer under the radio panel
    timer: { x: W / 2, y: 118 * u },
    // centre warnings column (below the headline messages at 0.24 H)
    warn: { x: W / 2, y: Math.max(H * 0.33, 196 * u) },
    // callout banners
    callout: { x: W / 2, y: H * 0.36 },
    // route select arrows
    // (touch: pulled inward, clear of the armor gauge and the flare button)
    route: touch ? { lx: W * 0.26, rx: W * 0.71, y: H * 0.42 } : { lx: W * 0.17, rx: W * 0.83, y: H * 0.44 }
  };
  return L;
}

/** Target marker box side (device px) from world radius and distance. */
export function targetBoxSize(radius, dist, H, u) {
  // ≈ projected diameter (fov ~60°) plus a 25 % margin
  const proj = (radius / Math.max(dist, 1)) * H * 2.16;
  return clamp(proj, 16 * u, 60 * u);
}

/** Combo colour tier: 0 blue (<20), 1 yellow (<50), 2 red. */
export function comboTier(n) {
  return n < 20 ? 0 : n < 50 ? 1 : 2;
}

/** Armor colour: green → yellow → red by fraction 0..1. Returns [r, g, b]. */
export function armorColor(v, out = [0, 0, 0]) {
  v = clamp(v, 0, 1);
  if (v > 0.5) {
    const t = (v - 0.5) / 0.5;
    out[0] = Math.round(255 * (1 - t) + 90 * t);
    out[1] = Math.round(226 * (1 - t) + 255 * t);
    out[2] = Math.round(40 * (1 - t) + 90 * t);
  } else {
    const t = v / 0.5;
    out[0] = 255;
    out[1] = Math.round(40 * (1 - t) + 226 * t);
    out[2] = Math.round(40 * (1 - t) + 40 * t);
  }
  return out;
}

/** Screen-edge point (device px) for a direction from the centre, inset by m. */
export function edgePoint(dx, dy, W, H, m, out = { x: 0, y: 0, a: 0 }) {
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const hx = W / 2 - m, hy = H / 2 - m;
  const sx = Math.abs(dx) > 1e-6 ? hx / Math.abs(dx) : Infinity;
  const sy = Math.abs(dy) > 1e-6 ? hy / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  out.x = W / 2 + dx * s;
  out.y = H / 2 + dy * s;
  out.a = Math.atan2(dy, dx);
  return out;
}
