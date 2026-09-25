// Flicker detector (`?lumaprobe=N`). Right after the post chain has drawn a
// frame (same task, so the WebGL drawing buffer is still valid), the GL canvas
// is downsampled into a 64×36 2D canvas and the mean luma is recorded together
// with the state that usually explains a dip: G greyout, damage flash,
// missile warning, whiteout, Climax tint, dynamic-resolution scale, "resized
// this frame" and the lens-flare sun visibility. Results go to `window.__luma`
// (read by tests/e2e/flicker.mjs). Debug only: the readback stalls the GPU.
// If the canvas is resized after the frame was drawn but before the task ends,
// the browser presents a cleared (black) buffer: endFrame() records such a
// frame as luma 0 ("blank").

const W = 64, H = 36;

/**
 * Find short brightness dips (flicker) in a luma series.
 * A dip starts at frame i when luma falls below `drop` × the previous frame's
 * luma and ends at the first frame j ≤ i + `within` that recovers to at least
 * `recover` × that base value. Slow darkening (no recovery within `within`
 * frames) is not a dip: it is a legitimate scene change.
 * @param {Array<number|object>} series luma values, or objects with a `key` field
 * @param {{drop?: number, recover?: number, within?: number, key?: string, minBase?: number}} [opts]
 * @returns {{start: number, end: number, base: number, min: number, depth: number}[]}
 */
export function findDips(series, { drop = 0.9, recover = 0.95, within = 4, key = 'l', minBase = 0.02 } = {}) {
  const v = (i) => {
    const x = series[i];
    const n = typeof x === 'number' ? x : x?.[key];
    return Number.isFinite(n) ? n : NaN;
  };
  const dips = [];
  const n = series.length;
  for (let i = 1; i < n; i++) {
    const base = v(i - 1);
    const cur = v(i);
    if (!(base >= minBase) || !Number.isFinite(cur)) continue;
    if (cur >= base * drop) continue;
    let min = cur;
    let end = -1;
    for (let j = i + 1; j <= Math.min(n - 1, i + within); j++) {
      const x = v(j);
      if (Number.isFinite(x) && x >= base * recover) {
        end = j;
        break;
      }
      if (x < min) min = x;
    }
    if (end < 0) continue; // sustained change, not a flicker
    dips.push({ start: i, end, base, min, depth: 1 - min / base });
    i = end; // resume after the recovery frame
  }
  return dips;
}

/** Mean Rec. 709 luma (0..1, of the sRGB-encoded values) of RGBA8 pixels. */
export function meanLuma(data) {
  let s = 0;
  const n = data.length >> 2;
  for (let i = 0; i < data.length; i += 4) s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  return n ? s / (n * 255) : 0;
}

export class LumaProbe {
  /**
   * @param {import('../game.js').Game} game
   * @param {number} frames number of in-stage frames to record
   */
  constructor(game, frames) {
    this.game = game;
    this.frames = frames;
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    // small thumbnails of every frame (PNG data URLs) so a dip can be inspected
    this.thumb = document.createElement('canvas');
    this.thumb.width = 160;
    this.thumb.height = 90;
    this.out = { frames, series: [], thumbs: [], done: false, t0: null };
    window.__luma = this.out;
  }

  /** Call right after the post chain rendered to the canvas. */
  sample() {
    const out = this.out;
    if (out.done) return;
    const g = this.game;
    const st = g.state;
    if (!st || st.kind !== 'stage' || st.loading) return;
    const ctx = this.ctx;
    ctx.drawImage(g.renderer.domElement, 0, 0, W, H);
    const l = meanLuma(ctx.getImageData(0, 0, W, H).data);
    const gf = g.post.gforce.uniforms;
    const u = (k) => {
      const x = gf.get(k)?.value;
      return typeof x === 'number' ? +x.toFixed(3) : 0;
    };
    const p = st.player;
    this.thumb.getContext('2d').drawImage(g.renderer.domElement, 0, 0, 160, 90);
    out.thumbs.push(this.thumb.toDataURL('image/png'));
    out.series.push({
      i: out.series.length,
      l: +l.toFixed(4),
      grey: u('uGrey'),
      dmg: u('uDamage'),
      warn: u('uWarn'),
      white: u('uWhite'),
      climax: u('uClimax'),
      scale: +g.dynres.scale.toFixed(3),
      resized: g._resizedFrame === g.frameCount ? 1 : 0,
      flare: +(g.post.flare.visibility?.(g.renderer) ?? g.post.flare.uniforms.get('uSun').value.z).toFixed(3),
      g: p ? +p.gLoad.toFixed(2) : 0,
      x: p ? +p.x.toFixed(1) : 0,
      y: p ? +p.y.toFixed(1) : 0,
      s: p ? Math.round(p.s) : 0,
      t: +(st.time || 0).toFixed(2),
      w: g.renderer.domElement.width,
      h: g.renderer.domElement.height,
      blank: 0
    });
    if (out.t0 == null) out.t0 = performance.now();
    this._sampledFrame = g.frameCount;
  }

  /** Call at the very end of the frame task (after dynres / resize handling). */
  endFrame() {
    const out = this.out;
    const g = this.game;
    if (out.done || !out.series.length || this._sampledFrame !== g.frameCount) return;
    const last = out.series[out.series.length - 1];
    const c = g.renderer.domElement;
    if (g._resizedFrame === g.frameCount) last.resized = 1;
    if (!last.blank && (c.width !== last.w || c.height !== last.h)) {
      // resized after drawing: this frame is presented cleared
      last.blank = 1;
      last.l = 0;
    }
    if (out.series.length >= this.frames) {
      out.done = true;
      out.ms = performance.now() - out.t0;
      out.dips = findDips(out.series);
    }
  }
}
