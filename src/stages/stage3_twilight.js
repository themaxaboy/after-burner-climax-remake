// LEGACY v1 stage data (pre-routes, ~3 min stage). Not part of the campaign
// (see ./campaign.js and ./defs/); kept only as fixture data for the unit
// tests sim.test.js and terrain.test.js. Delete once they use ./defs/.
import { buildRail } from './railBuilder.js';

// STAGE 3 — SEA OF TWILIGHT "Final Line"
// Above a sea of clouds at dusk: stealth fighters, a dogfighting ace and the
// heavy bomber strike package (destroy its four engines). Then down through
// the clouds for a carrier landing at last light.
const segs = [
  { len: 3000, turn: 0, alt: 1600 },
  { len: 4000, turn: 18, alt: 1650 },
  { len: 4000, turn: -22, alt: 1560 },
  { len: 5000, turn: 14, alt: 1700 },
  { len: 4000, turn: -18, alt: 1620 },
  { len: 5000, turn: 22, alt: 1660 },
  { len: 5000, turn: -14, alt: 1600 },
  { len: 3000, turn: 0, alt: 1480 },
  { len: 4200, turn: 0, alt: 700 }, // descent through the cloud deck
  { len: 3200, turn: 0, alt: 190 },
  { len: 3400, turn: 0, alt: 21.7 }, // final approach (~3.3°)
  { len: 300, turn: 0, alt: 21.7 } // roll-out on the deck
];
const points = buildRail({ start: [0, 1600, 24000], heading: 15, seed: 31, step: 200, segs });

let acc = 0;
export const S3_ENDS = segs.map((s) => (acc += s.len));

export default {
  id: 's3',
  index: 3,
  name: 'SEA OF TWILIGHT',
  subtitle: 'FINAL LINE',
  music: 'stage3',
  rail: {
    points,
    bank: [],
    box: { x: 72, y: 40 },
    baseSpeed: 245,
    minAltitude: 12,
    startS: 150
  },
  env: {
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
  },
  timeline: [
    { at: 500, radio: 'r.s3.brief' },
    { at: 1800, spawn: { type: 'stealthB', formation: 'V3', behavior: 'headOn', y: 10 } },
    { at: 3300, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', y: 20 } },
    { at: 4800, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', y: 18 } },
    { at: 6000, spawn: { type: 'fighterA', behavior: 'crossing', x: -480, y: 30, dist: 1300 } },
    { at: 6400, spawn: { type: 'fighterA', behavior: 'crossing', x: 480, y: -5, dist: 1500 } },
    { at: 7600, spawn: { type: 'stealthB', formation: 'pair', behavior: 'chaser', y: 10 } },
    { at: 9000, spawn: { type: 'fighterA', formation: 'wall6', behavior: 'headOn', y: 15 } },
    { at: 10400, radio: 'r.s3.ace' },
    { at: 10500, spawn: { type: 'ace', behavior: 'ace', tag: 'ace', y: 20 } },
    { at: 12500, spawn: { type: 'stealthB', formation: 'V3', behavior: 'headOn', y: 30 }, minRank: 1 },
    { at: 15800, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 5 } },
    { at: 17400, radio: 'r.s3.fortress' },
    { at: 17500, cue: 'boss' },
    { at: 18200, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', x: -60, y: 50 } },
    { at: 21000, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 40 } },
    { at: 24500, spawn: { type: 'stealthB', formation: 'pair', behavior: 'chaser', y: 12 } },
    { at: 28000, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', y: 20 } },
    { at: 32500, cue: 'bossEscape' },
    { at: 33200, cue: 'descend' },
    { at: 46000, end: true }
  ],
  next: []
};
