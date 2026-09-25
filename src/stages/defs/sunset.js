import { compose } from '../common/compose.js';
import { refuel } from '../common/refuel.js';
import { SKY_BOX, defineStage, eo, makeRail } from './kit.js';

// SUNSET ARMADA / FLEET ACTION — low over an orange sunset sea against an
// enemy fleet (destroyers, missile boats) with fighter cover. Emergency
// Order: a heavy bomber heading for the carrier group. Ends with an aerial
// refuelling interlude behind the tanker.
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 70, 0],
  heading: 0,
  seed: 31,
  step: 200,
  segs: [
    { len: 1500, turn: 0, alt: 70 },
    { len: 2500, turn: -18, alt: 55 },
    { len: 2500, turn: 24, alt: 45 },
    { len: 2500, turn: -14, alt: 65 },
    { len: 2000, turn: 10, alt: 80 },
    { len: 2400, turn: 0, alt: 110 }
  ]
});
const REFUEL = L - 2350;

export default defineStage({
  id: 'sunset',
  music: 'stage1',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: SPEED, minAltitude: 14, startS: 150 },
  look: 'sunset',
  waves: {
    seed: 31,
    rate: { base: 1.4, perStar: 0.12 },
    maxAlive: { high: 20, low: 14 },
    spans: [{ from: 1200, to: REFUEL - 500 }],
    quiet: [[2400, 3400], [6300, 7300]],
    mix: [['vHeadOn', 3], ['boatGroup', 2], ['overtakeClose', 2], ['crossSweep', 2], ['swarmPass', 1], ['heavyPair', 1], ['rammerPair', 1], ['chaserPair', 1, { minS: 5000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', boat: 'samBoat' },
    preloadTypes: []
  },
  timeline: [
    { at: 500, radio: 'r.sunset.brief' },
    { at: 2300, radio: 'r.sunset.fleet' },
    { at: 2400, spawn: { type: 'destroyer', behavior: 'static', dist: 3500, x: -380, heading: 200 } },
    { at: 2400, spawn: { type: 'destroyer', behavior: 'static', dist: 4300, x: 420, heading: 160 } },
    { at: 2800, spawn: { type: 'samBoat', formation: 'pair', behavior: 'static', dist: 3200, x: 60, spread: 3 } },
    { at: 6200, radio: 'r.sunset.b52' },
    {
      at: 6400,
      eo: eo('eo.sunset', {
        id: 'sunset_b52',
        timeLimit: 24,
        bonus: 80000,
        spawn: { type: 'bomberB52', behavior: 'bomber', tag: 'b52', x: 20, y: 70, params: { y: 70 } }
      })
    },
    { at: 9600, spawn: { type: 'destroyer', behavior: 'static', dist: 3300, x: 300, heading: 170 } },
    { at: 9600, spawn: { type: 'samBoat', formation: 'line3', behavior: 'static', dist: 3000, x: -220, spread: 3 } },
    { at: REFUEL - 450, waves: 'off' },
    { at: REFUEL, cue: 'refuel' }
  ],
  par: { time: 66, combo: 30, downRate: 70, score: 140000 },
  createLogic: compose(refuel({ radio: 'r.sunset.tanker' }))
});
