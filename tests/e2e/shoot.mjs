// Usage: node tests/e2e/shoot.mjs <url> <out.png> [waitFrames] [width] [height]
// Headless Chromium with SwiftShader WebGL2. Prints console errors.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
}
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';

const [url, out, waitMs = '60000', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: +waitMs, polling: 250 });
} catch {
  errors.push('[timeout] ready flag not set');
}
const info = await page.evaluate(() => {
  const g = window.__game;
  if (!g) return null;
  return { frame: g.frameCount, dbg: g.state?.debugText?.(), gpu: g.gpu, preset: g.preset?.name, calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, progs: g.renderer.info.programs?.length };
});
await page.screenshot({ path: out });
console.log(JSON.stringify({ ms: Date.now() - t0, info }, null, 0));
for (const e of errors.slice(0, 30)) console.log(e);
await browser.close();
