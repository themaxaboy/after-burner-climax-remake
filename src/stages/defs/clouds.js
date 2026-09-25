import { compose } from '../common/compose.js';
import { cloudDeck } from '../common/cloudDeck.js';
import { SKY_BOX, defineStage, eo, makeRail } from './kit.js';

// SEA OF CLOUDS / ACE HIGH — golden twilight above an endless cloud deck:
// stealth fighters and a dogfight with the enemy ace (Emergency Order).
const { points, length: L } = makeRail({
  start: [0, 1600, 0],
  heading: 15,
  seed: 71,
  step: 200,
  segs: [
    { len: 2000, turn: 0, alt: 1600 },
    { len: 3000, turn: 20, alt: 1680 },
    { len: 3000, turn: -24, alt: 1560 },
    { len: 3000, turn: 16, alt: 1650 },
    { len: 2400, turn: 0, alt: 1620 }
  ]
});

export default defineStage({
  id: 'clouds',
  music: 'stage3',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: 245, minAltitude: 12, startS: 150 },
  look: 'clouds',
  waves: {
    seed: 71,
    rate: { base: 1.4, perStar: 0.12 },
    maxAlive: { high: 20, low: 14 },
    spans: [{ from: 1000, to: L - 600 }],
    quiet: [[2600, 4000]],
    mix: [['vHeadOn', 3], ['heavyPair', 2], ['overtakeClose', 2], ['crossSweep', 2], ['swarmPass', 2], ['rammerPair', 1]],
    types: { light: 'fighterA', heavy: 'stealthB' },
    preloadTypes: ['stealthB']
  },
  timeline: [
    { at: 500, radio: 'r.clouds.brief' },
    { at: 1200, spawn: { type: 'stealthB', formation: 'V3', behavior: 'headOn', y: 10 } },
    { at: 2600, radio: 'r.clouds.ace' },
    {
      at: 2800,
      eo: eo('eo.clouds', { id: 'clouds_ace', timeLimit: 40, bonus: 90000, spawn: { type: 'ace', behavior: 'ace', tag: 'ace', y: 20 } })
    },
    { at: 7600, radio: 'r.clouds.stealth' },
    { at: 7700, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', y: 18 } },
    { at: 10600, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', y: 20 } }
  ],
  par: { time: 58, combo: 30, downRate: 70, score: 150000 },
  createLogic: compose(cloudDeck())
});
