import { compose } from '../common/compose.js';
import { carrierLaunch } from '../common/carrierLaunch.js';
import { SKY_BOX, defineStage, makeRail } from './kit.js';

// BLUE HORIZON / SORTIE — catapult launch from the carrier, then a low,
// fast run over a deep blue sea: fighter waves and a surface group.
// Starts on the bow catapult at deck height.
const { points, length: L } = makeRail({
  start: [0, 21.7, 21000],
  heading: 0,
  seed: 11,
  step: 200,
  segs: [
    { len: 400, turn: 0, alt: 21.7 },
    { len: 2200, turn: 0, alt: 60 },
    { len: 3000, turn: 24, alt: 85 },
    { len: 3000, turn: -30, alt: 55 },
    { len: 2800, turn: 18, alt: 95 },
    { len: 1600, turn: 0, alt: 120 }
  ]
});

export default defineStage({
  id: 'ocean',
  music: 'stage1',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: 240, minAltitude: 14, startS: 0 },
  look: 'oceanDay',
  waves: {
    seed: 11,
    rate: { base: 1.2, perStar: 0.1 },
    maxAlive: { high: 18, low: 12 },
    spans: [{ from: 1700, to: L - 700 }],
    quiet: [[7500, 8900]],
    mix: [['vHeadOn', 4], ['lineHeadOn', 2], ['overtakeClose', 2], ['crossSweep', 2], ['swarmPass', 1, { minS: 3000 }], ['rammerPair', 1], ['boatGroup', 0.8, { minS: 9000 }]],
    types: { light: 'fighterA', heavy: 'fighterA', boat: 'samBoat' },
    preloadTypes: []
  },
  timeline: [
    { at: 700, radio: 'r.ocean.feetWet' },
    { at: 1500, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 10 } },
    { at: 1650, radio: 'r.ocean.tally' },
    { at: 4200, spawn: { type: 'fighterA', formation: 'pair', behavior: 'overtake', y: 14 } },
    { at: 4250, radio: 'r.ocean.six' },
    { at: 7400, radio: 'r.ocean.ships' },
    { at: 7500, spawn: { type: 'destroyer', behavior: 'static', dist: 3400, x: 360, heading: 180 } },
    { at: 7500, spawn: { type: 'samBoat', behavior: 'static', dist: 2900, x: -240, heading: 170 } },
    { at: 7900, spawn: { type: 'samBoat', behavior: 'static', dist: 3600, x: 120, heading: 190 } },
    { at: 10400, spawn: { type: 'fighterA', formation: 'wall6', behavior: 'headOn', y: 12 } },
    { at: L - 900, radio: 'r.ocean.clear' }
  ],
  par: { time: 62, combo: 25, downRate: 70, score: 90000 },
  createLogic: compose(carrierLaunch({ radio: 'r.ocean.launch', hideAfter: 5000 }))
});
