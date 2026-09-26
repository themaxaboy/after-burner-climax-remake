import { compose } from '../common/compose.js';
import { cloudDeck } from '../common/cloudDeck.js';
import { bossFortress } from '../common/bossFortress.js';
import { carrierLanding } from '../common/carrierLanding.js';
import { SKY_BOX, defineStage, eo, makeRail } from './kit.js';

// SKY FORTRESS / FINAL LINE — the final battle in the twilight above the
// clouds: the flying fortress with four engine pods, a slow-motion kill-cam,
// then down through the cloud deck for a trap landing on the carrier.
const { points, segEnds } = makeRail({
  start: [0, 1600, 0],
  heading: 15,
  seed: 91,
  step: 200,
  segs: [
    { len: 1500, turn: 0, alt: 1600 },
    { len: 2500, turn: 14, alt: 1660 },
    { len: 2500, turn: -16, alt: 1600 },
    { len: 1000, turn: 0, alt: 1500 },
    { len: 2600, turn: 0, alt: 500 }, // dive through the cloud deck
    { len: 1300, turn: 0, alt: 190 },
    { len: 3000, turn: 0, alt: 21.7 }, // final approach (~3.2°)
    { len: 300, turn: 0, alt: 21.7 } // roll-out on the deck
  ]
});
const DESCEND = segEnds[3];

export default defineStage({
  id: 'fortress',
  music: 'stage3',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: 245, minAltitude: 12, startS: 150 },
  look: 'fortress',
  waves: {
    seed: 91,
    rate: { base: 1.8, perStar: 0.12 },
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1200, to: DESCEND - 600 }],
    quiet: [],
    mix: [['vHeadOn', 3], ['headOnPass', 2.5], ['heavyPair', 2], ['pincer', 1.5], ['overtakeClose', 2], ['overheadPass', 2], ['swarmPass', 1], ['crossSweep', 1]],
    types: { light: 'fighterA', heavy: 'stealthB' },
    preloadTypes: ['stealthB']
  },
  preloadTypes: ['bomberB52', 'bossPod'],
  timeline: [
    { at: 300, radio: 'r.fortress.brief' },
    { at: 650, radio: 'r.fortress.boss' },
    { at: 800, cue: 'boss' },
    { at: 2400, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', x: -60, y: 50 } },
    { at: 4400, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 40 } },
    { at: DESCEND - 300, cue: 'bossEscape' },
    { at: DESCEND, cue: 'descend' }
  ],
  par: { time: 75, combo: 30, downRate: 70, score: 280000 },
  createLogic: compose(
    cloudDeck(),
    bossFortress({ type: 'bomberB52', y: 55, eo: eo('eo.fortress', { id: 'fortress_boss', bonus: 200000 }), radio: { win: 'r.fortress.win' } }),
    carrierLanding({ approach: 3600, radio: { approach: 'r.fortress.approach' } })
  )
});
