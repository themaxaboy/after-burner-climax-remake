import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { eoTally } from '../common/eoTally.js';
import { TERRAIN_BOX, defineStage, eo, makeRail } from './kit.js';

// EMERALD PEAKS / HIGHLANDS — a green mountain valley with snow caps; the
// valley swings under the jet. Emergency Order: stop a troop airlift
// (down 8 of 10 transport helicopters).
const { points, length: L } = makeRail({
  start: [0, 130, 0],
  heading: 0,
  seed: 42,
  step: 150,
  segs: [
    { len: 1500, turn: 0, alt: 130 },
    { len: 2500, turn: 20, alt: 100 },
    { len: 2500, turn: -26, alt: 85 },
    { len: 2500, turn: 22, alt: 95 },
    { len: 2200, turn: -14, alt: 110 },
    { len: 2000, turn: 0, alt: 140 }
  ]
});

const HELO = { type: 'heloCH47', behavior: 'hover', tag: 'helos' };

const terrain = {
  seed: 42,
  profile: 'valley',
  palette: 'emerald',
  // valley: width = floor half-width, depth = peak height above the floor
  sections: [
    { s: 0, floor: 2, depth: 300, width: 420 },
    { s: 1800, floor: 2, depth: 420, width: 260 },
    { s: 5000, floor: 2, depth: 540, width: 190 },
    { s: 9000, floor: 3, depth: 600, width: 170 },
    { s: 12000, floor: 2, depth: 460, width: 240 },
    { s: 16000, floor: 2, depth: 320, width: 380 }
  ],
  centre: { amp: 100, wavelength: 2600, from: 2200, to: 11500, phase: 0 },
  // a turquoise river along the valley floor (the ocean plane fills the channel)
  river: { depth: 8, width: 0.34 },
  water: { level: 0, preset: 'glacierRiver' },
  snowLine: 260,
  trees: { density: 0.6 },
  obstacles: [
    { s: 8200, l: 0, kind: 'bridge', h: 55 },
    { from: 2500, to: 11000, every: [700, 1200], kinds: ['spire', 'tower'], lat: [-0.8, 0.8] }
  ]
};

export default defineStage({
  id: 'emerald',
  music: 'stage1',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: 240, minAltitude: 18, startS: 150, noRoll: true },
  look: 'emerald',
  terrain,
  waves: {
    seed: 42,
    rate: { base: 1.3, perStar: 0.12 },
    maxAlive: { high: 18, low: 12 },
    spans: [{ from: 1200, to: L - 600 }],
    quiet: [[4300, 7600]],
    mix: [['heloLine', 2], ['vHeadOn', 3], ['crossSweep', 2], ['overtakeClose', 2], ['rammerSolo', 1], ['groundSites', 1, { minS: 3000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', helo: 'heloCH47', site: 'samSite', gun: 'aaGun' },
    preloadTypes: ['heloCH47']
  },
  timeline: [
    { at: 600, radio: 'r.emerald.brief' },
    { at: 1400, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 30 } },
    { at: 2800, spawn: { type: 'heloCH47', behavior: 'hover', formation: 'line3', dist: 2400, y: -30, spread: 1.4 } },
    { at: 4400, radio: 'r.emerald.helos' },
    {
      at: 4600,
      eo: eo('eo.emerald', {
        id: 'emerald_helos',
        count: 8,
        tags: [], // counted by eoTally (8 of 10)
        timeLimit: 24,
        bonus: 60000,
        spawn: [
          { ...HELO, formation: 'line3', dist: 2300, x: -60, y: -45, spread: 1.4 },
          { ...HELO, formation: 'line3', dist: 3000, x: 70, y: -35, spread: 1.4 },
          { ...HELO, formation: 'pair', dist: 3700, x: -20, y: -25, spread: 2 },
          { ...HELO, formation: 'pair', dist: 4300, x: 40, y: -40, spread: 2 }
        ]
      })
    },
    { at: 8600, radio: 'r.emerald.fighters' },
    { at: 8700, spawn: { type: 'fighterA', formation: 'wall6', behavior: 'headOn', y: 20 } },
    { at: 11000, radio: 'r.emerald.ridge' }
  ],
  par: { time: 58, combo: 25, downRate: 70, score: 110000 },
  createLogic: compose(terrainRun(terrain), eoTally({ eo: 'emerald_helos', tag: 'helos', need: 8, total: 10 }))
});
