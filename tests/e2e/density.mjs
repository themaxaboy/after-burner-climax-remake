// Enemy density check (headless Chromium, SwiftShader WebGL2).
// For each stage: load it mid-flight with the autopilot (invulnerable), then
// sample the simulation every 0.5 s of game time for ~30 s:
//   onScreen   enemies on screen (lock-on projection: e.onScreen); the mean is
//              taken while the wave generator is active (set pieces excluded)
//   gap        longest run with no enemy on screen while the wave generator is
//              active (quiet spans, waves 'off' and the stage end are excluded)
//   arrivals   enemies spawned per second (waves + timeline) while the wave
//              generator runs (the whole-window rate is printed too)
//   behind     share of those aircraft that spawned behind the player (rs < player.s)
// Targets: mean on screen ≥ 4, no gap > 2.5 s, arrivals ≥ 1.5/s, ≥ 20 % from behind.
// Prints a table; exits non-zero when a stage misses a target (unless --no-fail).
// Usage: node tests/e2e/density.mjs [baseUrl] [--stages ocean,canyon] [--seconds 30]
//                                   [--turbo 4] [--quality low] [--no-fail]
import { createRequire } from 'node:module';

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
const base = argv.find((a) => /^https?:/.test(a)) || 'http://localhost:5173/';
const STAGES = ['ocean', 'emerald', 'canyon', 'sunset', 'glacier', 'dunes', 'clouds', 'strike', 'fortress'];
const stages = opt('stages', null)?.split(',') ?? STAGES;
const seconds = +opt('seconds', 30);
const turbo = +opt('turbo', 4);
const quality = opt('quality', 'low');
const noFail = argv.includes('--no-fail');
const TARGET = { meanOnScreen: 4, maxGap: 2.5, arrivals: 1.5, behind: 0.2 };

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const rows = [];
let failed = 0;
for (const id of stages) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // frames=2: marks the page ready and advances a fixed 1/60 s per frame (deterministic)
  const url = `${base}?stage=${id}&quality=${quality}&skipintro=1&t=12&autopilot=1&god=1&mute=1&turbo=${turbo}&frames=2`;
  const t0 = Date.now();
  let tReady = 0;
  let row = { stage: id };
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.dataset.ready === '1' && window.__game?.state?.kind === 'stage' && !window.__game.state.loading, null, {
      timeout: 240000,
      polling: 500
    });
    tReady = (Date.now() - t0) / 1000;
    // hook the sim step (exact 0.5 s samples whatever the frame rate) and every spawn
    await page.evaluate((seconds) => {
      const st = window.__game.state;
      const p = st.player;
      const D = (window.__density = { samples: [], spawns: [], t: 0, next: 0, done: false, seconds });
      const em = st.enemies;
      const spawn = em.spawn.bind(em);
      em.spawn = (type, o) => {
        const e = spawn(type, o);
        if (e && !D.done) {
          const world = e.anchor === 'world';
          D.spawns.push({ t: D.t, rel: world ? null : e.rs - p.s, beh: e.behaviorName, air: !!e.def.air, world });
        }
        return e;
      };
      const update = st.update.bind(st);
      st.update = (dt, wdt) => {
        update(dt, wdt);
        if (D.done) return;
        D.t += wdt;
        if (D.t >= D.next) {
          D.next += 0.5;
          let n = 0;
          for (const e of em.list) if (e.active && e.onScreen && !e.dead && !(e.dying > 0)) n++;
          const w = st.director?.waves;
          const active = !!w && w.on && w.active(p.s) && !st.director.ended && !st.finished;
          D.samples.push({ t: D.t, n, active, s: p.s });
        }
        if (D.t >= D.seconds || st.finished) D.done = true;
      };
    }, seconds);
    await page.waitForFunction(() => window.__density?.done || window.__game?.state?.kind !== 'stage', null, { timeout: 900000, polling: 1000 });
    const D = await page.evaluate(() => window.__density);
    const S = D.samples;
    const T = Math.max(D.t, 1e-3);
    const A = S.filter((s) => s.active);
    const mean = A.reduce((a, s) => a + s.n, 0) / Math.max(1, A.length);
    const meanAll = S.reduce((a, s) => a + s.n, 0) / Math.max(1, S.length);
    let gap = 0, run = 0;
    for (const s of S) {
      if (s.active && s.n === 0) run += 0.5;
      else run = 0;
      gap = Math.max(gap, run);
    }
    // arrivals and the from-behind share count the time the wave generator runs
    // (a spawn belongs to the 0.5 s sample that follows it)
    const activeAt = (t) => (S.find((s) => s.t >= t - 1e-9) ?? S[S.length - 1])?.active;
    const activeT = A.length * 0.5;
    const live = D.spawns.filter((s) => activeAt(s.t));
    const air = live.filter((s) => s.air && !s.world);
    const behind = air.filter((s) => s.rel < 0).length / Math.max(1, air.length);
    const arrivals = live.length / Math.max(activeT, 1e-3);
    const arrivalsAll = D.spawns.length / T;
    const quiet = S.filter((s) => !s.active).length / Math.max(1, S.length);
    const byBeh = {};
    for (const s of D.spawns) byBeh[s.beh] = (byBeh[s.beh] || 0) + 1;
    row = { stage: id, secs: T, mean, meanAll, max: Math.max(0, ...S.map((s) => s.n)), gap, arrivals, arrivalsAll, behind, quiet, byBeh };
    const miss = [];
    if (activeT < 5) miss.push(`waves ran only ${activeT.toFixed(1)} s`);
    if (mean < TARGET.meanOnScreen) miss.push(`mean on screen ${mean.toFixed(1)} < ${TARGET.meanOnScreen}`);
    if (gap > TARGET.maxGap) miss.push(`gap ${gap.toFixed(1)} s > ${TARGET.maxGap}`);
    if (arrivals < TARGET.arrivals) miss.push(`arrivals ${arrivals.toFixed(2)}/s < ${TARGET.arrivals}`);
    if (behind < TARGET.behind) miss.push(`behind ${(behind * 100).toFixed(0)} % < ${TARGET.behind * 100}`);
    if (T < seconds * 0.5) miss.push(`only ${T.toFixed(1)} s sampled`);
    if (errors.length) miss.push(errors[0]);
    row.ok = miss.length === 0;
    row.miss = miss;
  } catch (e) {
    row.ok = false;
    row.miss = [e.message.split('\n')[0]];
  }
  row.wall = (Date.now() - t0) / 1000;
  row.load = tReady;
  if (!row.ok) failed++;
  rows.push(row);
  const f = (v, d = 1) => (v == null ? '-' : v.toFixed(d));
  console.log(
    `${row.ok ? 'PASS' : 'FAIL'} ${id.padEnd(9)} t ${f(row.secs, 0).padStart(3)} s  on-screen mean ${f(row.mean).padStart(4)} max ${String(row.max ?? '-').padStart(2)}  gap ${f(row.gap).padStart(4)} s  arrivals ${f(row.arrivals, 2)}/s  behind ${f(row.behind != null ? row.behind * 100 : null, 0).padStart(3)} %  quiet ${f(row.quiet != null ? row.quiet * 100 : null, 0).padStart(3)} %  (whole window: on-screen ${f(row.meanAll)}, ${f(row.arrivalsAll, 2)}/s; load ${f(row.load, 0)} s, ${f(row.wall, 0)} s wall)${row.miss?.length ? '  ' + row.miss.join('; ') : ''}`
  );
  await page.close();
}
await browser.close();

console.log('\nstage      mean  gap   arr/s  behind  patterns (spawns by behaviour)');
for (const r of rows) {
  if (r.mean == null) continue;
  const beh = Object.entries(r.byBeh || {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  console.log(`${r.stage.padEnd(9)} ${r.mean.toFixed(1).padStart(5)} ${r.gap.toFixed(1).padStart(4)} ${r.arrivals.toFixed(2).padStart(6)} ${(r.behind * 100).toFixed(0).padStart(5)} %  ${beh}`);
}
console.log(`\ntargets: mean on screen ≥ ${TARGET.meanOnScreen}, gap ≤ ${TARGET.maxGap} s, arrivals ≥ ${TARGET.arrivals}/s, from behind ≥ ${TARGET.behind * 100} %`);
process.exit(failed && !noFail ? 1 : 0);
