// End-to-end smoke test in headless Chromium (SwiftShader WebGL2).
// For each stage: load it, warp the simulation close to the end, let the
// autopilot finish, and assert: no page/console errors, the stage completes
// into its results, and no shaders compile after loading (reported as WARN;
// a failure with --strict).
// Usage: node tests/e2e/smoke.mjs [baseUrl] [stageId,…] [--strict]   (default http://localhost:5173)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const strict = process.argv.includes('--strict');
const base = args[0] || 'http://localhost:5173/';
const only = args[1] ? args[1].split(',') : null;
// warp = seconds of simulation before the first frame: each 50–65 s stage is
// warped to its last ~8–15 s (past the set pieces worth exercising at the end:
// route selects, the refuel, the strike pull-out, the carrier landing)
const cases = [
  { stage: 'ocean', warp: 52 }, // + ~9 s catapult launch
  { stage: 'emerald', warp: 45 },
  { stage: 'canyon', warp: 44, route: 'glacier' }, // route select
  { stage: 'sunset', warp: 44 }, // refuel
  { stage: 'glacier', warp: 43 },
  { stage: 'dunes', warp: 43, route: 'strike' }, // route select
  { stage: 'aurora', warp: 41 },
  { stage: 'clouds', warp: 45 },
  { stage: 'strike', warp: 45 }, // strike + pull-out
  { stage: 'fortress', warp: 50 } // approach + trap landing
].filter((c) => !only || only.includes(c.stage));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(txt)) errors.push(`console: ${txt.slice(0, 300)}`);
  });
  const url = `${base}?stage=${c.stage}&quality=low&warp=${c.warp}&autopilot=1&god=1&turbo=4&frames=2&mute=1${c.route ? `&route=${c.route}` : ''}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  let ok = true, warn = false, detail = '';
  try {
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000, polling: 500 });
    const progs0 = await page.evaluate(() => {
      const g = window.__game;
      window.__maxProgs = g.renderer.info.programs.length;
      window.__progList0 = new Set(g.renderer.info.programs.map((p) => p.name + p.cacheKey.length));
      setInterval(() => {
        // only while this stage runs (panels advance on their own with the autopilot)
        if (g.state?.kind !== 'stage' || g.session.results.length) return;
        const list = g.renderer.info.programs;
        if (list.length > window.__maxProgs) {
          window.__maxProgs = list.length;
          window.__newProgs = list.filter((p) => !window.__progList0.has(p.name + p.cacheKey.length)).map((p) => p.name || `(${p.cacheKey.split(',').slice(0, 3).join(',')})`);
        }
      }, 250);
      return window.__maxProgs;
    });
    await page.waitForFunction(() => window.__game.session.results.length > 0, null, { timeout: 600000, polling: 1000 });
    const info = await page.evaluate(() => ({ maxProgs: window.__maxProgs, newProgs: window.__newProgs || [], res: window.__game.session.results.at(-1) }));
    detail = `kills ${info.res.kills} down ${info.res.downRate.toFixed(1)}%${info.res.route ? ` route ${info.res.route}` : ''} programs at load ${progs0}, max during stage ${info.maxProgs}`;
    if (info.maxProgs > progs0) {
      if (strict) ok = false;
      warn = true;
      detail += ` NEW PROGRAMS MID-STAGE: ${info.newProgs.join(', ')}`;
    }
    if (c.route && info.res.route !== c.route) {
      ok = false;
      detail += ` expected route ${c.route}`;
    }
  } catch (e) {
    ok = false;
    detail = e.message.split('\n')[0];
  }
  if (errors.length) ok = false;
  if (!ok) failed++;
  console.log(`${ok ? (warn ? 'PASS (WARN)' : 'PASS') : 'FAIL'} stage ${c.stage} (${((Date.now() - t0) / 1000).toFixed(0)} s) ${detail}`);
  for (const e of [...new Set(errors)].slice(0, 8)) console.log('   ', e);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
