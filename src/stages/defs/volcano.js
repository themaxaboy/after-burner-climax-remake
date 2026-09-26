import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { eoTally } from '../common/eoTally.js';
import { bankSites } from '../common/bankSites.js';
import { routeSelect } from '../common/routeSelect.js';
import { TERRAIN_BOX, defineStage, eo, makeRail, routeSelectAt } from './kit.js';

// ASH RIDGE / FIRE MOUNTAIN — a black basalt valley under a red ash sky,
// jagged spires on every bend. Emergency Order: flak sites dug into the
// slopes (destroy 6 of 8). Ends with the ROUTE SELECT:
// SEA OF CLOUDS ◀ / ▶ CANYON STRIKE.
const SPEED = 240;
const { points, length: L } = makeRail({
  start: [0, 90, 0],
  heading: -15,
  seed: 121,
  step: 150,
  segs: [
    { len: 1300, turn: 0, alt: 90 },
    { len: 2400, turn: -20, alt: 70 },
    { len: 2400, turn: 24, alt: 60 },
    { len: 2400, turn: -18, alt: 65 },
    { len: 2000, turn: 12, alt: 80 },
    { len: 2600, turn: 0, alt: 170 }
  ]
});
const RS = routeSelectAt(L, SPEED);

const terrain = {
  seed: 121,
  profile: 'valley',
  palette: 'volcanic',
  sections: [
    { s: 0, floor: 2, depth: 320, width: 380 },
    { s: 1600, floor: 2, depth: 480, width: 240 },
    { s: 4500, floor: 3, depth: 600, width: 180 },
    { s: 8500, floor: 3, depth: 640, width: 170 },
    { s: 11000, floor: 2, depth: 420, width: 280 },
    { s: 13000, floor: 2, depth: 200, width: 420 },
    { s: 30000, floor: 2, depth: 200, width: 420 }
  ],
  centre: { amp: 90, wavelength: 2400, from: 2000, to: 10800, phase: 0.8 },
  water: null,
  snowLine: 9999,
  obstacles: [
    { s: 7400, l: 0, kind: 'arch', h: 75, w: 130 },
    { from: 2200, to: 10600, every: [480, 850], kinds: ['spire', 'pillar'], lat: [-0.85, 0.85] }
  ]
};

const AA_SITES = [
  { ds: 2300, side: 1, type: 'aaGun' },
  { ds: 2700, side: -1, type: 'aaGun' },
  { ds: 3100, side: 1, type: 'samSite' },
  { ds: 3500, side: -1, type: 'aaGun' },
  { ds: 3900, side: 1, type: 'aaGun' },
  { ds: 4300, side: -1, type: 'samSite' },
  { ds: 4700, side: 1, type: 'aaGun' },
  { ds: 5100, side: -1, type: 'aaGun' }
];

export default defineStage({
  id: 'volcano',
  music: 'stage2',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: SPEED, minAltitude: 14, startS: 150, noRoll: true },
  look: 'volcano',
  terrain,
  waves: {
    seed: 121,
    rate: { base: 1.85, perStar: 0.12 },
    maxAlive: { high: 24, medium: 20, low: 16 },
    spans: [{ from: 1200, to: RS - 400 }],
    quiet: [[3500, 5100]],
    mix: [['vHeadOn', 3], ['headOnPass', 2.5], ['lineHeadOn', 1.5], ['pincer', 1.5], ['overtakeClose', 2.5], ['overheadPass', 2], ['groundSites', 1.5], ['rammerSolo', 1], ['chaserPair', 1, { minS: 6000 }], ['heavyPair', 1, { minS: 6000 }]],
    types: { light: 'fighterA', heavy: 'stealthB', site: 'samSite', gun: 'aaGun' },
    preloadTypes: []
  },
  preloadTypes: ['aaGun', 'samSite'],
  timeline: [
    { at: 500, radio: 'r.volcano.brief' },
    { at: 1300, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 30 } },
    { at: 3400, radio: 'r.volcano.aa' },
    {
      at: 3600,
      cue: 'aaSites',
      eo: eo('eo.volcano', { id: 'volcano_aa', count: 6, tags: [], timeLimit: 24, bonus: 70000 })
    },
    { at: 8800, spawn: { type: 'stealthB', formation: 'pair', behavior: 'overtake', y: 20 } },
    { at: RS - 400, waves: 'off' }
  ],
  par: { time: 60, combo: 28, downRate: 70, score: 150000 },
  finishDelay: 2.2,
  createLogic: compose(
    terrainRun(terrain),
    bankSites({ cue: 'aaSites', tag: 'aa', sites: AA_SITES, offset: 100, water: null }),
    eoTally({ eo: 'volcano_aa', tag: 'aa', need: 6, total: AA_SITES.length }),
    routeSelect({ radio: 'r.volcano.route' })
  )
});
