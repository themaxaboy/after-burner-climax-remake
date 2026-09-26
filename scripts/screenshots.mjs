// README screenshots, captured from the running game (headless Chromium).
// Each stage shot loads the stage mid-flight with the invulnerable autopilot,
// stops the frame loop and steps the simulation by hand (clock included, so
// particles and trails age exactly as in play), rendering densely during the
// last second so trails and tracers look like real-time frames.
// SwiftShader is slow: allow several minutes per shot, and don't run it next to other WebGL jobs.
// Usage: node scripts/screenshots.mjs [baseUrl] [outDir] [--only ocean,climax] [--quality high]
//   baseUrl  a running dev/preview server (default http://localhost:5173/)
//   outDir   default docs/screenshots (JPEG, 1280×720)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

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
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));
const base = pos[0] || 'http://localhost:5173/';
const out = pos[1] || 'docs/screenshots';
const only = opt('only', null)?.split(',');
const quality = opt('quality', 'high');
mkdirSync(out, { recursive: true });

// name, stage query, simulated seconds before the capture
const SHOTS = [
  { name: 'ocean', q: 'stage=ocean&t=22', sim: 6 },
  { name: 'canyon', q: 'stage=canyon&t=9', sim: 5 },
  { name: 'glacier', q: 'stage=glacier&t=14', sim: 5 },
  { name: 'dunes', q: 'stage=dunes&t=18', sim: 6 },
  { name: 'sunset', q: 'stage=sunset&t=11', sim: 5 },
  { name: 'clouds', q: 'stage=clouds&t=18', sim: 6 },
  { name: 'aurora', q: 'stage=aurora&t=16', sim: 6 },
  { name: 'climax', q: 'stage=emerald&t=20', sim: 5, climax: true },
  { name: 'route', q: 'stage=dunes', route: ['ocean', 'emerald', 'canyon', 'sunset', 'dunes'] },
  { name: 'title', title: true }
];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const s of SHOTS) {
  if (only && !only.includes(s.name)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const t0 = Date.now();
  const url = s.title ? `${base}?quality=${quality}` : `${base}?${s.q}&quality=${quality}&skipintro=1&autopilot=1&god=1&frames=3`;
  await page.goto(url, { waitUntil: 'load' });
  if (s.title) {
    await page.waitForFunction(() => window.__game?.state?.kind === 'title' && !window.__game.state.loading, null, { timeout: 300000, polling: 500 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => document.getElementById('boot')?.style.setProperty('display', 'none'));
  } else {
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000, polling: 500 });
    await page.evaluate(async ({ sim = 1, climax, route }) => {
      const g = window.__game;
      g.loop.stop();
      document.getElementById('boot').style.display = 'none';
      const step = () => {
        g.clock.advanceReal(1 / 120);
        const w = (1 / 120) * g.clock.timeScale;
        g.clock.advanceWorld(w);
        g.update(1 / 120, w);
      };
      const n = Math.round(sim * 120);
      const dense = 60; // the last half second renders at 60 fps
      for (let i = 0; i < n; i++) {
        step();
        if (i >= n - dense ? i % 2 === 0 : i % 12 === 0) g.render(1, i >= n - dense ? 1 / 60 : 0.1);
      }
      const st = g.state;
      if (climax) {
        st.climax.gauge = 1;
        st.combat.activateClimax();
        for (let i = 0; i < 90; i++) {
          step();
          if (i % 6 === 0) g.render(1, 0.05);
        }
        st.postBridge.burst = 0.3;
      }
      for (let i = 0; i < 4; i++) g.render(1, 1 / 60);
      if (route) {
        const { showPleaseWait } = await import('/src/states/panelState.js');
        const { STAGE_BY_ID } = await import('/src/stages/campaign.js');
        g.session.route = route.slice();
        g.session.stageNo = route.length;
        const def = STAGE_BY_ID[route[route.length - 1]];
        showPleaseWait(g, def, { events: { on: () => () => {} }, paused: false });
      }
    }, s);
    if (s.route) await page.waitForTimeout(2500);
  }
  await page.screenshot({ path: `${out}/${s.name}.jpg`, type: 'jpeg', quality: 84, timeout: 900000 });
  console.log(`${s.name}.jpg`, `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.close();
}
await browser.close();
