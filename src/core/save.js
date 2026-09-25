// Versioned localStorage persistence for settings and progress.
const KEY = 'abc-remake';
const VERSION = 2;

export const DEFAULT_SETTINGS = {
  version: VERSION,
  quality: null, // null = auto-detect
  fpsCap: 0, // 0 = uncapped (display refresh)
  invertY: false,
  assist: 2, // 0 off, 1 low, 2 high
  autoFire: true,
  missileMode: 'tap', // 'tap' | 'paint'
  mouseFlight: false,
  tilt: false,
  lang: 'en',
  volMaster: 0.9,
  volSfx: 0.9,
  volMusic: 0.7,
  volVoice: 0.9,
  speech: false,
  reducedFlashing: false,
  colorblindReticle: false,
  shake: 1,
  jet: 'fa18e',
  scheme: 'standard'
};

export const DEFAULT_PROGRESS = {
  version: VERSION,
  highScores: [],
  stagesCleared: {},
  eoCleared: {},
  bestRank: {},
  plays: 0,
  missilesFired: 0,
  climaxUsed: 0
};

function storage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    return s;
  } catch {
    return null;
  }
}

/** Migrate older save blobs forward. Pure; exported for tests. */
export function migrate(data, defaults) {
  if (!data || typeof data !== 'object') return { ...defaults };
  const out = { ...defaults, ...data };
  if ((data.version || 1) < 2) {
    // v1 stored assist as boolean
    if (typeof data.assist === 'boolean') out.assist = data.assist ? 2 : 0;
  }
  out.version = VERSION;
  return out;
}

function read(sub, defaults) {
  const s = storage();
  if (!s) return { ...defaults };
  try {
    const raw = s.getItem(`${KEY}:${sub}`);
    return migrate(raw ? JSON.parse(raw) : null, defaults);
  } catch {
    return { ...defaults };
  }
}

function write(sub, value) {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(`${KEY}:${sub}`, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export const loadSettings = () => read('settings', DEFAULT_SETTINGS);
export const saveSettings = (v) => write('settings', v);
export const loadProgress = () => read('progress', DEFAULT_PROGRESS);
export const saveProgress = (v) => write('progress', v);
