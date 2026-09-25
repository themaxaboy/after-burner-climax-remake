// Quality presets + GPU auto-detection + dynamic resolution scaling.
export const PRESETS = {
  low: {
    name: 'low', label: 'LOW',
    maxDpr: 1.0, scaleMin: 0.5, scaleMax: 0.8,
    aa: 'fxaa', msaa: 0,
    shadows: 0, shadowSize: 0, shadowFar: 0,
    ao: false, motionBlur: false, godRays: false, lensFlare: true, bloomHalfRes: true,
    particles: 4096, clouds: 90, oceanRings: 5, oceanRes: 64,
    terrainRes: 48, anisotropy: 2, heatHaze: false, textures: '1k', cloudDeckSteps: 0
  },
  medium: {
    name: 'medium', label: 'MEDIUM',
    maxDpr: 1.5, scaleMin: 0.6, scaleMax: 0.9,
    aa: 'smaa', msaa: 0,
    shadows: 2, shadowSize: 1024, shadowFar: 700,
    ao: false, motionBlur: false, godRays: false, lensFlare: true, bloomHalfRes: true,
    particles: 8192, clouds: 180, oceanRings: 6, oceanRes: 96,
    terrainRes: 64, anisotropy: 4, heatHaze: false, textures: '1k', cloudDeckSteps: 0
  },
  high: {
    name: 'high', label: 'HIGH',
    maxDpr: 2, scaleMin: 0.7, scaleMax: 1.0,
    aa: 'msaa', msaa: 4,
    shadows: 3, shadowSize: 2048, shadowFar: 1400,
    ao: false, motionBlur: true, godRays: true, lensFlare: true, bloomHalfRes: false,
    particles: 16384, clouds: 320, oceanRings: 7, oceanRes: 128,
    terrainRes: 96, anisotropy: 8, heatHaze: true, textures: '2k', cloudDeckSteps: 1
  },
  ultra: {
    name: 'ultra', label: 'ULTRA',
    maxDpr: 2, scaleMin: 0.85, scaleMax: 1.0,
    aa: 'msaa+smaa', msaa: 4,
    shadows: 4, shadowSize: 2048, shadowFar: 2200,
    ao: true, motionBlur: true, godRays: true, lensFlare: true, bloomHalfRes: false,
    particles: 32768, clouds: 480, oceanRings: 8, oceanRes: 160,
    terrainRes: 128, anisotropy: 16, heatHaze: true, textures: '2k', cloudDeckSteps: 2
  }
};

export const PRESET_ORDER = ['low', 'medium', 'high', 'ultra'];

export function gpuInfo(gl) {
  let renderer = '', vendor = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '';
      vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || '';
    } else {
      renderer = gl.getParameter(gl.RENDERER) || '';
      vendor = gl.getParameter(gl.VENDOR) || '';
    }
  } catch {
    /* ignore */
  }
  return { renderer, vendor };
}

/** Heuristic first guess, refined by measuring real frame times later. */
export function detectPreset(gl) {
  const { renderer } = gpuInfo(gl);
  const r = renderer.toLowerCase();
  const mobile = typeof navigator !== 'undefined' && /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  if (/swiftshader|llvmpipe|software|microsoft basic/.test(r)) return 'low';
  if (mobile) {
    if (/adreno \(tm\) (7|8)\d\d|apple gpu|mali-g7(1|2)\d|immortalis/.test(r)) return 'medium';
    return 'low';
  }
  if (/rtx|radeon rx (6|7|8|9)\d\d\d|arc a7|apple m\d (pro|max|ultra)|rx 7\d\d\d|rx 9\d\d\d/.test(r)) return 'ultra';
  if (/nvidia|geforce|radeon|apple m\d|arc/.test(r)) return 'high';
  if (/intel/.test(r)) return 'medium';
  return 'high';
}

/**
 * Adaptive render scale. Feed it frame times; it nudges the scale inside the
 * preset's [scaleMin, scaleMax] to hold the target frame rate.
 *
 * Anti-flicker rules: at least `minInterval` seconds between two changes, wide
 * hysteresis (down when the median frame is > 1.2x the budget for 2 s, up only
 * after 8 s of comfortable frames), nothing while `locked` (Climax, cinematics),
 * and an up-step that is quickly undone doubles the wait before the next
 * up-step (no oscillation). `onChange` must only *request* a resize: the game
 * applies it before drawing the next frame.
 */
export class DynamicResolution {
  constructor(preset, targetFps = 60) {
    this.setPreset(preset);
    this.targetMs = 1000 / targetFps;
    this.samples = new Float32Array(90);
    this._sorted = new Float32Array(90);
    this._median = this.targetMs;
    this._frame = 0;
    this.n = 0;
    this.i = 0;
    this.over = 0;
    this.under = 0;
    this.minInterval = 4; // s between two changes
    this.downHold = 2; // s over budget before stepping down
    this.upHold = 8; // s comfortable before stepping up (doubles on oscillation)
    this.sinceChange = 0;
    this.lastDir = 0;
    this.changes = 0;
    this.locked = false; // e.g. during Climax
    this.enabled = true;
    this.onChange = null;
    this.suggestDowngrade = false;
  }

  setPreset(p) {
    this.min = p.scaleMin;
    this.max = p.scaleMax;
    this.scale = p.scaleMax;
    this.over = this.under = 0;
  }

  setTargetFps(fps) {
    this.targetMs = 1000 / fps;
  }

  /** Median of the recent frame times (robust against single hitches). */
  median() {
    const n = Math.min(this.n, this.samples.length);
    if (!n) return this.targetMs;
    const s = this._sorted;
    s.set(this.samples);
    if (n < s.length) s.fill(Infinity, n);
    s.sort();
    return s[n >> 1];
  }

  /**
   * @param {number} frameMs frame interval (ms)
   * @param {number} dtSec frame interval (s)
   * @param {number} [workMs] CPU work of the frame (ms), when known
   */
  push(frameMs, dtSec, workMs = 0) {
    this.samples[this.i] = frameMs;
    this.i = (this.i + 1) % this.samples.length;
    this.n++;
    this.sinceChange += dtSec;
    if (!this.enabled || this.locked) {
      this.over = this.under = 0;
      return;
    }
    if (this.n < 30) return;
    if ((this._frame++ & 7) === 0) this._median = this.median();
    const m = this._median;
    const T = this.targetMs;
    if (m > T * 1.2) {
      this.over += dtSec;
      this.under = 0;
    } else if (m < T * 1.05 && workMs < T * 0.7) {
      // holding vsync with CPU headroom
      this.under += dtSec;
      this.over = 0;
    } else {
      this.over = Math.max(0, this.over - dtSec);
      this.under = 0;
    }
    if (this.sinceChange < this.minInterval) return;
    let next = this.scale;
    if (this.over > this.downHold) next = Math.max(this.min, this.scale - 0.08);
    else if (this.under > this.upHold) next = Math.min(this.max, this.scale + 0.05);
    if (next !== this.scale) {
      const dir = next < this.scale ? -1 : 1;
      if (next === this.min && dir < 0) this.suggestDowngrade = true;
      // an up-step undone within 10 s: wait twice as long before the next one
      if (dir < 0 && this.lastDir > 0 && this.sinceChange < 10) this.upHold = Math.min(this.upHold * 2, 64);
      this.lastDir = dir;
      this.scale = next;
      this.over = this.under = 0;
      this.sinceChange = 0;
      this.changes++;
      if (this.onChange) this.onChange(this.scale);
    }
  }
}
