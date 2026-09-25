// "Arcade vivid" colour check (headless Chromium, SwiftShader WebGL2).
// Renders stages and `?look=` previews at t≈10 s with the HUD hidden, reads the
// GL canvas right after a frame is drawn and computes HSV statistics:
//   sat   mean HSV saturation          V     mean HSV value (brightness)
//   p5V   5th-percentile value (crushed blacks show up here)
//   band  % of pixels that are saturated (S ≥ 0.3, V ≥ 0.2) and inside the
//         look's dominant hue band (blue ocean, green valley, red canyon…)
// Writes tests/e2e/out/vivid-report.json. With --refs <dir> the same statistics
// are computed on reference JPG crops (calibration). With --shots <dir> the
// captured frames are saved as PNG.
// Usage: node tests/e2e/vivid.mjs [baseUrl] [--cases stages|looks|all] [--size 640x360]
//                                 [--quality medium] [--refs dir] [--shots dir] [--label name] [--no-fail]
//                                 [--only stage1,look-dunes]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';

const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const base = argv.find((a) => /^https?:/.test(a)) || 'http://localhost:5181/';
const which = opt('cases', 'all');
const [vw, vh] = opt('size', '640x360').split('x').map(Number);
const quality = opt('quality', 'medium');
const refsDir = opt('refs', null);
const shotsDir = opt('shots', null);
const label = opt('label', 'current');
const noFail = argv.includes('--no-fail');
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');

// Dominant hue bands in degrees (wrapping allowed: [340, 30]).
const BANDS = {
  blue: [185, 235], green: [65, 165], red: [345, 32], orange: [12, 45], turquoise: [160, 200],
  yellow: [35, 62], golden: [25, 55], teal: [150, 195]
};
const LOOK_BAND = {
  oceanDay: 'blue', emerald: 'green', canyonRed: 'red', sunset: 'orange', glacier: 'turquoise', dunes: 'yellow',
  clouds: 'golden', fortress: 'golden', strike: 'red', aurora: 'teal', title: 'blue', hangar: 'blue'
};
// Thresholds. Reference frames of the original (see --refs) score: blue ocean
// sat 0.40–0.49 / V 0.72–0.82 / p5V 0.25–0.49; red canyon sat 0.31 / V 0.50;
// golden twilight sat 0.28–0.31 / V 0.71–0.77; dunes V 0.84. The global minimum
// is the task target; hazy golden and red looks get the reference-calibrated
// saturation floor, the night look may be dark.
const MIN = { sat: 0.33, V: 0.5, p5V: 0.08 };
const LOOK_LIMITS = {
  aurora: { V: 0.2, p5V: 0.02 },
  clouds: { sat: 0.25, V: 0.42 },
  fortress: { sat: 0.25, V: 0.42 },
  canyonRed: { sat: 0.3 },
  strike: { sat: 0.3 }
};

const STAGE_CASES = [
  { name: 'stage1', q: { stage: '1' }, band: 'blue' },
  { name: 'stage2', q: { stage: '2' }, band: 'red', look: 'canyonRed' },
  { name: 'stage3', q: { stage: '3' }, band: 'golden', look: 'clouds' }
];
const LOOK_CASES = [
  ['1', 'oceanDay'], ['2', 'emerald'], ['2', 'canyonRed'], ['1', 'sunset'], ['2', 'glacier'],
  ['2', 'dunes'], ['3', 'clouds'], ['3', 'fortress'], ['2', 'strike'], ['1', 'aurora'], ['1', 'title'], ['1', 'hangar']
].map(([stage, look]) => ({ name: `look-${look}`, q: { stage, look }, band: LOOK_BAND[look], look }));

const REF_CASES = [
  { name: 'ref-ocean-maxres', file: 'maxresdefault.jpg', crop: [0, 0, 1280, 720], band: 'blue' },
  { name: 'ref-ocean-engage', file: 'sheet.jpg', crop: [0, 290, 320, 160], band: 'blue' },
  { name: 'ref-ocean-engage2', file: 'sheet.jpg', crop: [640, 290, 320, 160], band: 'blue' },
  { name: 'ref-ocean-sun', file: '../vid/picks.jpg', crop: [0, 810, 480, 270], band: 'blue' },
  { name: 'ref-sunset', file: 'sheet.jpg', crop: [1280, 30, 320, 180], band: 'orange' },
  { name: 'ref-canyon', file: '../vid/picks.jpg', crop: [480, 810, 480, 270], band: 'red' },
  { name: 'ref-dunes', file: '../vid/picks.jpg', crop: [480, 270, 480, 270], band: 'yellow' },
  { name: 'ref-desert-dusk', file: '../vid/picks.jpg', crop: [0, 0, 480, 270], band: 'golden' },
  { name: 'ref-fjord', file: '../vid/picks.jpg', crop: [960, 540, 480, 270], band: 'green' },
  { name: 'ref-twilight', file: '../vid/picks.jpg', crop: [960, 810, 480, 270], band: 'golden' }
];

// In-page statistics over an RGBA8 buffer (sRGB).
function statsFn(data, band) {
  const n = data.length >> 2;
  const vs = new Float32Array(n);
  let sSum = 0, vSum = 0, inBand = 0;
  const [h0, h1] = band || [0, 0];
  for (let i = 0, k = 0; i < data.length; i += 4, k++) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx > 0 ? (mx - mn) / mx : 0;
    sSum += s;
    vSum += mx;
    vs[k] = mx;
    if (band && s >= 0.3 && mx >= 0.2) {
      const d = mx - mn;
      let h = 0;
      if (d > 0) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
      }
      if (h0 <= h1 ? h >= h0 && h <= h1 : h >= h0 || h <= h1) inBand++;
    }
  }
  vs.sort();
  return { sat: sSum / n, V: vSum / n, p5V: vs[Math.floor(n * 0.05)], band: (inBand / n) * 100 };
}

const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const results = [];
let failed = 0;

if (refsDir) {
  const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  await page.setContent('<html><body></body></html>');
  for (const c of REF_CASES) {
    const path = join(refsDir, c.file);
    if (!existsSync(path)) continue;
    const b64 = readFileSync(path).toString('base64');
    const st = await page.evaluate(
      async ({ b64, crop, band, fn }) => {
        const img = new Image();
        img.src = `data:image/jpeg;base64,${b64}`;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = 320;
        cv.height = 180;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, 320, 180);
        const stats = new Function(`return (${fn})`)();
        return stats(ctx.getImageData(0, 0, 320, 180).data, band);
      },
      { b64, crop: c.crop, band: BANDS[c.band], fn: statsFn.toString() }
    );
    const r = { name: c.name, kind: 'ref', bandName: c.band, ...round(st) };
    results.push(r);
    console.log(`REF  ${c.name.padEnd(20)} sat ${r.sat}  V ${r.V}  p5V ${r.p5V}  ${c.band} ${r.band}%`);
  }
  await page.close();
}

const only = opt('only', '') ? opt('only', '').split(',') : null;
const cases = (which === 'stages' ? STAGE_CASES : which === 'looks' ? LOOK_CASES : which === 'none' ? [] : [...STAGE_CASES, ...LOOK_CASES]).filter(
  (c) => !only || only.includes(c.name)
);
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
for (const c of cases) {
  const q = new URLSearchParams({ quality, fixed: '1', autopilot: '1', god: '1', skipintro: '1', t: '10', frames: '24', mute: '1', ...c.q });
  const url = `${base}?${q}`;
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const t0 = Date.now();
  let st = null;
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000, polling: 250 });
    st = await page.evaluate(
      ({ band, fn, wantPng }) => {
        const g = window.__game;
        g.loop.stop();
        for (const id of ['hud', 'ui', 'boot']) {
          const el = document.getElementById(id);
          if (el) el.style.display = 'none';
        }
        g.loop.step(1 / 60);
        const src = g.renderer.domElement;
        const cv = document.createElement('canvas');
        cv.width = 320;
        cv.height = 180;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(src, 0, 0, 320, 180);
        let png = null;
        if (wantPng) {
          const full = document.createElement('canvas');
          full.width = src.width;
          full.height = src.height;
          full.getContext('2d').drawImage(src, 0, 0);
          png = full.toDataURL('image/png');
        }
        const stats = new Function(`return (${fn})`)();
        return { ...stats(ctx.getImageData(0, 0, 320, 180).data, band), png, look: g.world.env?.lookName || null };
      },
      { band: BANDS[c.band], fn: statsFn.toString(), wantPng: !!shotsDir }
    );
  } catch (e) {
    errors.push(e.message.split('\n')[0]);
  }
  await page.close();
  if (st?.png && shotsDir) writeFileSync(join(shotsDir, `${label}-${c.name}.png`), Buffer.from(st.png.split(',')[1], 'base64'));
  const r = { name: c.name, kind: 'render', url, bandName: c.band, sec: +((Date.now() - t0) / 1000).toFixed(1), ...(st ? round({ sat: st.sat, V: st.V, p5V: st.p5V, band: st.band }) : {}), errors };
  const lim = { ...MIN, ...(LOOK_LIMITS[c.look] || {}) };
  r.fails = st ? Object.keys(MIN).filter((k) => !(r[k] >= lim[k])) : ['no capture'];
  if (errors.length) r.fails.push('errors');
  if (r.fails.length) failed++;
  results.push(r);
  console.log(
    `${r.fails.length ? 'FAIL' : 'PASS'} ${c.name.padEnd(16)} sat ${r.sat}  V ${r.V}  p5V ${r.p5V}  ${c.band} ${r.band}%  (${r.sec}s)` +
      (r.fails.length ? `  ✗ ${r.fails.join(', ')}` : '')
  );
  for (const e of errors.slice(0, 4)) console.log('   ', e);
}
await browser.close();
mkdirSync(outDir, { recursive: true });
const reportPath = join(outDir, 'vivid-report.json');
let prev = {};
try {
  prev = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  /* first run */
}
prev[label] = { date: new Date().toISOString(), size: `${vw}x${vh}`, quality, thresholds: { MIN, LOOK_LIMITS }, results };
writeFileSync(reportPath, JSON.stringify(prev, null, 1));
process.exit(failed && !noFail ? 1 : 0);
