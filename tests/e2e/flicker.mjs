// Flicker detector (headless Chromium, SwiftShader WebGL2).
// Loads stages with `?lumaprobe=N` (src/core/lumaProbe.js records the mean
// screen luma of every frame right after the post chain, plus the post/dynres
// state), then fails on short brightness dips and prints the state that
// changed on the dip frame.
//   auto      autopilot, fixed 1/60 s frames
//   slam      no autopilot; holds/taps the arrow keys to pin the jet against the
//             movement-box edges (this is what used to trigger the G greyout)
//   realtime  autopilot without fixed=1, so dynamic resolution is live (the slow
//             software GPU makes it drop the render scale → resizes mid-stage)
//             At ~10 fps, dips caused by image content alone (thumbnails are
//             written to tests/e2e/out/ for every dip) are reported, not failed.
//   nan       (opt-in) adds an object that writes NaN/Inf into the HDR buffer and
//             checks that the mean luma barely drops (post-chain NaN guard)
// Usage: node tests/e2e/flicker.mjs [baseUrl] [--stages 1,2,3] [--variants auto,slam,realtime[,nan]]
//                                   [--frames 120] [--size 640x360] [--quality medium]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDips } from '../../src/core/lumaProbe.js';

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
const stages = opt('stages', '1,2,3').split(',');
const variants = opt('variants', 'auto,slam,realtime').split(',');
const frames = +opt('frames', 120);
const [vw, vh] = opt('size', '640x360').split('x').map(Number);
const quality = opt('quality', 'medium');
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'out');

const STATE_KEYS = ['blank', 'grey', 'dmg', 'warn', 'white', 'climax', 'scale', 'resized', 'flare'];

/** Key pattern for the "slam" variant, indexed by recorded frame. */
function slamKeys(i) {
  const phase = Math.floor(i / 24) % 5;
  if (phase === 0) return ['ArrowLeft'];
  if (phase === 1) return ['ArrowRight', 'ArrowUp'];
  if (phase === 2) return i % 6 < 2 ? ['ArrowLeft'] : i % 6 < 4 ? [] : ['ArrowRight']; // quick jinks
  if (phase === 3) return ['ArrowUp'];
  return ['ArrowDown', 'ArrowLeft'];
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
});
const report = [];
let failed = 0;
for (const stage of stages) {
  for (const variant of variants) {
    const q = new URLSearchParams({ stage, quality, god: '1', skipintro: '1', t: '15', lumaprobe: String(frames), mute: '1' });
    if (variant !== 'slam') q.set('autopilot', '1');
    if (variant !== 'realtime') q.set('fixed', '1');
    const url = `${base}?${q}`;
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const t0 = Date.now();
    let res = null;
    try {
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__luma && window.__luma.series.length > 0, null, { timeout: 180000, polling: 200 });
      if (variant === 'slam') {
        const held = new Set();
        for (;;) {
          const n = await page.evaluate(() => (window.__luma.done ? -1 : window.__luma.series.length));
          if (n < 0) break;
          const want = new Set(slamKeys(n));
          for (const k of held) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
          for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
          await page.waitForTimeout(40);
        }
        for (const k of held) await page.keyboard.up(k);
      }
      if (variant === 'nan') {
        // a small object that writes NaN/±Inf into the HDR buffer: with the
        // guard only its own pixels go dark; without it bloom smears black blocks
        await page.waitForFunction(() => window.__luma.series.length >= 30, null, { timeout: 300000, polling: 100 });
        await page.evaluate(() => {
          const g = window.__game;
          const Mesh = g.post.sunMesh.constructor;
          const Geo = g.post.sunMesh.geometry.constructor;
          const ShaderMaterial = g.world.sky.domeMat.constructor;
          const mat = new ShaderMaterial({
            uniforms: { uZero: { value: 0 } },
            vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: 'uniform float uZero; void main() { float n = uZero / uZero; float inf = 1.0 / uZero; gl_FragColor = vec4(n, inf, -inf, 1.0); }'
          });
          const m = new Mesh(new Geo(1, 12, 8), mat);
          m.position.set(0, 4, -35);
          m.scale.setScalar(5);
          m.frustumCulled = false;
          g.state.jet.group.add(m);
          window.__luma.nanFrom = window.__luma.series.length;
        });
      }
      await page.waitForFunction(() => window.__luma.done, null, { timeout: 300000, polling: 250 });
      res = await page.evaluate(() => window.__luma);
    } catch (e) {
      errors.push(e.message.split('\n')[0]);
    }
    await page.close();
    const series = res?.series || [];
    const thumbs = res?.thumbs || [];
    const dips = findDips(series);
    const maxOf = (k) => series.reduce((m, s) => Math.max(m, s[k] ?? 0), 0);
    const summary = {
      stage, variant, url, frames: series.length, sec: +((Date.now() - t0) / 1000).toFixed(1),
      lumaMean: +(series.reduce((a, s) => a + s.l, 0) / Math.max(1, series.length)).toFixed(3),
      lumaMin: +Math.min(...series.map((s) => s.l)).toFixed(3),
      maxGrey: maxOf('grey'), maxG: maxOf('g'), maxWarn: maxOf('warn'), maxDamage: maxOf('dmg'),
      resizes: series.reduce((a, s) => a + (s.resized || 0), 0),
      blanks: series.reduce((a, s) => a + (s.blank || 0), 0),
      dips: dips.map((d) => {
        const a = series[d.start - 1], b = series[d.start];
        const changed = STATE_KEYS.filter((k) => Math.abs((b[k] ?? 0) - (a[k] ?? 0)) > 1e-3).map((k) => `${k} ${a[k]}→${b[k]}`);
        // classify: blank frame / post or dynres state / flare pop → flicker;
        // otherwise the image content changed (e.g. a jet passing in front of the sun)
        const post = ['grey', 'dmg', 'warn', 'white', 'climax'].some((k) => Math.abs((b[k] ?? 0) - (a[k] ?? 0)) > 0.05);
        const dyn = b.resized || Math.abs((b.scale ?? 0) - (a.scale ?? 0)) > 1e-3;
        const flarePop = (a.flare ?? 0) - (b.flare ?? 0) > 0.25;
        const kind = b.blank ? 'blank' : post ? 'post' : dyn ? 'dynres' : flarePop ? 'flare' : 'content';
        return { ...d, depth: +d.depth.toFixed(3), changed, kind };
      }),
      errors
    };
    // G greyout must only come from scripted overrides; none of these runs has one.
    const greyBad = summary.maxGrey > 0.05;
    // NaN variant: mean luma after the NaN object appears vs before
    let nanBad = false;
    if (variant === 'nan' && res?.nanFrom) {
      const mean = (a) => a.reduce((s, x) => s + x.l, 0) / Math.max(1, a.length);
      const before = mean(series.slice(5, res.nanFrom));
      const after = mean(series.slice(res.nanFrom + 2));
      summary.nanDrop = +(1 - after / before).toFixed(3);
      nanBad = summary.nanDrop > 0.12;
    }
    // Every dip fails in the fixed-step variants (1/60 s apart). The realtime
    // variant samples at the software GPU's ~10 fps, where fast content (a close
    // pass) legitimately changes a lot between frames: there only dips explained
    // by a blank frame, a post/dynres state step or a flare pop fail.
    const failing = summary.dips.filter((d) => variant !== 'realtime' || d.kind !== 'content');
    summary.failingDips = failing.length;
    const ok = !errors.length && series.length >= frames && !failing.length && !greyBad && !nanBad;
    if (!ok) failed++;
    report.push(summary);
    console.log(
      `${ok ? 'PASS' : 'FAIL'} stage ${stage} ${variant.padEnd(8)} ${summary.frames} frames ${summary.sec}s  luma ${summary.lumaMean} (min ${summary.lumaMin})  ` +
        `dips ${dips.length}  resizes ${summary.resizes} (blank ${summary.blanks})  max grey ${summary.maxGrey} G ${summary.maxG} warn ${summary.maxWarn}`
    );
    mkdirSync(outDir, { recursive: true });
    for (const d of summary.dips.slice(0, 10)) {
      console.log(`    dip @${d.start}..${d.end} depth ${(d.depth * 100).toFixed(1)}% [${d.kind}]  ${d.changed.join(', ') || '(no post/dynres state change)'}  (rail s ${series[d.start].s})`);
      // thumbnails around the dip for inspection
      for (let k = Math.max(0, d.start - 1); k <= Math.min(thumbs.length - 1, d.end); k++) {
        const f = join(outDir, `flicker-s${stage}-${variant}-${String(k).padStart(3, '0')}.png`);
        writeFileSync(f, Buffer.from(thumbs[k].split(',')[1], 'base64'));
      }
    }
    if (greyBad) console.log(`    greyout ${summary.maxGrey} without a scripted gOverride`);
    if (summary.nanDrop != null) console.log(`    NaN object: mean luma drop ${(summary.nanDrop * 100).toFixed(1)}% (limit 12%)`);
    for (const e of errors.slice(0, 5)) console.log('   ', e);
  }
}
await browser.close();
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'flicker-report.json'), JSON.stringify(report, null, 1));
process.exit(failed ? 1 : 0);
