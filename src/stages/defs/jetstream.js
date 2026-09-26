import { compose } from '../common/compose.js';
import { cloudDeck } from '../common/cloudDeck.js';
import { SKY_BOX, defineStage, eo, makeRail } from './kit.js';

// JET STREAM / HIGH ALTITUDE — pink dawn high above the cloud deck; stealth
// fighters and a pair of enemy aces (Emergency Order).
const { points } = makeRail({
  start: [0, 1650, 0],
  heading: -20,
  seed: 161,
  step: 200,
  segs: [
    { len: 2000, turn: 0, alt: 1650 },
    { len: 3000, turn: -22, alt: 1720 },
    { len: 3000, turn: 26, alt: 1600 },
    { len: 3000, turn: -14, alt: 1680 },
    { len: 2400, turn: 0, alt: 1660 }
  ]
});

export default defineStage({
  id: 'jetstream',
  music: 'stage3',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: 245, minAltitude: 12, startS: 150 },
  look: 'jetstream',
  waves: {
    seed: 161,
    rate: { base: 1.9, perStar: 0.12 },
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1000, to: 12800 }],
    quiet: [[2600, 4400]],
    mix: [['vHeadOn', 3], ['headOnPass', 2.5], ['heavyPair', 2], ['overheadPass', 2.5], ['underPass', 2], ['overtakeClose', 1.5], ['pincer', 2], ['crossSweep', 1.5], ['swarmPass', 1.5], ['rammerPair', 1]],
    types: { light: 'fighterA', heavy: 'stealthB' },
    preloadTypes: ['stealthB']
  },
  timeline: [
    { at: 500, radio: 'r.jetstream.brief' },
    { at: 1200, spawn: { type: 'stealthB', formation: 'V3', behavior: 'headOn', y: 10 } },
    { at: 2600, radio: 'r.jetstream.aces' },
    {
      at: 2800,
      eo: eo('eo.jetstream', { id: 'jetstream_aces', timeLimit: 45, bonus: 110000, spawn: { type: 'ace', formation: 'pair', behavior: 'ace', tag: 'ace', y: 20 } })
    },
    { at: 8000, spawn: { type: 'stealthB', formation: 'V5', behavior: 'headOn', y: 15 } },
    { at: 10800, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', y: 20 } }
  ],
  par: { time: 58, combo: 30, downRate: 70, score: 170000 },
  createLogic: compose(cloudDeck())
});
