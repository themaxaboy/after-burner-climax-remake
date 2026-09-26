import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { eoTally } from '../common/eoTally.js';
import { TERRAIN_BOX, defineStage, eo, makeRail } from './kit.js';

// MOONLIT BADLANDS / NIGHT CROSSING — silver dunes under the moon, the last
// stretch before the fortress. Emergency Order: stop the night airlift
// (down 8 of 10 transport helicopters).
const { points } = makeRail({
  start: [0, 60, 0],
  heading: 30,
  seed: 171,
  step: 150,
  segs: [
    { len: 1500, turn: 0, alt: 60 },
    { len: 2500, turn: 18, alt: 48 },
    { len: 2500, turn: -22, alt: 42 },
    { len: 2500, turn: 16, alt: 50 },
    { len: 2200, turn: -10, alt: 60 },
    { len: 2000, turn: 0, alt: 90 }
  ]
});

const HELO = { type: 'heloCH47', behavior: 'hover', tag: 'helos' };

const terrain = {
  seed: 171,
  profile: 'dunes',
  palette: 'moonsand',
  sections: [
    { s: 0, floor: 0, depth: 24, width: 200 },
    { s: 2500, floor: 0, depth: 40, width: 150 },
    { s: 7000, floor: 0, depth: 50, width: 120 },
    { s: 11000, floor: 0, depth: 36, width: 160 },
    { s: 16000, floor: 0, depth: 20, width: 260 }
  ],
  centre: { amp: 100, wavelength: 2400, from: 1800, to: 11000, phase: 1.4 },
  water: null,
  obstacles: [{ from: 2000, to: 11000, every: [550, 950], kinds: ['spire', 'pillar', 'tower'], lat: [-0.85, 0.85] }]
};

export default defineStage({
  id: 'badlands',
  music: 'stage3',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: 240, minAltitude: 12, startS: 150, noRoll: true },
  look: 'badlands',
  terrain,
  waves: {
    seed: 171,
    rate: { base: 1.9, perStar: 0.12 },
    floor: 3,
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1200, to: 13000 }],
    quiet: [[4300, 7400]],
    mix: [['chaserPair', 2], ['overtakeClose', 2], ['vHeadOn', 3], ['headOnPass', 2.5], ['pincer', 1.5], ['heloLine', 1.5], ['groundSites', 1, { minS: 3000 }], ['crossSweep', 1], ['heavyPair', 1, { minS: 5000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', helo: 'heloCH47', site: 'samSite', gun: 'aaGun' },
    preloadTypes: ['heloCH47']
  },
  timeline: [
    { at: 500, radio: 'r.badlands.brief' },
    { at: 1400, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 25 } },
    { at: 4200, radio: 'r.badlands.helos' },
    {
      at: 4400,
      eo: eo('eo.badlands', {
        id: 'badlands_helos',
        count: 8,
        tags: [], // counted by eoTally (8 of 10)
        timeLimit: 24,
        bonus: 80000,
        spawn: [
          { ...HELO, formation: 'line3', dist: 2300, x: 60, y: -15, spread: 1.4 },
          { ...HELO, formation: 'line3', dist: 3000, x: -70, y: -10, spread: 1.4 },
          { ...HELO, formation: 'pair', dist: 3700, x: 20, y: -5, spread: 2 },
          { ...HELO, formation: 'pair', dist: 4300, x: -40, y: -12, spread: 2 }
        ]
      })
    },
    { at: 8600, spawn: { type: 'stealthB', formation: 'pair', behavior: 'chaser', y: 12 } },
    { at: 11000, radio: 'r.badlands.fortress' }
  ],
  par: { time: 58, combo: 30, downRate: 70, score: 170000 },
  createLogic: compose(terrainRun(terrain), eoTally({ eo: 'badlands_helos', tag: 'helos', need: 8, total: 10 }))
});
