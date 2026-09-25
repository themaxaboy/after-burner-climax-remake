import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { routeSelect } from '../common/routeSelect.js';
import { TERRAIN_BOX, defineStage, eo, makeRail, routeSelectAt } from './kit.js';

// RED CANYON / THE GAUNTLET — a red-rock canyon whose corridor swings under
// the jet, stone arches to fly under and pillars to dodge. Emergency Order:
// a heavy bomber running the canyon. The canyon opens at the end into the
// ROUTE SELECT: SUNSET ARMADA ◀ / ▶ GLACIER FJORD.
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 60, 0],
  heading: 20,
  seed: 23,
  step: 150,
  segs: [
    { len: 1200, turn: 0, alt: 60 },
    { len: 2200, turn: 16, alt: 48 },
    { len: 2200, turn: -22, alt: 42 },
    { len: 2200, turn: 20, alt: 40 },
    { len: 2000, turn: -16, alt: 45 },
    { len: 1500, turn: 8, alt: 70 },
    { len: 2400, turn: 0, alt: 150 }
  ]
});
const RS = routeSelectAt(L, SPEED);

const terrain = {
  seed: 23,
  profile: 'canyon',
  palette: 'desertRed',
  sections: [
    { s: 0, floor: 0, depth: 0, width: 400 },
    { s: 900, floor: 0, depth: 60, width: 260 },
    { s: 2000, floor: 0, depth: 240, width: 170 },
    { s: 5000, floor: 0, depth: 280, width: 140 },
    { s: 8000, floor: 0, depth: 300, width: 150 },
    { s: 10200, floor: 0, depth: 240, width: 180 },
    { s: 11400, floor: 0, depth: 60, width: 380 },
    { s: 12500, floor: 0, depth: 0, width: 420 },
    { s: 30000, floor: 0, depth: 0, width: 420 }
  ],
  centre: { amp: 90, wavelength: 2200, from: 2200, to: 10200, phase: 0 },
  water: null,
  obstacles: [
    { s: 3600, l: 0, kind: 'arch', h: 70, w: 120 },
    { s: 6900, l: 0, kind: 'arch', h: 80, w: 130 },
    { s: 9300, l: 0, kind: 'arch', h: 70, w: 120 },
    { from: 2600, to: 10000, every: [420, 780], kinds: ['pillar', 'spire'], lat: [-0.85, 0.85] }
  ]
};

export default defineStage({
  id: 'canyon',
  music: 'stage2',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: SPEED, minAltitude: 12, startS: 150, noRoll: true },
  look: 'canyonRed',
  terrain,
  waves: {
    seed: 23,
    rate: { base: 1.4, perStar: 0.12 },
    maxAlive: { high: 18, low: 12 },
    spans: [{ from: 1200, to: RS - 400 }],
    quiet: [[5300, 6500]],
    mix: [['vHeadOn', 3], ['lineHeadOn', 2], ['overtakeClose', 2], ['rammerSolo', 1], ['rammerPair', 1, { minS: 4000 }], ['crossSweep', 1], ['chaserPair', 1, { minS: 4000 }], ['heavyPair', 1, { minS: 6000 }]],
    types: { light: 'fighterA', heavy: 'stealthB' },
    preloadTypes: []
  },
  timeline: [
    { at: 500, radio: 'r.canyon.brief' },
    { at: 1300, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 30 } },
    { at: 3200, radio: 'r.canyon.arch' },
    { at: 5200, radio: 'r.canyon.xb70' },
    {
      at: 5400,
      eo: eo('eo.canyon', {
        id: 'canyon_xb70',
        timeLimit: 22,
        bonus: 80000,
        spawn: { type: 'bomberXB', behavior: 'bomber', tag: 'xb70', x: 0, y: 110, params: { y: 110 } }
      })
    },
    { at: 8200, spawn: { type: 'fighterA', formation: 'trail5', behavior: 'headOn', y: 10, spread: 0.6 } },
    { at: RS - 400, waves: 'off' }
  ],
  par: { time: 60, combo: 30, downRate: 70, score: 130000 },
  finishDelay: 2.2,
  createLogic: compose(terrainRun(terrain), routeSelect({ radio: 'r.canyon.route' }))
});
