// End-to-end smoke test in headless Chromium (SwiftShader WebGL2).
// For each stage: load it, warp the simulation close to the end, let the
// autopilot finish, and assert: no page/console errors, the stage completes
// into the results screen, and no shaders compile after loading.
// Usage: node tests/e2e/smoke.mjs [baseUrl]   (default http://localhost:5173)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';
const base = process.argv[2] || 'http://localhost:5173/';
const cases = [
  { stage: 1, warp: 183 },
  { stage: 2, warp: 150 },
  { stage: 3, warp: 214 }
];
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
  const url = `${base}?stage=${c.stage}&quality=low&warp=${c.warp}&autopilot=1&god=1&turbo=4&frames=2`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  let ok = true, detail = '';
  try {
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 240000, polling: 500 });
    const progs0 = await page.evaluate(() => {
      const g = window.__game;
      window.__maxProgs = g.renderer.info.programs.length;
      window.__progList0 = new Set(g.renderer.info.programs.map((p) => p.name + p.cacheKey.length));
      setInterval(() => {
        if (g.state?.kind !== 'stage') return;
        const list = g.renderer.info.programs;
        if (list.length > window.__maxProgs) {
          window.__maxProgs = list.length;
          window.__newProgs = list.filter((p) => !window.__progList0.has(p.name + p.cacheKey.length)).map((p) => p.name);
        }
      }, 250);
      return window.__maxProgs;
    });
    await page.waitForFunction(() => window.__game.state?.kind === 'results', null, { timeout: 600000, polling: 1000 });
    const info = await page.evaluate(() => ({ maxProgs: window.__maxProgs, newProgs: window.__newProgs || [], res: window.__game.session.results.at(-1) }));
    detail = `kills ${info.res.kills} down ${info.res.downRate.toFixed(1)}% programs at load ${progs0}, max during stage ${info.maxProgs}`;
    if (info.maxProgs > progs0) detail += ` NEW: ${info.newProgs.join(', ')}`;
  } catch (e) {
    ok = false;
    detail = e.message.split('\n')[0];
  }
  if (errors.length) ok = false;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} stage ${c.stage} (${((Date.now() - t0) / 1000).toFixed(0)} s) ${detail}`);
  for (const e of [...new Set(errors)].slice(0, 8)) console.log('   ', e);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
