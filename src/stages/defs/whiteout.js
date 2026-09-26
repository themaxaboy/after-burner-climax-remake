import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { routeSelect } from '../common/routeSelect.js';
import { cruiseMissiles } from '../common/cruiseMissiles.js';
import { TERRAIN_BOX, defineStage, eo, makeRail, routeSelectAt } from './kit.js';

// WHITEOUT / SNOWFIELD — a wide snow valley in a bright haze, fighters
// hunting from behind. Emergency Order: cruise missiles skimming the snow
// (gun only). Ends with the ROUTE SELECT: JET STREAM ◀ / ▶ MOONLIT BADLANDS.
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 110, 0],
  heading: 25,
  seed: 141,
  step: 150,
  segs: [
    { len: 1500, turn: 0, alt: 110 },
    { len: 2500, turn: 18, alt: 85 },
    { len: 2500, turn: -24, alt: 75 },
    { len: 2400, turn: 20, alt: 80 },
    { len: 2000, turn: -10, alt: 95 },
    { len: 2400, turn: 0, alt: 170 }
  ]
});
const RS = routeSelectAt(L, SPEED);

const terrain = {
  seed: 141,
  profile: 'valley',
  palette: 'glacier',
  sections: [
    { s: 0, floor: 2, depth: 300, width: 420 },
    { s: 1800, floor: 2, depth: 440, width: 280 },
    { s: 5000, floor: 2, depth: 560, width: 220 },
    { s: 9000, floor: 2, depth: 580, width: 210 },
    { s: 12000, floor: 2, depth: 400, width: 300 },
    { s: 16000, floor: 2, depth: 300, width: 420 }
  ],
  centre: { amp: 90, wavelength: 2600, from: 2200, to: 11000, phase: 0.3 },
  water: null,
  snowLine: 0,
  trees: { density: 0.25 },
  obstacles: [
    { s: 6200, l: 0, kind: 'bridge', h: 60 },
    { from: 2400, to: 11000, every: [650, 1100], kinds: ['spire', 'tower'], lat: [-0.8, 0.8] }
  ]
};

export default defineStage({
  id: 'whiteout',
  music: 'stage2',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: SPEED, minAltitude: 18, startS: 150, noRoll: true },
  look: 'whiteout',
  terrain,
  waves: {
    seed: 141,
    rate: { base: 1.85, perStar: 0.12 },
    floor: 3,
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1200, to: RS - 400 }],
    quiet: [[6700, 8100]],
    mix: [['chaserPair', 2], ['overtakeStream', 2], ['overtakeClose', 2.5], ['vHeadOn', 3], ['headOnPass', 2.5], ['pincer', 1.5], ['heloLine', 1], ['crossSweep', 1], ['heavyPair', 1, { minS: 5000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', helo: 'heloCH47' },
    preloadTypes: []
  },
  preloadTypes: ['cruiseMissile'],
  timeline: [
    { at: 500, radio: 'r.whiteout.brief' },
    { at: 1400, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 30 } },
    { at: 3800, spawn: { type: 'stealthB', formation: 'pair', behavior: 'chaser', y: 14 } },
    { at: 6600, radio: 'r.whiteout.cruise' },
    {
      at: 6800,
      cue: 'cruise',
      eo: eo('eo.whiteout', { id: 'whiteout_cruise', count: 4, tags: ['cruise'], timeLimit: 22, bonus: 70000 })
    },
    { at: 9600, spawn: { type: 'fighterA', formation: 'trail5', behavior: 'headOn', y: 15, spread: 0.6 } },
    { at: RS - 400, waves: 'off' }
  ],
  par: { time: 60, combo: 30, downRate: 70, score: 160000 },
  finishDelay: 2.2,
  createLogic: compose(terrainRun(terrain), cruiseMissiles({ count: 4, tag: 'cruise', hold: 15 }), routeSelect({ radio: 'r.whiteout.route' }))
});
