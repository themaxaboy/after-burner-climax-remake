import { buildRail } from './railBuilder.js';

// STAGE 1 — BOUNDLESS OCEAN "Dawn Launch"
// Golden-hour carrier launch, low-level over the sea, fighter waves and a
// destroyer group; ends with an aerial refuelling interlude.
const points = buildRail({
  start: [0, 60, 21000],
  heading: 0,
  seed: 11,
  segs: [
    { len: 3000, turn: 0, alt: 55 },
    { len: 4000, turn: 18, alt: 70 },
    { len: 4000, turn: -30, alt: 45 },
    { len: 5000, turn: 12, alt: 90 },
    { len: 4000, turn: 20, alt: 60 },
    { len: 5000, turn: -25, alt: 40 },
    { len: 4000, turn: 8, alt: 110 },
    { len: 5000, turn: -10, alt: 70 },
    { len: 6000, turn: 15, alt: 150 },
    { len: 4000, turn: 0, alt: 300 }
  ]
});

export default {
  id: 's1',
  index: 1,
  name: 'BOUNDLESS OCEAN',
  subtitle: 'DAWN LAUNCH',
  music: 'stage1',
  rail: {
    points,
    bank: [],
    box: { x: 70, y: 36 },
    baseSpeed: 230,
    minAltitude: 14
  },
  env: {
    // sun low in front-right: golden hour, lens flares, long shadows
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
    cirrus: 0.55,
    stars: 0,
    fogDensity: 0.00011,
    fogFalloff: 0.0012,
    horizonFog: 0.25,
    ocean: 'goldSwell',
    grade: 'goldenHour',
    toneExposure: 0.55,
    clouds: { count: 1.0, minY: 350, maxY: 1400, spread: 2600 }
  },
  timeline: [],
  next: ['s2']
};
