import { LOOKS } from '../../world/looks.js';
import * as oceanMod from '../../world/ocean.js';
import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { eoTally } from '../common/eoTally.js';
import { bankSites } from '../common/bankSites.js';
import { TERRAIN_BOX, defineStage, eo, makeRail } from './kit.js';

// GLACIER FJORD / COLD STEEL — a turquoise river winding between icy walls
// and snowy pines; ice arches and spires force hard dodges. Emergency
// Order: AA sites on the banks (destroy 6 of 8).
const { points, length: L } = makeRail({
  start: [0, 60, 0],
  heading: -10,
  seed: 51,
  step: 150,
  segs: [
    { len: 1300, turn: 0, alt: 60 },
    { len: 2400, turn: -18, alt: 48 },
    { len: 2400, turn: 22, alt: 42 },
    { len: 2400, turn: -20, alt: 45 },
    { len: 2200, turn: 14, alt: 50 },
    { len: 2000, turn: 0, alt: 70 }
  ]
});

const terrain = {
  seed: 51,
  profile: 'valley',
  palette: 'glacier',
  // fjord: the valley floor lies below the water plane (level 0)
  sections: [
    { s: 0, floor: -40, depth: 380, width: 320 },
    { s: 1500, floor: -40, depth: 520, width: 220 },
    { s: 4500, floor: -45, depth: 620, width: 170 },
    { s: 8000, floor: -45, depth: 650, width: 160 },
    { s: 11000, floor: -40, depth: 520, width: 230 },
    { s: 15000, floor: -40, depth: 380, width: 340 }
  ],
  centre: { amp: 70, wavelength: 2400, from: 2000, to: 11000, phase: 1.2 },
  water: { level: 0, preset: 'glacierRiver' },
  snowLine: 180,
  trees: { density: 0.35 },
  obstacles: [
    { s: 5200, l: 0, kind: 'arch', h: 75, w: 130 },
    { s: 8600, l: 0, kind: 'arch', h: 70, w: 120 },
    { from: 2500, to: 10800, every: [500, 900], kinds: ['spire', 'pillar'], lat: [-0.85, 0.85] }
  ]
};

const AA_SITES = [
  { ds: 2400, side: -1, type: 'aaGun' },
  { ds: 2750, side: 1, type: 'aaGun' },
  { ds: 3150, side: -1, type: 'samSite' },
  { ds: 3550, side: 1, type: 'aaGun' },
  { ds: 3950, side: -1, type: 'aaGun' },
  { ds: 4350, side: 1, type: 'samSite' },
  { ds: 4750, side: -1, type: 'aaGun' },
  { ds: 5150, side: 1, type: 'aaGun' }
];

const riverPreset = LOOKS.glacier.ocean || (oceanMod.OCEAN_PRESETS?.glacierRiver ? 'glacierRiver' : 'goldSwell');

export default defineStage({
  id: 'glacier',
  music: 'stage2',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: 240, minAltitude: 14, startS: 150, noRoll: true },
  look: 'glacier',
  env: { ocean: riverPreset }, // the fjord's water is the ocean plane at level 0
  terrain,
  waves: {
    seed: 51,
    rate: { base: 1.3, perStar: 0.12 },
    maxAlive: { high: 18, low: 12 },
    spans: [{ from: 1200, to: L - 600 }],
    quiet: [[3700, 5200]],
    mix: [['groundSites', 2], ['vHeadOn', 3], ['lineHeadOn', 1], ['overtakeClose', 2], ['heloLine', 1], ['rammerSolo', 1], ['chaserPair', 1, { minS: 6000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', helo: 'heloCH47', site: 'samSite', gun: 'aaGun' },
    preloadTypes: []
  },
  preloadTypes: ['aaGun', 'samSite'],
  timeline: [
    { at: 500, radio: 'r.glacier.brief' },
    { at: 1300, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 25 } },
    { at: 3600, radio: 'r.glacier.aa' },
    {
      at: 3800,
      cue: 'aaSites',
      eo: eo('eo.glacier', { id: 'glacier_aa', count: 6, tags: [], timeLimit: 24, bonus: 70000 })
    },
    { at: 8200, radio: 'r.glacier.tight' },
    { at: 9800, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', y: 20 } }
  ],
  par: { time: 58, combo: 25, downRate: 70, score: 120000 },
  createLogic: compose(
    terrainRun(terrain),
    bankSites({ cue: 'aaSites', tag: 'aa', sites: AA_SITES, offset: 100, water: 0 }),
    eoTally({ eo: 'glacier_aa', tag: 'aa', need: 6, total: AA_SITES.length })
  )
});
