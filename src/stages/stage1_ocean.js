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
    cirrus: 0.3,
    stars: 0,
    fogDensity: 0.00011,
    fogFalloff: 0.0012,
    horizonFog: 0.25,
    ocean: 'goldSwell',
    grade: 'goldenHour',
    toneExposure: 0.55,
    clouds: { count: 1.0, minY: 140, maxY: 1300, spread: 2600, puffSize: [180, 420], sun: 1.15, ambient: 2.1 }
  },
  timeline: [
    { at: 700, radio: 'r.s1.feetWet' },
    { at: 2300, radio: 'r.s1.tallyho' },
    { at: 2400, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 8 } },
    { at: 4300, radio: 'r.s1.six' },
    { at: 4400, spawn: { type: 'fighterA', formation: 'pair', behavior: 'overtake', y: 14 } },
    { at: 5600, spawn: { type: 'fighterA', behavior: 'crossing', x: -460, y: 20, dist: 1300 } },
    { at: 6100, spawn: { type: 'fighterA', behavior: 'crossing', x: 460, y: 5, dist: 1400 } },
    { at: 7200, spawn: { type: 'fighterA', formation: 'wall6', behavior: 'headOn', y: 12 } },
    { at: 8800, spawn: { type: 'fighterA', formation: 'echelonR4', behavior: 'formation', x: -30, y: 18 } },
    { at: 10200, spawn: { type: 'fighterA', behavior: 'chaser', y: 10 } },
    { at: 11600, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', x: -55, y: 6 } },
    { at: 11900, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', x: 60, y: 22 } },
    { at: 12900, radio: 'r.s1.ships' },
    { at: 13000, spawn: { type: 'destroyer', behavior: 'static', dist: 3600, x: 380, heading: 180 } },
    { at: 13000, spawn: { type: 'samBoat', behavior: 'static', dist: 3000, x: -260, heading: 170 } },
    { at: 13400, spawn: { type: 'samBoat', behavior: 'static', dist: 4200, x: 140, heading: 190 } },
    { at: 14600, spawn: { type: 'fighterA', formation: 'line4', behavior: 'headOn', y: -8 } },
    { at: 16200, spawn: { type: 'fighterA', formation: 'trail3', behavior: 'overtake', x: 20, y: 16 } },
    { at: 17600, spawn: { type: 'fighterA', formation: 'pair', behavior: 'strafe', params: { side: 1 } } },
    { at: 18900, radio: 'r.s1.eo' },
    {
      at: 19000,
      eo: {
        id: 's1_bomber',
        title: 'DESTROY THE HEAVY BOMBER',
        timeLimit: 32,
        bonus: 50000,
        spawn: { type: 'bomberXB', behavior: 'bomber', tag: 'xb70', x: 10, y: 60 }
      }
    },
    { at: 19100, spawn: { type: 'fighterA', formation: 'pair', behavior: 'overtake', x: -40, y: 30 } },
    { at: { event: 'killed', tag: 'xb70' }, radio: 'r.s1.eoDown' },
    { at: 21500, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', y: 10 } },
    { at: 24200, spawn: { type: 'destroyer', behavior: 'static', dist: 3800, x: -420, heading: 10 } },
    { at: 24200, spawn: { type: 'destroyer', behavior: 'static', dist: 4600, x: 300, heading: -10 } },
    { at: 24500, spawn: { type: 'samBoat', formation: 'pair', behavior: 'static', dist: 3300, x: 60 } },
    { at: 26300, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', x: 30, y: 14 } },
    { at: 26800, spawn: { type: 'fighterA', behavior: 'crossing', x: -480, y: 25, dist: 1200 } },
    { at: 28200, spawn: { type: 'fighterA', formation: 'pair', behavior: 'chaser', y: 12 } },
    { at: 30000, spawn: { type: 'fighterA', formation: 'box4', behavior: 'formation', y: 10 } },
    { at: 32000, spawn: { type: 'fighterA', formation: 'wall6', behavior: 'headOn', y: 5 } },
    { at: 32400, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 30 }, minRank: 2 },
    { at: 34200, spawn: { type: 'fighterA', formation: 'V3', behavior: 'overtake', y: 18 } },
    { at: 36200, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', y: 20 } },
    { at: 37500, spawn: { type: 'fighterA', formation: 'pair', behavior: 'strafe', params: { side: -1 } } },
    { at: 39500, radio: 'r.s1.tanker' },
    { at: 40500, cue: 'refuel' },
    { at: 42500, end: true }
  ],
  next: ['s2']
};
