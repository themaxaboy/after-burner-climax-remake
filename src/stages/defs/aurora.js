import { compose } from '../common/compose.js';
import { noFire } from '../common/cruiseMissiles.js';
import { SKY_BOX, defineStage, makeRail } from './kit.js';

// AURORA / SECRET SORTIE (bonus) — night flight over a dark icy sea under
// the aurora: dense swarms of enemies that never fire back. Unlocked when
// at least 2 Emergency Orders were cleared before the end of GOLDEN DUNES.
const { points, length: L } = makeRail({
  start: [0, 90, 0],
  heading: 0,
  seed: 101,
  step: 200,
  segs: [
    { len: 1500, turn: 0, alt: 90 },
    { len: 3000, turn: 24, alt: 70 },
    { len: 3000, turn: -28, alt: 110 },
    { len: 3000, turn: 18, alt: 80 },
    { len: 1800, turn: 0, alt: 120 }
  ]
});

export default defineStage({
  id: 'aurora',
  bonus: true,
  music: 'anthem',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: 240, minAltitude: 14, startS: 150 },
  look: 'aurora',
  waves: {
    seed: 101,
    rate: { base: 2.2, perStar: 0 },
    maxAlive: { high: 26, medium: 22, low: 18 },
    spans: [{ from: 800, to: L - 500 }],
    quiet: [],
    mix: [['swarmPass', 3], ['vHeadOn', 3], ['headOnPass', 2], ['lineHeadOn', 2], ['pincer', 1.5], ['crossSweep', 2], ['overtakeClose', 2], ['overheadPass', 2]],
    types: { light: 'fighterA', heavy: 'fighterA' },
    preloadTypes: []
  },
  timeline: [
    { at: 400, radio: 'r.aurora.brief' },
    { at: 1200, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', y: 15 } },
    { at: 2300, radio: 'r.aurora.swarm' },
    { at: 3600, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'formation', y: 10 } },
    { at: 6400, spawn: { type: 'fighterA', formation: 'wall6', behavior: 'headOn', y: 5 } },
    { at: 9000, spawn: { type: 'fighterA', formation: 'swarm8', behavior: 'headOn', x: 40, y: 20 } }
  ],
  par: { time: 55, combo: 60, downRate: 80, score: 150000 },
  createLogic: compose(noFire())
});
