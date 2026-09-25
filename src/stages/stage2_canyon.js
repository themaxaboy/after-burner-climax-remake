import { buildRail } from './railBuilder.js';
import { Stage2Logic } from './stage2Logic.js';

// STAGE 2 — CANYON GRANDEUR "The Run"
// Desert approach, a 22 km canyon run under the radar ceiling (XB-70
// emergency order on the way), then pop-up, dive onto the target, pull out
// hard through a SAM volley and escape.
const segs = [
  { len: 2000, turn: 0, alt: 60 },
  { len: 2500, turn: 18, alt: 55 },
  { len: 1500, turn: -14, alt: 42 },
  { len: 2000, turn: 30, alt: 36 },
  { len: 2000, turn: -34, alt: 30 },
  { len: 1800, turn: 24, alt: 26 },
  { len: 2200, turn: -30, alt: 24 },
  { len: 2000, turn: 34, alt: 22 },
  { len: 2500, turn: -18, alt: 26 },
  { len: 2000, turn: 38, alt: 28 },
  { len: 2000, turn: -32, alt: 32 },
  { len: 2500, turn: 22, alt: 38 },
  { len: 2000, turn: -16, alt: 44 },
  { len: 1500, turn: 0, alt: 50 },
  { len: 1300, turn: 0, alt: 380 }, // pop-up
  { len: 1000, turn: 0, alt: 70 }, // dive onto the target
  { len: 450, turn: 0, alt: 55 }, // over the target
  { len: 1500, turn: 0, alt: 620 }, // high-G pull-out through the SAMs
  { len: 3200, turn: 12, alt: 720 } // egress
];
const points = buildRail({ start: [0, 60, 18000], heading: -20, seed: 21, step: 150, segs });

// cumulative segment ends for terrain keys
const ends = [];
let acc = 0;
for (const sg of segs) {
  acc += sg.len;
  ends.push(acc);
}

export const TARGET_S = ends[15] + 200; // centre of the "over the target" segment
export const CANYON = { from: 6400, to: 27600 };

export default {
  id: 's2',
  index: 2,
  name: 'CANYON GRANDEUR',
  subtitle: 'THE RUN',
  music: 'stage2',
  rail: {
    points,
    bank: [],
    box: { x: 70, y: 36 },
    baseSpeed: 235,
    minAltitude: 10,
    startS: 150
  },
  terrain: {
    seed: 21,
    sections: [
      { s: 0, floor: 0, depth: 0, width: 320 },
      { s: 4200, floor: 0, depth: 0, width: 320 },
      { s: 5300, floor: -4, depth: 70, width: 190 },
      { s: 6600, floor: -8, depth: 230, width: 112 },
      { s: 9200, floor: -10, depth: 250, width: 92 },
      { s: 12000, floor: -14, depth: 270, width: 64 },
      { s: 14000, floor: -16, depth: 272, width: 72 },
      { s: 16000, floor: -18, depth: 285, width: 125 },
      { s: 18600, floor: -14, depth: 292, width: 112 },
      { s: 20600, floor: -12, depth: 300, width: 74 },
      { s: 23200, floor: -8, depth: 282, width: 88 },
      { s: 26000, floor: -2, depth: 225, width: 112 },
      { s: 27700, floor: 0, depth: 80, width: 230 },
      { s: 28800, floor: 0, depth: 0, width: 330 },
      { s: 60000, floor: 0, depth: 0, width: 330 }
    ]
  },
  radarCeiling: { from: 6800, to: 27000, agl: 95 },
  env: {
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
  },
  timeline: [
    { at: 600, radio: 'r.s2.brief' },
    { at: 1500, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 18 } },
    { at: 2800, spawn: { type: 'heloCH47', formation: 'line3', behavior: 'hover', dist: 2600, y: 10, spread: 1.6 } },
    { at: 3300, spawn: { type: 'samSite', behavior: 'static', dist: 3200, x: -160 } },
    { at: 3300, spawn: { type: 'samSite', behavior: 'static', dist: 3600, x: 190 } },
    { at: 3900, spawn: { type: 'fighterA', formation: 'pair', behavior: 'overtake', y: 20 } },
    { at: 5200, spawn: { type: 'fighterA', formation: 'line3', behavior: 'headOn', y: 30, spread: 0.7 } },
    // --- the canyon
    { at: 7000, spawn: { type: 'aaGun', behavior: 'static', dist: 2600, x: -150, y: 0 } },
    { at: 7000, spawn: { type: 'aaGun', behavior: 'static', dist: 3100, x: 150, y: 0 } },
    { at: 7600, spawn: { type: 'fighterA', formation: 'trail3', behavior: 'headOn', y: 6 } },
    { at: 8800, spawn: { type: 'fighterA', formation: 'pair', behavior: 'strafe', params: { side: 1 } } },
    { at: 10000, spawn: { type: 'fighterA', behavior: 'chaser', y: 8 } },
    { at: 11000, spawn: { type: 'samSite', behavior: 'static', dist: 2800, x: -135 } },
    { at: 11000, spawn: { type: 'aaGun', behavior: 'static', dist: 3300, x: 130 } },
    { at: 12200, spawn: { type: 'fighterA', formation: 'trail5', behavior: 'headOn', y: 4, spread: 0.6 } },
    { at: 13600, spawn: { type: 'heloCH47', formation: 'pair', behavior: 'hover', dist: 2400, y: 6, spread: 0.8 } },
    { at: 14800, radio: 'r.s2.xb70' },
    {
      at: 15000,
      eo: {
        id: 's2_xb70',
        title: 'DESTROY THE XB-70',
        timeLimit: 30,
        bonus: 80000,
        spawn: { type: 'bomberXB', behavior: 'bomber', tag: 'xb70', x: 0, y: 150, params: { y: 150 } }
      }
    },
    { at: 15400, spawn: { type: 'fighterA', formation: 'pair', behavior: 'overtake', y: 60 } },
    { at: 17200, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 10, spread: 0.7 } },
    { at: 18400, spawn: { type: 'aaGun', behavior: 'static', dist: 2600, x: -170 } },
    { at: 18400, spawn: { type: 'samSite', behavior: 'static', dist: 3000, x: 165 } },
    { at: 19500, spawn: { type: 'fighterA', formation: 'pair', behavior: 'chaser', y: 8 } },
    { at: 21000, spawn: { type: 'fighterA', formation: 'trail3', behavior: 'headOn', y: 2 } },
    { at: 22400, spawn: { type: 'fighterA', formation: 'pair', behavior: 'strafe', params: { side: -1 } } },
    { at: 23600, spawn: { type: 'aaGun', behavior: 'static', dist: 2400, x: 140 } },
    { at: 23600, spawn: { type: 'aaGun', behavior: 'static', dist: 2900, x: -140 } },
    { at: 24800, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 12, spread: 0.6 } },
    { at: 26300, spawn: { type: 'heloCH47', formation: 'line3', behavior: 'hover', dist: 2300, y: 30 } },
    // --- pop-up & strike
    { at: 28500, cue: 'popup' },
    { at: 28550, radio: 'r.s2.popup' },
    { at: 29000, spawn: { type: 'samSite', behavior: 'static', dist: 3200, x: -380, countable: false } },
    { at: 29000, spawn: { type: 'samSite', behavior: 'static', dist: 3400, x: 420, countable: false } },
    { at: 29400, cue: 'strikeTarget' },
    { at: 30700, cue: 'strike' },
    { at: 31900, cue: 'pullup' },
    { at: 32050, radio: 'r.s2.sams' },
    { at: 34800, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 20 } },
    { at: 36200, end: true }
  ],
  next: ['s3'],
  createLogic: (stage) => new Stage2Logic(stage)
};
