// Visual "look" presets per environment: sun, atmosphere, fog, exposure,
// grade, ocean preset, sky stylisation, bloom, cloud lighting. Stage defs
// compose them, e.g.
//   env: { ...LOOKS.oceanDay, clouds: { ...LOOKS.oceanDay.clouds, count: 1.2 } }
// Owned by the LOOK stream (docs/overhaul/CONTRACTS.md §7). These initial
// values are the pre-overhaul looks; LOOK replaces them with vivid arcade looks.

const oceanDay = {
  elev: 5.5,
  azim: 28,
  rayleigh: 1.25,
  mie: 1.05,
  mieG: 0.82,
  sunIntensity: 22,
  exposure: 1.0,
  groundAlbedo: [0.02, 0.05, 0.08],
  cloudCover: 0.26,
  cloudDensity: 0.85,
  cloudHeight: 1.0,
  cirrus: 0.3,
  stars: 0,
  fogDensity: 0.00011,
  fogFalloff: 0.0012,
  horizonFog: 0.25,
  ocean: 'goldSwell',
  grade: 'goldenHour',
  toneExposure: 0.55,
  clouds: { count: 1.0, minY: 140, maxY: 1300, spread: 2600, puffSize: [180, 420], sun: 1.15, ambient: 2.1 }
};

const canyonRed = {
  elev: 31,
  azim: -62,
  rayleigh: 0.95,
  mie: 2.2,
  mieG: 0.8,
  sunIntensity: 22,
  exposure: 1.0,
  groundAlbedo: [0.33, 0.21, 0.14],
  cloudCover: 0.12,
  cloudDensity: 0.6,
  cloudHeight: 0.8,
  cirrus: 0.35,
  stars: 0,
  fogDensity: 0.00016,
  fogFalloff: 0.0011,
  horizonFog: 0.3,
  grade: 'canyon',
  toneExposure: 0.5,
  envIntensity: 1.0,
  textures: true,
  clouds: { count: 0.35, minY: 1400, maxY: 2400, spread: 3500, puffSize: [220, 480], sun: 1.1, ambient: 2.0 }
};

const twilight = {
  elev: 1.6,
  azim: 22,
  rayleigh: 1.35,
  mie: 1.3,
  mieG: 0.86,
  sunIntensity: 22,
  exposure: 1.0,
  groundAlbedo: [0.02, 0.03, 0.06],
  cloudCover: 0.2,
  cloudDensity: 0.7,
  cloudHeight: 0.7,
  cirrus: 0.6,
  stars: 0.35,
  fogDensity: 0.00006,
  fogFalloff: 0.0007,
  fogBase: 800,
  horizonFog: 0.35,
  ocean: 'twilight',
  grade: 'twilight',
  toneExposure: 0.62,
  envIntensity: 1.1,
  deck: { y: 1050, cover: 0.74, sun: 0.55 },
  bloom: { threshold: 2.2, intensity: 0.7 },
  clouds: { count: 0.7, layer: { y: 1060, thickness: 160 }, spread: 3200, puffSize: [200, 380], sun: 1.3, ambient: 2.4 }
};

export const LOOKS = {
  /** Blue sky, white cumulus, deep glossy blue sea (stage "ocean"). */
  oceanDay,
  /** Green mountains with snow caps, bright day (stage "emerald", valley terrain). */
  emerald: { ...canyonRed, grade: 'canyon', groundAlbedo: [0.12, 0.2, 0.1] },
  /** Red rock canyon under a low hazy sun (stage "canyon"). */
  canyonRed,
  /** Orange sunset over the sea (stage "sunset"). */
  sunset: { ...oceanDay, elev: 3, ocean: 'twilight', grade: 'twilight' },
  /** Turquoise fjord river, snowy peaks (stage "glacier"). */
  glacier: { ...canyonRed, groundAlbedo: [0.2, 0.24, 0.28], grade: 'canyon' },
  /** Bright yellow desert dunes, cyan sky (stage "dunes"). */
  dunes: { ...canyonRed, elev: 40, groundAlbedo: [0.5, 0.38, 0.18] },
  /** Golden twilight above a cloud sea (stage "clouds"). */
  clouds: twilight,
  /** Twilight final battle above the clouds (stage "fortress"). */
  fortress: twilight,
  /** Hazy canyon strike run (stage "strike"). */
  strike: canyonRed,
  /** Night aurora over a dark icy sea (bonus stage "aurora"). */
  aurora: { ...twilight, elev: -8, stars: 1, ocean: 'twilight', aurora: 1 },
  /** Title flyby. */
  title: oceanDay,
  /** Hangar / carrier deck showcase. */
  hangar: { ...oceanDay, elev: 3.5, azim: 60, toneExposure: 0.6 }
};
