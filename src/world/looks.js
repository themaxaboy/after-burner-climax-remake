// Visual "look" presets per environment: sun, atmosphere, fog, exposure,
// grade, ocean preset, sky stylisation, bloom, cloud lighting. Stage defs
// compose them, e.g.
//   env: { ...LOOKS.oceanDay, clouds: { ...LOOKS.oceanDay.clouds, count: 1.2 } }
// Owned by the LOOK stream (docs/overhaul/CONTRACTS.md §7). Preview any look on
// any stage with `?look=<name>` (e.g. `?stage=2&look=dunes`).
//
// "Arcade vivid": each look has ONE dominant saturated hue on a bright,
// high-key image; the sun is a hot white disc with bloom; haze is light and
// bright (never grey). Conventions:
//   elev / azim   sun elevation / azimuth in degrees; azimuth 0 = straight
//                 ahead along the initial flight direction (-Z), + = to the right.
//                 Day looks keep the sun 22–40° up and ahead so it sits in the
//                 upper part of the chase-camera frame.
//   exposure      sky (atmosphere) exposure; toneExposure = post exposure (Neutral tone mapping)
//   sky           stylisation, see SKY_STYLE_DEFAULTS in atmosphere.js
//   grade         GradeEffect preset (arcade*), ocean = Ocean preset
//   clouds        cloud banks: count, height range, puff size, sun/ambient gains (null = none)
//   shadowIntensity  0..1 (lighter shadows), hemi = sky fill light intensity
//   sunTint       RGB multiplier on the physical sun colour (whiter day sun, warmer dusk)
//   bloom         { threshold, smoothing, intensity } in linear HDR (only hot pixels bloom)
//   flare / flareTint  lens flare strength and colour; aurora 0..1 night band

const sky = (o = {}) => ({ zenithBoost: -0.3, saturation: 1.35, horizonBright: 0.1, hue: null, skyHue: 0.85, horizonHue: 0.7, knee: 0.25, sunDisc: 1.6, sunGlow: 1, ...o });
// the physical sun is yellowish at 20–40°: day looks whiten it (light + disc)
const WHITE_SUN = [1, 1.18, 1.45];

/** Blue sky, bright white cumulus, deep glossy blue sea (stage "ocean"). */
const oceanDay = {
  elev: 24,
  azim: -24,
  rayleigh: 1.25,
  mie: 0.75,
  mieG: 0.8,
  ozone: 3,
  sunIntensity: 22,
  exposure: 1.0,
  groundAlbedo: [0.02, 0.07, 0.14],
  cloudCover: 0.3,
  cloudDensity: 0.9,
  cloudHeight: 1.0,
  cirrus: 0.15,
  stars: 0,
  aurora: 0,
  fogDensity: 0.00006,
  fogFalloff: 0.0012,
  horizonFog: 0.16,
  ocean: 'arcadeBlue',
  grade: 'arcadeOcean',
  toneExposure: 1.0,
  envIntensity: 1.3,
  hemi: 0.35,
  shadowIntensity: 0.7,
  sunTint: WHITE_SUN,
  sky: sky({ hue: [0.08, 0.3, 1.0] }),
  bloom: { threshold: 3.0, smoothing: 2.5, intensity: 0.85 },
  clouds: { count: 1.0, minY: 140, maxY: 1300, spread: 2600, puffSize: [180, 420], sun: 1.0, ambient: 1.0 }
};

/** Green mountains with snow caps, bright day (stage "emerald", valley terrain). */
const emerald = {
  ...oceanDay,
  elev: 30,
  azim: 18,
  rayleigh: 1.3,
  mie: 0.85,
  ozone: 3,
  groundAlbedo: [0.1, 0.24, 0.08],
  cloudCover: 0.34,
  cirrus: 0.2,
  fogDensity: 0.00008,
  fogFalloff: 0.0011,
  horizonFog: 0.2,
  ocean: 'glacierRiver', // world water plane at y = 0 = the valley river (TerrainRun)
  grade: 'arcadeEmerald',
  textures: true,
  sky: sky({ hue: [0.1, 0.38, 1.0] }),
  clouds: { count: 0.6, minY: 900, maxY: 2100, spread: 3200, puffSize: [220, 480], sun: 1.0, ambient: 1.0 }
};

/** Red rock canyon under a low, hazy sun (stage "canyon"). */
const canyonRed = {
  ...oceanDay,
  elev: 22,
  azim: -34,
  rayleigh: 1.0,
  mie: 1.8,
  mieG: 0.85,
  ozone: 2,
  groundAlbedo: [0.4, 0.2, 0.12],
  cloudCover: 0.12,
  cloudDensity: 0.6,
  cloudHeight: 0.8,
  cirrus: 0.25,
  fogDensity: 0.00012,
  fogFalloff: 0.001,
  horizonFog: 0.28,
  ocean: null,
  grade: 'arcadeCanyon',
  toneExposure: 1.0,
  textures: true,
  sunTint: [1.06, 0.96, 0.86],
  sky: sky({ saturation: 1.3, zenithBoost: -0.15, hue: [0.12, 0.4, 1.0], skyHue: 0.6, horizonHue: 0.3, sunDisc: 2.0, sunGlow: 1.4 }),
  bloom: { threshold: 3.0, smoothing: 2.5, intensity: 0.9 },
  clouds: { count: 0.35, minY: 1400, maxY: 2400, spread: 3500, puffSize: [220, 480], sun: 1.0, ambient: 1.0 }
};

/** Golden twilight above a sea of clouds (stage "clouds"). */
const clouds = {
  ...oceanDay,
  elev: 12,
  azim: 26,
  rayleigh: 1.3,
  mie: 1.2,
  mieG: 0.78,
  ozone: 3,
  sunTint: [1.08, 0.92, 0.72],
  groundAlbedo: [0.02, 0.03, 0.06],
  cloudCover: 0.2,
  cloudDensity: 0.7,
  cloudHeight: 0.7,
  cirrus: 0.5,
  stars: 0,
  fogDensity: 0.00005,
  fogFalloff: 0.0007,
  fogBase: 800,
  horizonFog: 0.3,
  ocean: 'sunsetGold',
  grade: 'arcadeClouds',
  toneExposure: 0.9,
  envIntensity: 1.3,
  flare: 0.6,
  sky: sky({ saturation: 1.3, zenithBoost: -0.1, hue: [1.0, 0.62, 0.25], skyHue: 0.6, horizonHue: 0.45, knee: 0.3, sunDisc: 2.0, sunGlow: 1.0 }),
  deck: { y: 1050, cover: 0.74, sun: 0.5 },
  bloom: { threshold: 4.0, smoothing: 3.0, intensity: 0.9 },
  clouds: { count: 0.7, layer: { y: 1060, thickness: 160 }, spread: 3200, puffSize: [200, 380], sun: 1.0, ambient: 1.0 }
};

export const LOOKS = {
  /** Blue sky, white cumulus, deep glossy blue sea (stage "ocean"). */
  oceanDay,
  /** Green mountains with snow caps, bright day (stage "emerald", valley terrain). */
  emerald,
  /** Red rock canyon under a low hazy sun (stage "canyon"). */
  canyonRed,
  /** Orange sunset over the sea (stage "sunset"). */
  sunset: {
    ...oceanDay,
    elev: 6,
    azim: 0,
    rayleigh: 1.4,
    mie: 1.3,
    mieG: 0.86,
    ozone: 3,
    groundAlbedo: [0.03, 0.03, 0.05],
    cloudCover: 0.26,
    cloudDensity: 0.8,
    cirrus: 0.45,
    fogDensity: 0.00006,
    fogFalloff: 0.001,
    horizonFog: 0.3,
    ocean: 'sunsetGold',
    grade: 'arcadeSunset',
    toneExposure: 1.05,
    sunTint: [1, 1, 1],
    flare: 0.7,
    sky: sky({ saturation: 1.35, zenithBoost: -0.2, hue: [1.0, 0.48, 0.18], skyHue: 0.55, horizonHue: 0.5, knee: 0.3, sunDisc: 2.2, sunGlow: 1.2 }),
    bloom: { threshold: 3.0, smoothing: 2.5, intensity: 1.0 },
    clouds: { ...oceanDay.clouds, count: 0.8 }
  },
  /** Turquoise fjord river, snowy peaks (stage "glacier"; the world ocean plane is the river). */
  glacier: {
    ...emerald,
    elev: 28,
    azim: 22,
    rayleigh: 1.35,
    mie: 0.6,
    ozone: 3.5,
    groundAlbedo: [0.3, 0.36, 0.4],
    fogDensity: 0.00007,
    horizonFog: 0.18,
    ocean: 'glacierRiver',
    grade: 'arcadeGlacier',
    sky: sky({ hue: [0.05, 0.45, 1.0], horizonHue: 0.8 }),
    clouds: { ...emerald.clouds, count: 0.5 }
  },
  /** Bright yellow desert dunes under a cyan sky (stage "dunes"). */
  dunes: {
    ...canyonRed,
    elev: 36,
    azim: -16,
    rayleigh: 1.1,
    mie: 0.8,
    mieG: 0.8,
    ozone: 2,
    groundAlbedo: [0.62, 0.48, 0.16],
    cloudCover: 0.14,
    fogDensity: 0.00004,
    fogFalloff: 0.0014,
    horizonFog: 0.14,
    grade: 'arcadeDunes',
    toneExposure: 1.05,
    envIntensity: 1.0,
    hemi: 0.25,
    sunTint: [1.1, 1.08, 0.95], // warm white: sand reads yellow, not khaki
    sky: sky({ saturation: 1.4, zenithBoost: -0.1, hue: [0.0, 0.62, 1.0], horizonHue: 0.6, iblSaturation: 1.0 }),
    clouds: { ...canyonRed.clouds, count: 0.25 }
  },
  /** Golden twilight above a cloud sea (stage "clouds"). */
  clouds,
  /** Twilight final battle above the clouds (stage "fortress"). */
  fortress: {
    ...clouds,
    elev: 5,
    azim: -12,
    rayleigh: 1.4,
    mie: 1.4,
    grade: 'arcadeFortress',
    flare: 0.7,
    sky: sky({ saturation: 1.3, zenithBoost: -0.2, hue: [1.0, 0.55, 0.22], skyHue: 0.4, horizonHue: 0.35, knee: 0.3, sunDisc: 2.2, sunGlow: 1.2 }),
    bloom: { threshold: 4.0, smoothing: 3.0, intensity: 1.0 }
  },
  /** Hazy canyon strike run, low over the rocks (stage "strike"). */
  strike: {
    ...canyonRed,
    elev: 26,
    azim: 28,
    mie: 2.2,
    horizonFog: 0.34,
    fogDensity: 0.00014,
    grade: 'arcadeStrike'
  },
  /** Night aurora over a dark icy sea (bonus stage "aurora"): a dim "moon" sun, stars, aurora band. */
  aurora: {
    ...oceanDay,
    elev: 16,
    azim: 6,
    rayleigh: 1.6,
    mie: 0.6,
    ozone: 3,
    exposure: 0.07,
    sunTint: [0.75, 0.9, 1.15],
    groundAlbedo: [0.01, 0.03, 0.04],
    cloudCover: 0.14,
    cloudDensity: 0.5,
    cirrus: 0.1,
    stars: 1,
    aurora: 1,
    fogDensity: 0.00004,
    horizonFog: 0.12,
    ocean: 'auroraNight',
    grade: 'arcadeAurora',
    toneExposure: 1.15,
    envIntensity: 2.2,
    hemi: 0.6,
    sky: sky({ saturation: 1.3, zenithBoost: 0, hue: [0.0, 0.5, 0.75], skyHue: 0.7, horizonHue: 0.8, sunDisc: 1.1, sunGlow: 0.5 }),
    bloom: { threshold: 1.0, smoothing: 1.5, intensity: 1.0 },
    flare: 0.25,
    clouds: null
  },
  /** Title flyby. */
  title: { ...oceanDay, cloudCover: 0.32 },
  /** Hangar / carrier deck showcase. */
  hangar: { ...oceanDay, elev: 18, azim: 60, grade: 'arcadeHangar', toneExposure: 1.0 }
};

export const LOOK_NAMES = Object.keys(LOOKS);
