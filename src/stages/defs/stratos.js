import { compose } from '../common/compose.js';
import { noFire } from '../common/cruiseMissiles.js';
import { cloudDeck } from '../common/cloudDeck.js';
import { SKY_BOX, defineStage, makeRail } from './kit.js';

// STRATOSPHERE / EDGE OF SPACE (bonus) — the top of the sky, stars by day
// and the cloud deck far below: dense formations that never fire back.
// Unlocked when at least 6 Emergency Orders were cleared before the end of
// MIDNIGHT ARMADA.
const { points } = makeRail({
  start: [0, 2200, 0],
  heading: 0,
  seed: 181,
  step: 200,
  segs: [
    { len: 1500, turn: 0, alt: 2200 },
    { len: 3000, turn: -26, alt: 2350 },
    { len: 3000, turn: 22, alt: 2150 },
    { len: 3000, turn: -16, alt: 2300 },
    { len: 1800, turn: 0, alt: 2250 }
  ]
});

export default defineStage({
  id: 'stratos',
  bonus: true,
  music: 'anthem',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: 240, minAltitude: 14, startS: 150 },
  look: 'stratos',
  waves: {
    seed: 181,
    rate: { base: 2.3, perStar: 0 },
    maxAlive: { high: 26, medium: 22, low: 18 },
    spans: [{ from: 800, to: 11800 }],
    quiet: [],
    mix: [['swarmPass', 3], ['vHeadOn', 3], ['headOnPass', 2], ['lineHeadOn', 2], ['pincer', 1.5], ['crossSweep', 2], ['overtakeClose', 2], ['heavyPair', 1.5], ['overheadPass', 2]],
    types: { light: 'fighterA', heavy: 'stealthB' },
    preloadTypes: []
  },
  timeline: [
    { at: 400, radio: 'r.stratos.brief' },
    { at: 1200, spawn: { type: 'stealthB', formation: 'swarm8', behavior: 'headOn', y: 15 } },
    { at: 2300, radio: 'r.stratos.swarm' },
    { at: 3600, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'formation', y: 10 } },
    { at: 6400, spawn: { type: 'stealthB', formation: 'wall6', behavior: 'headOn', y: 5 } },
    { at: 9000, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', x: -40, y: 20 } }
  ],
  par: { time: 55, combo: 60, downRate: 80, score: 180000 },
  createLogic: compose(noFire(), cloudDeck())
});
