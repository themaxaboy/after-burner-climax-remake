import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { routeSelect } from '../common/routeSelect.js';
import { cruiseMissiles } from '../common/cruiseMissiles.js';
import { TERRAIN_BOX, defineStage, eo, makeRail, routeSelectAt } from './kit.js';

// GOLDEN DUNES / SANDSTORM PURSUIT — low over bright yellow dunes, chased:
// fighters sit on your six and loose missiles from behind. Emergency Order:
// three cruise missiles that can only be stopped with the gun. Ends with the
// ROUTE SELECT: SEA OF CLOUDS ◀ / ▶ CANYON STRIKE (bonus AURORA first when
// at least 3 Emergency Orders have been cleared).
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 55, 0],
  heading: 35,
  seed: 61,
  step: 150,
  segs: [
    { len: 1500, turn: 0, alt: 55 },
    { len: 2500, turn: 16, alt: 45 },
    { len: 2500, turn: -20, alt: 40 },
    { len: 2500, turn: 18, alt: 50 },
    { len: 2000, turn: -10, alt: 60 },
    { len: 2400, turn: 0, alt: 150 }
  ]
});
const RS = routeSelectAt(L, SPEED);

const terrain = {
  seed: 61,
  profile: 'dunes',
  palette: 'dunes',
  // dunes: depth = dune amplitude, width = soft corridor half-width between the big dunes
  sections: [
    { s: 0, floor: 0, depth: 24, width: 200 },
    { s: 2500, floor: 0, depth: 38, width: 150 },
    { s: 7000, floor: 0, depth: 48, width: 120 },
    { s: 11000, floor: 0, depth: 34, width: 160 },
    { s: 16000, floor: 0, depth: 20, width: 260 }
  ],
  centre: { amp: 100, wavelength: 2400, from: 1800, to: 10800, phase: 0.4 },
  water: null,
  obstacles: [{ from: 2000, to: 10500, every: [550, 950], kinds: ['spire', 'pillar', 'tower'], lat: [-0.85, 0.85] }]
};

export default defineStage({
  id: 'dunes',
  music: 'stage2',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: SPEED, minAltitude: 12, startS: 150, noRoll: true },
  look: 'dunes',
  terrain,
  waves: {
    seed: 61,
    rate: { base: 1.5, perStar: 0.12 },
    maxAlive: { high: 20, low: 14 },
    spans: [{ from: 1200, to: RS - 400 }],
    quiet: [[5900, 7300]],
    mix: [['chaserPair', 3], ['overtakeClose', 3], ['vHeadOn', 2], ['rammerPair', 1], ['crossSweep', 1], ['heavyPair', 1, { minS: 5000 }]],
    types: { light: 'fighterA', heavy: 'stealthB' },
    preloadTypes: []
  },
  preloadTypes: ['cruiseMissile'],
  timeline: [
    { at: 500, radio: 'r.dunes.brief' },
    { at: 1500, spawn: { type: 'fighterA', formation: 'pair', behavior: 'chaser', y: 10 } },
    { at: 1650, radio: 'r.dunes.six' },
    { at: 4200, spawn: { type: 'stealthB', formation: 'pair', behavior: 'chaser', y: 14 } },
    { at: 5800, radio: 'r.dunes.cruise' },
    {
      at: 6000,
      cue: 'cruise',
      eo: eo('eo.dunes', { id: 'dunes_cruise', count: 3, tags: ['cruise'], timeLimit: 20, bonus: 60000 })
    },
    { at: 8800, spawn: { type: 'fighterA', formation: 'V3', behavior: 'chaser', y: 6 } },
    { at: RS - 400, waves: 'off' }
  ],
  par: { time: 60, combo: 30, downRate: 70, score: 130000 },
  finishDelay: 2.2,
  createLogic: compose(terrainRun(terrain), cruiseMissiles({ count: 3, tag: 'cruise', hold: 14 }), routeSelect({ radio: 'r.dunes.route' }))
});
