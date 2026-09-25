import { compose } from '../common/compose.js';
import { terrainRun } from '../common/terrainRun.js';
import { radarCeiling } from '../common/radarCeiling.js';
import { strikeRun } from '../common/strikeRun.js';
import { TERRAIN_BOX, defineStage, eo, makeRail } from './kit.js';

// CANYON STRIKE / UNDER THE RADAR — a low-level canyon run under a radar
// ceiling (climb above it and the rim SAMs light you up) against a
// time-to-target clock, then pop up, dive onto the fortified target in the
// basin with the sight in slow motion, and pull out hard through a SAM volley.
const { points, segEnds } = makeRail({
  start: [0, 60, 0],
  heading: -20,
  seed: 81,
  step: 150,
  segs: [
    { len: 1200, turn: 0, alt: 60 },
    { len: 2000, turn: 14, alt: 42 },
    { len: 1800, turn: -18, alt: 32 },
    { len: 1800, turn: 16, alt: 28 },
    { len: 1600, turn: -12, alt: 32 },
    { len: 800, turn: 0, alt: 44 },
    { len: 1300, turn: 0, alt: 380 }, // pop-up
    { len: 1000, turn: 0, alt: 70 }, // dive onto the target
    { len: 450, turn: 0, alt: 55 }, // over the target
    { len: 1500, turn: 0, alt: 620 }, // high-G pull-out through the SAMs
    { len: 1200, turn: 8, alt: 700 } // egress
  ]
});
const POPUP = segEnds[5];
const TARGET_S = segEnds[7] + 200; // centre of the low pass over the basin (re-timed in strikeRun.init)
const CANYON_END = POPUP - 400;

const terrain = {
  seed: 81,
  profile: 'canyon',
  palette: 'desertRed',
  sections: [
    { s: 0, floor: 0, depth: 0, width: 400 },
    { s: 800, floor: 0, depth: 80, width: 240 },
    { s: 1600, floor: -6, depth: 240, width: 150 },
    { s: 4000, floor: -10, depth: 270, width: 125 },
    { s: 6500, floor: -12, depth: 280, width: 135 },
    { s: CANYON_END - 300, floor: -8, depth: 240, width: 160 },
    { s: POPUP + 300, floor: -2, depth: 80, width: 300 },
    { s: POPUP + 1200, floor: 0, depth: 0, width: 420 },
    { s: 40000, floor: 0, depth: 0, width: 420 }
  ],
  centre: { amp: 70, wavelength: 2400, from: 2000, to: CANYON_END - 600, phase: 0.6 },
  water: null,
  obstacles: [
    { s: 4400, l: 0, kind: 'arch', h: 65, w: 110 },
    { s: 7000, l: 0, kind: 'arch', h: 65, w: 110 },
    { from: 2400, to: CANYON_END - 800, every: [550, 950], kinds: ['pillar'], lat: [-0.8, 0.8] }
  ]
};

export default defineStage({
  id: 'strike',
  music: 'stage2',
  rail: { points, bank: [], box: TERRAIN_BOX, baseSpeed: 240, minAltitude: 10, startS: 150, noRoll: true },
  look: 'strike',
  terrain,
  waves: {
    seed: 81,
    rate: { base: 1.3, perStar: 0.12 },
    maxAlive: { high: 16, low: 12 },
    spans: [{ from: 1300, to: CANYON_END }],
    quiet: [],
    mix: [['vHeadOn', 3], ['lineHeadOn', 2], ['overtakeClose', 2], ['groundSites', 2], ['rammerSolo', 1]],
    types: { light: 'fighterA', heavy: 'stealthB', site: 'samSite', gun: 'aaGun' },
    preloadTypes: []
  },
  preloadTypes: ['target', 'samSite'],
  timeline: [
    { at: 400, radio: 'r.strike.brief' },
    { at: 1000, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 20 } },
    { at: 3000, spawn: { type: 'heloCH47', formation: 'pair', behavior: 'hover', dist: 2400, y: 10, spread: 0.8 } },
    { at: 6000, spawn: { type: 'fighterA', formation: 'pair', behavior: 'strafe', params: { side: 1 } } },
    { at: POPUP - 50, cue: 'popup' },
    { at: POPUP, radio: 'r.strike.popup' },
    { at: POPUP + 400, spawn: { type: 'samSite', behavior: 'static', dist: 3000, x: -380, countable: false } },
    { at: POPUP + 400, spawn: { type: 'samSite', behavior: 'static', dist: 3200, x: 420, countable: false } },
    // re-timed around the real bottom of the dive by strikeRun
    { at: TARGET_S - 2050, cue: 'strikeTarget' },
    { at: TARGET_S - 1200, cue: 'strike' },
    { at: TARGET_S + 80, cue: 'pullup' },
    { at: segEnds[9] + 300, spawn: { type: 'fighterA', formation: 'V3', behavior: 'headOn', y: 20 } }
  ],
  par: { time: 64, combo: 25, downRate: 65, score: 150000 },
  createLogic: compose(
    terrainRun(terrain),
    radarCeiling({ from: 1700, to: CANYON_END, agl: 95, radio: 'r.strike.ceiling' }),
    strikeRun({
      targetS: TARGET_S,
      clockFrom: 1500,
      time: 50,
      eo: eo('eo.strike', { id: 'strike_target', bonus: 100000 }),
      radio: { hit: 'r.strike.hit', sams: 'r.strike.sams' }
    })
  )
});
