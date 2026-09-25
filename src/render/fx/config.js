// FX configuration: quality budgets and particle kind ids shared by the CPU
// recipes and the GLSL (the shaders receive the ids as #defines).

/**
 * Per-quality budgets.
 *  particles   default pool size (split between the smoke and additive layers)
 *  smokeShare  fraction of the pool reserved for the alpha (smoke) layer
 *  count       multiplier applied to every recipe's particle counts
 *  trails      ribbon trail slots x points per trail
 *  tracers     max bullets drawn by fx.tracers
 *  atlas       procedural sprite atlas resolution (4x4 cells)
 *  abSteps     afterburner raymarch steps
 *  maxScreen   max particle radius as a fraction of the viewport height (overdraw cap;
 *              smoke also fades out as it approaches this size, see particles.js)
 *  lights      pooled explosion flash PointLights (created at stage load, never added later)
 *  liteBurst   full explosions allowed per 0.25 s before the cheap 'lite' recipe is used
 */
export const FX_QUALITY = {
  low: {
    name: 'low', particles: 4096, smokeShare: 0.5, count: 0.45, maxScreen: 0.22,
    trails: 32, trailPoints: 64, tracers: 256, atlas: 512, noise: 128, abSteps: 6, flares: 3, lights: 0, liteBurst: 2
  },
  medium: {
    name: 'medium', particles: 8192, smokeShare: 0.5, count: 0.7, maxScreen: 0.26,
    trails: 40, trailPoints: 80, tracers: 384, atlas: 1024, noise: 256, abSteps: 8, flares: 4, lights: 0, liteBurst: 3
  },
  high: {
    name: 'high', particles: 16384, smokeShare: 0.5, count: 1.0, maxScreen: 0.3,
    trails: 48, trailPoints: 96, tracers: 512, atlas: 1024, noise: 256, abSteps: 12, flares: 5, lights: 2, liteBurst: 3
  },
  ultra: {
    name: 'ultra', particles: 32768, smokeShare: 0.5, count: 1.35, maxScreen: 0.34,
    trails: 64, trailPoints: 128, tracers: 1024, atlas: 1024, noise: 256, abSteps: 16, flares: 6, lights: 3, liteBurst: 3
  }
};

export function fxQuality(q) {
  return FX_QUALITY[q] || FX_QUALITY.high;
}

// Additive layer kinds
export const K_FIRE = 0;
export const K_FLASH = 1;
export const K_SPARK = 2;
export const K_GLOW = 3;
export const K_FLARE = 4;
export const K_RING = 5;
export const K_EMBER = 6;
export const K_MUZZLE = 7;

// Smoke (premultiplied alpha) layer kinds
export const S_SMOKE = 0;
export const S_DEBRIS = 1;
export const S_SPRAY = 2;
export const S_MIST = 3;
export const S_FIRE = 4; // fireball puff: emissive + occluding, cools into soot

// Trail kinds
export const TRAIL_KINDS = { missile: 0, vortex: 1, contrail: 2, smoke: 3, fire: 4, flare: 5 };

/**
 * Default look of each ribbon trail kind. width0 -> width1 over life (m), life (s).
 * missile: the thick white rocket smoke of the original (enemy missiles 2 -> 16 m over 3.5 s).
 */
export const TRAIL_DEFAULTS = {
  missile: { width0: 2.0, width1: 16.0, life: 3.5, color: [0.96, 0.96, 0.97], opacity: 0.95, headGlow: true },
  vortex: { width0: 0.25, width1: 0.9, life: 0.6, color: [1, 1, 1], opacity: 0.4, headGlow: false },
  contrail: { width0: 1.2, width1: 10.0, life: 4.0, color: [0.97, 0.97, 1.0], opacity: 0.55, headGlow: false },
  smoke: { width0: 2.0, width1: 14.0, life: 4.0, color: [0.14, 0.135, 0.13], opacity: 0.8, headGlow: false },
  fire: { width0: 1.6, width1: 11.0, life: 3.2, color: [0.13, 0.12, 0.11], opacity: 0.85, headGlow: true },
  flare: { width0: 1.0, width1: 7.0, life: 2.6, color: [0.95, 0.95, 0.95], opacity: 0.8, headGlow: false }
};

/**
 * Missile trail presets used by the stage hooks (width = start width, the end
 * width scales with TRAIL_DEFAULTS.missile). Climax salvos use `climaxLife`.
 */
export const MISSILE_TRAILS = {
  enemy: { width: 2.0, life: 3.5, opacity: 0.95, color: [0.96, 0.96, 0.97] },
  enemyStrong: { width: 2.2, life: 3.5, opacity: 0.95, color: [1.0, 0.62, 0.55] },
  player: { width: 1.5, life: 2.8, opacity: 0.9, color: [0.95, 0.95, 0.97] },
  climaxLife: 1.6
};

export const FX_DEFINES = {
  K_FIRE, K_FLASH, K_SPARK, K_GLOW, K_FLARE, K_RING, K_EMBER, K_MUZZLE,
  S_SMOKE, S_DEBRIS, S_SPRAY, S_MIST, S_FIRE
};
