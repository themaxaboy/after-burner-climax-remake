// End-to-end route test in headless Chromium (SwiftShader WebGL2).
// Plays chains of stages through both forks and the bonus stage with
// ?route=… pre-selected choices, warping each stage close to its end and
// letting the autopilot finish it; with ?autopilot=1 the results / status /
// "Please Wait" panels advance by themselves. Asserts for every stage that it
// reaches its results, that a fork stage reports the planned route, that the
// next stage on the route starts and that the run reaches the ending without
// page errors. Shader programs compiled mid-stage are reported (WARN; a
// failure with --strict).
// Usage: node tests/e2e/routes.mjs [baseUrl] [A|B] [--strict]   (default http://localhost:5173/, both runs)
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
const only = args[1] || null;

// warp is applied to every stage of the run: 44 s leaves the last ~7–18 s of
// each 50–65 s stage (route selects open ~11 s before the end of the rail)
const RUNS = [
  { name: 'A', start: 'emerald', route: 'sunset,clouds', path: ['emerald', 'canyon', 'sunset', 'dunes', 'clouds', 'fortress'], forks: { canyon: 'sunset', dunes: 'clouds' }, optional: ['aurora'] },
  { name: 'B', start: 'canyon', route: 'glacier,aurora,strike', path: ['canyon', 'glacier', 'dunes', 'aurora', 'strike', 'fortress'], forks: { canyon: 'glacier', dunes: 'strike' } }
].filter((r) => !only || r.name === only);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let failed = 0;
for (const run of RUNS) {
  const page = await browser.newPage({ viewport: { width: 400, height: 225 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const txt = m.text();
    if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(txt)) errors.push(`console: ${txt.slice(0, 300)}`);
  });
  const url = `${base}?stage=${run.start}&route=${run.route}&quality=low&warp=44&autopilot=1&god=1&turbo=4&frames=2&mute=1`;
  const t0 = Date.now();
  const problems = [];
  const warnings = [];
  const seen = []; // stage ids in the order they were entered
  const resultsSeen = [];
  let ok = true;
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 300000, polling: 500 });
    // per-stage shader-program watch: baseline once a stage is loaded, growth while it runs
    await page.evaluate(() => {
      const g = window.__game;
      window.__watch = { id: null, base: 0, max: 0, keys: null, fresh: [] };
      setInterval(() => {
        const st = g.state;
        const w = window.__watch;
        if (st?.kind !== 'stage' || st.loading) return;
        const progs = g.renderer.info.programs;
        if (w.id !== st) {
          w.id = st;
          w.def = st.def.id;
          w.base = w.max = progs.length;
          w.keys = new Set(progs.map((p) => p.name + p.cacheKey.length));
          w.fresh = [];
          return;
        }
        if (st.finished || st.paused) return;
        if (progs.length > w.max) {
          w.max = progs.length;
          w.fresh = progs.filter((p) => !w.keys.has(p.name + p.cacheKey.length)).map((p) => p.name || `(${p.cacheKey.split(',').slice(0, 3).join(',')})`);
          (window.__freshLog ||= []).push(`${w.def}: ${w.fresh.join(', ')}`);
        }
      }, 250);
    });
    const deadline = Date.now() + 40 * 60 * 1000;
    for (;;) {
      if (Date.now() > deadline) throw new Error('timeout');
      await page.waitForTimeout(1500);
      const s = await page.evaluate(() => {
        const g = window.__game;
        const st = g.state;
        return {
          kind: st?.kind,
          loading: !!st?.loading,
          id: st?.def?.id || null,
          results: g.session.results.map((r) => ({ id: r.stage.id, route: r.route, kills: r.kills })),
          route: g.session.route.slice(),
          stageNo: g.session.stageNo
        };
      });
      if (s.kind === 'stage' && s.id && seen[seen.length - 1] !== s.id) {
        seen.push(s.id);
        console.log(`  ${run.name} +${((Date.now() - t0) / 1000).toFixed(0)}s  stage ${s.stageNo}: ${s.id}  (route ${s.route.join('>')})`);
      }
      while (resultsSeen.length < s.results.length) {
        const r = s.results[resultsSeen.length];
        resultsSeen.push(r);
        console.log(`  ${run.name} +${((Date.now() - t0) / 1000).toFixed(0)}s  results: ${r.id} kills ${r.kills}${r.route ? ` → route ${r.route}` : ''}`);
      }
      if (s.kind === 'ending') break;
    }
    const fresh = await page.evaluate(() => window.__freshLog || []);
    if (fresh.length) (strict ? problems : warnings).push(`shader programs compiled mid-stage: ${fresh.join(' | ')}`);
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
  }
  // checks (an optional bonus stage may appear if enough Emergency Orders were cleared)
  const keep = (id) => !(run.optional || []).includes(id);
  const seenIds = seen.filter(keep);
  const resultIds = resultsSeen.map((r) => r.id).filter(keep);
  if (seenIds.join('>') !== run.path.join('>')) problems.push(`stages ${seen.join('>')} ≠ expected ${run.path.join('>')}`);
  if (resultIds.join('>') !== run.path.join('>')) problems.push(`results ${resultIds.join('>')}`);
  for (const [fork, choice] of Object.entries(run.forks)) {
    const r = resultsSeen.find((x) => x.id === fork);
    if (r && r.route !== choice) problems.push(`${fork} chose ${r.route}, expected ${choice}`);
  }
  if (errors.length) problems.push(...[...new Set(errors)].slice(0, 8));
  ok = problems.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} route ${run.name} ${run.path.join(' → ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  for (const p of problems) console.log('   ', p);
  for (const w of warnings) console.log('    WARN', w);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
