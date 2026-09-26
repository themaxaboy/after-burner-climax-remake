import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { radarCeiling } from '../common/radarCeiling.js';
import { routeSelect } from '../common/routeSelect.js';
import { TERRAIN_BOX, defineStage, eo, makeRail, routeSelectAt } from './kit.js';

// DUSK RAVINE / KNIFE EDGE — the narrowest canyon on the route under a
// magenta dusk, with a radar ceiling over the rims. Emergency Order: a heavy
// bomber slipping down the ravine. Ends with the ROUTE SELECT:
// JET STREAM ◀ / ▶ MOONLIT BADLANDS.
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 60, 0],
  heading: -25,
  seed: 151,
  step: 150,
  segs: [
    { len: 1200, turn: 0, alt: 60 },
    { len: 2200, turn: -18, alt: 45 },
    { len: 2200, turn: 22, alt: 38 },
    { len: 2200, turn: -20, alt: 36 },
    { len: 2000, turn: 14, alt: 42 },
    { len: 1500, turn: -6, alt: 70 },
    { len: 2400, turn: 0, alt: 150 }
  ]
});
const RS = routeSelectAt(L, SPEED);

const terrain = {
  seed: 151,
  profile: 'canyon',
  palette: 'desertRed',
  sections: [
    { s: 0, floor: 0, depth: 0, width: 400 },
    { s: 900, floor: 0, depth: 80, width: 240 },
    { s: 2000, floor: 0, depth: 260, width: 140 },
    { s: 5000, floor: 0, depth: 300, width: 120 },
    { s: 8000, floor: 0, depth: 300, width: 125 },
    { s: 10200, floor: 0, depth: 240, width: 170 },
    { s: 11400, floor: 0, depth: 60, width: 380 },
    { s: 12500, floor: 0, depth: 0, width: 420 },
    { s: 30000, floor: 0, depth: 0, width: 420 }
  ],
  centre: { amp: 80, wavelength: 2000, from: 2200, to: 10200, phase: 1.1 },
  water: null,
  obstacles: [
    { s: 3000, l: 0, kind: 'arch', h: 65, w: 110 },
    { s: 5800, l: 0, kind: 'arch', h: 70, w: 110 },
    { s: 8600, l: 0, kind: 'arch', h: 65, w: 110 },
    { from: 2400, to: 10000, every: [500, 850], kinds: ['pillar', 'spire'], lat: [-0.8, 0.8] }
  ]
};

export default defineStage({
  id: 'ravine',
  music: 'stage2',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: SPEED, minAltitude: 10, startS: 150, noRoll: true },
  look: 'ravine',
  terrain,
  waves: {
    seed: 151,
    rate: { base: 1.85, perStar: 0.12 },
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1200, to: RS - 400 }],
    quiet: [[4600, 5900]],
    mix: [['vHeadOn', 3], ['headOnPass', 2.5], ['lineHeadOn', 1.5], ['pincer', 1.5], ['overtakeClose', 2.5], ['overheadPass', 2], ['rammerSolo', 1], ['rammerPair', 1, { minS: 4000 }], ['chaserPair', 1, { minS: 4000 }], ['heavyPair', 1, { minS: 6000 }]],
    types: { light: 'fighterA', heavy: 'stealthB' },
    preloadTypes: []
  },
  timeline: [
    { at: 500, radio: 'r.ravine.brief' },
    { at: 1300, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 25 } },
    { at: 4500, radio: 'r.ravine.bomber' },
    {
      at: 4700,
      eo: eo('eo.ravine', {
        id: 'ravine_bomber',
        timeLimit: 22,
        bonus: 90000,
        spawn: { type: 'bomberXB', behavior: 'bomber', tag: 'xb', x: 0, y: 100, params: { y: 100 } }
      })
    },
    { at: 8400, spawn: { type: 'fighterA', formation: 'trail5', behavior: 'headOn', y: 10, spread: 0.6 } },
    { at: RS - 400, waves: 'off' }
  ],
  par: { time: 60, combo: 28, downRate: 68, score: 160000 },
  finishDelay: 2.2,
  createLogic: compose(
    terrainRun(terrain),
    radarCeiling({ from: 1800, to: 10000, agl: 110, radio: 'r.ravine.ceiling' }),
    routeSelect({ radio: 'r.ravine.route' })
  )
});
