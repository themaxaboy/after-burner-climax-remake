import { compose } from '../common/compose.js';
import { routeSelect } from '../common/routeSelect.js';
import { SKY_BOX, defineStage, eo, makeRail, routeSelectAt } from './kit.js';

// MIDNIGHT ARMADA / NIGHT RAID — a moonlit sea, the enemy fleet running dark.
// Emergency Order: sink the three escort destroyers screening the fleet.
// Ends with the ROUTE SELECT: WHITEOUT ◀ / ▶ DUSK RAVINE (bonus STRATOSPHERE
// first when at least 6 Emergency Orders have been cleared).
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 70, 0],
  heading: -10,
  seed: 131,
  step: 200,
  segs: [
    { len: 1500, turn: 0, alt: 70 },
    { len: 2500, turn: -22, alt: 50 },
    { len: 2500, turn: 18, alt: 45 },
    { len: 2500, turn: -12, alt: 60 },
    { len: 2000, turn: 14, alt: 80 },
    { len: 2400, turn: 0, alt: 150 }
  ]
});
const RS = routeSelectAt(L, SPEED);
const SHIP = { type: 'destroyer', behavior: 'static', tag: 'escort' };

export default defineStage({
  id: 'nightfleet',
  music: 'stage1',
  rail: { points, bank: [], box: SKY_BOX, baseSpeed: SPEED, minAltitude: 14, startS: 150 },
  look: 'nightfleet',
  waves: {
    seed: 131,
    rate: { base: 1.85, perStar: 0.12 },
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1200, to: RS - 400 }],
    quiet: [[4400, 5600]],
    mix: [['vHeadOn', 3], ['headOnPass', 2.5], ['boatGroup', 2.5], ['overheadPass', 2], ['underPass', 1.5], ['overtakeClose', 1.5], ['pincer', 1.5], ['crossSweep', 1.5], ['swarmPass', 1], ['heavyPair', 1], ['chaserPair', 1, { minS: 5000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', boat: 'samBoat' },
    preloadTypes: []
  },
  timeline: [
    { at: 500, radio: 'r.nightfleet.brief' },
    { at: 1400, spawn: { type: 'fighterA', formation: 'V5', behavior: 'headOn', y: 25 } },
    { at: 2600, spawn: { type: 'samBoat', formation: 'line3', behavior: 'static', dist: 3000, x: 120, spread: 3 } },
    { at: 4300, radio: 'r.nightfleet.escort' },
    {
      at: 4500,
      eo: eo('eo.nightfleet', {
        id: 'nightfleet_escort',
        timeLimit: 24,
        bonus: 80000,
        spawn: [
          { ...SHIP, dist: 3200, x: -320, heading: 200 },
          { ...SHIP, dist: 3900, x: 360, heading: 160 },
          { ...SHIP, dist: 4600, x: -60, heading: 180 }
        ]
      })
    },
    { at: 8400, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', y: 20 } },
    { at: 9800, spawn: { type: 'samBoat', formation: 'pair', behavior: 'static', dist: 3000, x: -200, spread: 3 } },
    { at: RS - 400, waves: 'off' }
  ],
  par: { time: 60, combo: 30, downRate: 70, score: 160000 },
  finishDelay: 2.2,
  createLogic: compose(routeSelect({ radio: 'r.nightfleet.route' }))
});
