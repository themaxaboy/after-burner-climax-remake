import { compose } from '../common/compose.js';
import { routeSelect } from '../common/routeSelect.js';
import { SKY_BOX, defineStage, eo, makeRail, routeSelectAt } from './kit.js';

// THUNDERHEAD / STORM FRONT — low over a dark, wind-torn sea under a wall of
// storm cloud. Emergency Order: a heavy bomber using the storm as cover.
// Ends with the ROUTE SELECT: SEA OF CLOUDS ◀ / ▶ CANYON STRIKE.
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 80, 0],
  heading: 10,
  seed: 111,
  step: 200,
  segs: [
    { len: 1500, turn: 0, alt: 80 },
    { len: 2500, turn: 20, alt: 60 },
    { len: 2500, turn: -26, alt: 50 },
    { len: 2500, turn: 16, alt: 70 },
    { len: 2000, turn: -8, alt: 90 },
    { len: 2400, turn: 0, alt: 160 }
  ]
});
const RS = routeSelectAt(L, SPEED);

export default defineStage({
  id: 'storm',
  music: 'stage2',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: SPEED, minAltitude: 14, startS: 150 },
  look: 'storm',
  waves: {
    seed: 111,
    rate: { base: 1.85, perStar: 0.12 },
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1100, to: RS - 400 }],
    quiet: [[5000, 6200]],
    mix: [['vHeadOn', 3], ['headOnPass', 2.5], ['overheadPass', 2.5], ['underPass', 2], ['crossSweep', 1.5], ['pincer', 1.5], ['boatGroup', 1], ['overtakeClose', 1.5], ['heavyPair', 1], ['rammerPair', 1, { minS: 3000 }], ['chaserPair', 1, { minS: 6000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', boat: 'samBoat' },
    preloadTypes: []
  },
  timeline: [
    { at: 500, radio: 'r.storm.brief' },
    { at: 1300, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 20 } },
    { at: 3200, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', y: 15 } },
    { at: 4800, radio: 'r.storm.b52' },
    {
      at: 5000,
      eo: eo('eo.storm', {
        id: 'storm_b52',
        timeLimit: 24,
        bonus: 80000,
        spawn: { type: 'bomberB52', behavior: 'bomber', tag: 'b52', x: -30, y: 80, params: { y: 80 } }
      })
    },
    { at: 8600, spawn: { type: 'fighterA', formation: 'wall6', behavior: 'headOn', y: 10 } },
    { at: RS - 400, waves: 'off' }
  ],
  par: { time: 60, combo: 30, downRate: 70, score: 150000 },
  finishDelay: 2.2,
  createLogic: compose(routeSelect({ radio: 'r.storm.route' }))
});
