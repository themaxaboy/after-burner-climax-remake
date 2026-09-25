// Radio chatter: scheduler logic, line catalog, director wiring and the committed voice clips.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RadioQueue, pickVariant, RADIO_GAP } from '../../src/audio/voice/scheduler.js';
import { CATALOG, LINES, SPEAKERS, STAGE_LINES, GENERIC_ORDER, buildCatalog, clipFor, estimateDuration, planPreload, stageKeys } from '../../src/audio/voice/catalog.js';
import { RadioDirector, RULES } from '../../src/audio/radio.js';
import { Events } from '../../src/core/events.js';
import { AudioEngine } from '../../src/audio/index.js';
import { registerStrings } from '../../src/ui/i18n.js';
import en from '../../src/ui/strings/en.js';

const VOICE_DIR = join(process.cwd(), 'public/audio/voice');
const MANIFEST_PATH = join(VOICE_DIR, 'manifest.json');
const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : null;

function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** Queue with a fixed duration per key; records every start/stop. */
function makeQueue(durOf = () => 1, opts = {}) {
  const log = [];
  const q = new RadioQueue({
    rng: lcg(3),
    ...opts,
    onStart: (it) => {
      const d = durOf(it);
      log.push({ key: it.key, priority: it.priority, start: q.now, end: q.now + d, cut: false });
      return d;
    },
    onStop: (it, reason) => {
      const e = log.findLast((l) => l.key === it.key);
      e.end = q.now;
      e.cut = reason;
    }
  });
  return { q, log };
}

const run = (q, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) q.update(dt);
};

describe('radio scheduler', () => {
  it('never overlaps lines and keeps the gap between them', () => {
    const rng = lcg(7);
    const { q, log } = makeQueue((it) => 0.6 + (it.key.length % 5) * 0.4);
    const cats = ['threat', 'kill', 'fox', 'hit', 'idle', 'combo', 'nearMiss'];
    for (let step = 0; step < 60 * 90; step++) {
      if (rng() < 0.05) {
        const c = cats[Math.floor(rng() * cats.length)];
        q.offer({ key: `${c}.${Math.floor(rng() * 4)}`, cat: c, priority: Math.floor(rng() * 4), ttl: 0.5 + rng() * 3, cooldown: rng() * 3 });
      }
      q.update(1 / 60);
    }
    expect(log.length).toBeGreaterThan(20);
    for (let i = 1; i < log.length; i++) {
      const gap = log[i].start - log[i - 1].end;
      expect(gap).toBeGreaterThanOrEqual((log[i - 1].cut ? q.cutGap : RADIO_GAP) - 1e-6);
    }
  });

  it('a priority-0 line cuts idle chatter but not another urgent line', () => {
    const { q, log } = makeQueue(() => 2.5);
    q.offer({ key: 'idle', priority: 3 });
    run(q, 0.5);
    expect(q.playing.key).toBe('idle');
    expect(q.offer({ key: 'threat', priority: 0, ttl: 1.2 })).toBe(true);
    expect(log[0].cut).toBe('preempt');
    run(q, 0.3);
    expect(q.playing.key).toBe('threat');
    expect(log[1].start - log[0].end).toBeLessThan(0.3);
    // a P1 line is not cut by P0: the P0 line waits and expires
    const { q: q2, log: log2 } = makeQueue(() => 2.5);
    q2.offer({ key: 'script', priority: 1, script: true });
    run(q2, 0.2);
    q2.offer({ key: 'threat', priority: 0, ttl: 1.2 });
    run(q2, 4);
    expect(log2.map((l) => l.key)).toEqual(['script']);
    expect(q2.stats.dropped.ttl).toBe(1);
  });

  it('orders by priority then age', () => {
    const { q, log } = makeQueue(() => 0.5);
    q.offer({ key: 'a', priority: 2, ttl: 10 });
    q.offer({ key: 'b', priority: 1, ttl: 10 });
    q.offer({ key: 'c', priority: 1, ttl: 10 });
    q.offer({ key: 'd', priority: 3, ttl: 10 });
    run(q, 6);
    expect(log.map((l) => l.key)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('applies category cooldowns and play chance', () => {
    const { q } = makeQueue(() => 0.2);
    expect(q.offer({ key: 'k1', cat: 'kill', cooldown: 3.5 })).toBe(true);
    run(q, 1);
    expect(q.offer({ key: 'k2', cat: 'kill', cooldown: 3.5 })).toBe(false);
    run(q, 2.6);
    expect(q.offer({ key: 'k3', cat: 'kill', cooldown: 3.5 })).toBe(true);
    expect(q.stats.dropped.cooldown).toBe(1);
    let ok = 0;
    for (let i = 0; i < 1000; i++) {
      if (q.offer({ key: `f${i}`, cat: `fox${i}`, chance: 0.3 })) ok++;
      q.clear();
    }
    expect(ok).toBeGreaterThan(220);
    expect(ok).toBeLessThan(380);
  });

  it('drops stale lines (TTL) and duplicate keys', () => {
    const { q, log } = makeQueue(() => 3);
    q.offer({ key: 'long', priority: 1, ttl: 5 });
    run(q, 0.1);
    expect(q.offer({ key: 'kill', priority: 2, ttl: 2 })).toBe(true);
    expect(q.offer({ key: 'kill', priority: 2, ttl: 2 })).toBe(false);
    expect(q.offer({ key: 'brief', priority: 1, ttl: 8 })).toBe(true);
    run(q, 8);
    expect(log.map((l) => l.key)).toEqual(['long', 'brief']);
    expect(q.stats.dropped.ttl).toBe(1);
    expect(q.stats.dropped.dup).toBe(1);
  });

  it('honours start delays and lets scripted lines replace generic ones', () => {
    const { q, log } = makeQueue(() => 1);
    q.offer({ key: 'gen.eoStart', delay: 0.5, yieldToScript: true, ttl: 3 });
    run(q, 0.2);
    expect(log.length).toBe(0);
    q.offer({ key: 'r.s1.eo', script: true });
    run(q, 3);
    expect(log.map((l) => l.key)).toEqual(['r.s1.eo']);
    // right after a scripted line, generic ones that yield are refused
    expect(q.offer({ key: 'gen.eoClear', yieldToScript: true })).toBe(false);
    run(q, 3);
    expect(q.offer({ key: 'gen.eoClear', yieldToScript: true })).toBe(true);
  });

  it('caps the queue by dropping the least important line', () => {
    const { q } = makeQueue(() => 10, { maxQueue: 3 });
    q.offer({ key: 'playing', priority: 1 });
    run(q, 0.1);
    q.offer({ key: 'a', priority: 3, ttl: 20 });
    q.offer({ key: 'b', priority: 1, ttl: 20 });
    q.offer({ key: 'c', priority: 2, ttl: 20 });
    expect(q.offer({ key: 'd', priority: 1, ttl: 20 })).toBe(true);
    expect(q.items.map((i) => i.key).sort()).toEqual(['b', 'c', 'd']);
  });

  it('picks variants without immediate repeats, preferring playable ones', () => {
    const rng = lcg(11);
    let last = -1;
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const v = pickVariant(5, last, rng);
      expect(v).not.toBe(last);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      seen.add(v);
      last = v;
    }
    expect(seen.size).toBe(5);
    expect(pickVariant(1, 0, rng)).toBe(0);
    last = -1;
    for (let i = 0; i < 200; i++) {
      const v = pickVariant(6, last, rng, (k) => k === 1 || k === 4);
      expect([1, 4]).toContain(v);
      expect(v).not.toBe(last);
      last = v;
    }
  });
});

describe('radio lines', () => {
  const thai = /[฀-๿]/;

  it('every line has a known speaker, English and Thai text', () => {
    let variants = 0;
    for (const table of [LINES, STAGE_LINES]) {
      for (const [key, line] of Object.entries(table)) {
        expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
        expect(line.variants.length, key).toBeGreaterThan(0);
        for (const v of line.variants) {
          variants++;
          expect(SPEAKERS[v.speaker || line.speaker], `${key} speaker`).toBeTruthy();
          expect(v.en.length, key).toBeGreaterThan(1);
          expect(v.en.length, `${key}: keep lines short`).toBeLessThan(90);
          expect(v.th, key).toMatch(thai);
        }
      }
    }
    expect(variants).toBeGreaterThanOrEqual(120);
    for (const s of Object.values(SPEAKERS)) {
      expect(s.callsign).toMatch(/^[A-Z]+$/);
      expect(s.voice).toBeTruthy();
    }
  });

  it('covers every chatter rule and every legacy radio key', () => {
    for (const r of Object.values(RULES)) expect(CATALOG.has(r.key), r.key).toBe(true);
    for (const k of GENERIC_ORDER) expect(CATALOG.has(k), k).toBe(true);
    for (const k of Object.keys(LINES)) if (k.startsWith('gen.') && k !== 'gen.routeLeft' && k !== 'gen.routeRight') expect(LINES[k].variants.length, k).toBeGreaterThanOrEqual(3);
    const legacy = Object.keys(en).filter((k) => /^r\.(s1|s2|s3|gen)\./.test(k));
    for (const k of legacy) expect(CATALOG.has(k), k).toBe(true);
  });

  it('catalog merge: lines.json wins over stage lines; stage keys are collected', () => {
    const cat = buildCatalog({ 'r.x.a': { speaker: 'lead', variants: [{ en: 'A', th: 'ก' }] } }, { 'r.x.a': { speaker: 'wing', variants: [{ en: 'B', th: 'ข' }] }, 'r.x.b': { speaker: 'wing', variants: [{ en: 'C', th: 'ค' }] } });
    expect(cat.get('r.x.a').variants[0].en).toBe('A');
    expect(cat.get('r.x.b').variants[0].speaker).toBe('wing');
    const keys = stageKeys({ id: 'x', timeline: [{ at: 5, radio: 'r.other.z' }], radioKeys: ['r.y.q'] }, cat);
    expect(keys.sort()).toEqual(['r.other.z', 'r.x.a', 'r.x.b', 'r.y.q']);
    expect(estimateDuration('Fox two!')).toBeGreaterThanOrEqual(1.1);
    expect(estimateDuration('word '.repeat(40))).toBeLessThanOrEqual(4.5);
  });

  it('preload plan respects the budget and spreads it over every pool', () => {
    const man = { lines: {} };
    const lines = {};
    for (let k = 0; k < 10; k++) {
      lines[`p${k}`] = { speaker: 'awacs', variants: [] };
      man.lines[`p${k}`] = { variants: [] };
      for (let i = 0; i < 4; i++) {
        lines[`p${k}`].variants.push({ en: `line ${k} ${i}`, th: 'ก' });
        man.lines[`p${k}`].variants.push({ file: `p${k}.${i}.mp3`, bytes: 1000, dur: 1, en: `line ${k} ${i}` });
      }
    }
    man.lines.p3.variants[0].en = 'stale text'; // voiced from old text: never planned
    const cat = buildCatalog(lines);
    const keys = Object.keys(lines);
    const plan = planPreload(man, cat, keys, 15500);
    expect(plan.reduce((a, c) => a + c.bytes, 0)).toBeLessThanOrEqual(15500);
    expect(new Set(plan.map((c) => c.key)).size).toBe(10);
    expect(plan.find((c) => c.file === 'p3.0.mp3')).toBeUndefined();
    expect(plan.slice(0, 10).every((c) => c.i === 0 || c.key === 'p3')).toBe(true);
    const cached = planPreload(man, cat, keys, 1000, () => true);
    expect(cached.length).toBe(39);
    expect(clipFor(man, 'p1', 2, { en: 'line 1 2' }).file).toBe('p1.2.mp3');
    expect(clipFor(man, 'p1', 2, { en: 'other' })).toBeNull();
  });
});

describe('RadioDirector', () => {
  function setup() {
    const events = new Events();
    const hud = { lines: [], radio(who, text, dur) { this.lines.push({ who, text, dur, t: stage.time }); } };
    const stage = {
      events,
      time: 0,
      paused: false,
      def: { id: 'test', timeline: [] },
      player: { alive: true, armor: 100, s: 0 },
      climax: { active: false, ready: false },
      scoring: { combo: 0 },
      enemies: { list: [], spawned: 0 }
    };
    const game = { hud, audio: null, params: {} };
    const radio = new RadioDirector(game, stage);
    const step = (sec) => {
      for (let t = 0; t < sec; t += 1 / 30) {
        stage.time += 1 / 30;
        radio.update(1 / 30);
      }
    };
    return { events, hud, stage, radio, step };
  }
  const callsigns = new Set(Object.values(SPEAKERS).map((s) => s.callsign));
  const texts = (key) => CATALOG.get(key).variants.map((v) => v.en);

  it('reacts to stage events with subtitles and never overlaps', () => {
    const { events, hud, stage, radio, step } = setup();
    expect(radio.say('gen.kill')).toBe(false); // not live before stageStart
    events.emit('stageStart', { def: stage.def });
    step(2);
    expect(hud.lines.length).toBe(1);
    expect(texts('gen.stageStart')).toContain(hud.lines[0].text);
    step(4);
    events.emit('missileLaunch', { owner: 7, strong: false });
    step(0.1);
    const last = hud.lines.at(-1);
    expect(callsigns.has(last.who)).toBe(true);
    expect(texts('gen.missileInbound')).toContain(last.text);
    events.emit('missileLaunch', { owner: 'player' }); // own missiles: no call
    // a long mixed sequence
    for (let i = 0; i < 200; i++) {
      const r = i % 7;
      if (r === 0) events.emit('kill', { e: { def: {} }, src: 'missile' });
      if (r === 1) events.emit('fox', { locked: true });
      if (r === 2) events.emit('nearMiss', { d: 5 });
      if (r === 3) events.emit('playerHit', { kind: 'missile', amount: 30 });
      step(0.4);
    }
    expect(radio.stats.said).toBeGreaterThan(10);
    expect(radio.stats.fallback).toBe(radio.stats.said); // no audio engine: subtitle + bed path
    const starts = hud.lines.map((l) => l.t);
    for (let i = 1; i < starts.length; i++) {
      // lines start one after another (estimated durations, 0.35 s gap; P0 may cut chatter)
      expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    }
    const q = radio.queue;
    expect(q.stats.dropped.cooldown + q.stats.dropped.chance).toBeGreaterThan(0);
  });

  it('idle chatter fills silence; the down call clears the queue', () => {
    const { events, hud, stage, radio, step } = setup();
    stage.def.timeline = [{ at: 400, radio: 'r.s1.feetWet' }];
    events.emit('stageStart', {});
    step(1.5);
    expect(hud.lines.length).toBe(0); // the stage opens with its own call: no generic start line
    radio.say('r.s1.feetWet');
    step(12);
    expect(hud.lines[0].text).toBe(texts('r.s1.feetWet')[0]);
    expect(hud.lines.some((l) => texts('gen.idle').includes(l.text))).toBe(true);
    events.emit('kill', { e: { def: {} }, src: 'missile' });
    stage.player.alive = false;
    stage.dead = true;
    events.emit('playerDown', {});
    step(0.2);
    expect(texts('gen.down')).toContain(hud.lines.at(-1).text);
    radio.dispose();
    expect(radio.say('r.s1.six')).toBe(false);
  });

  it('polls low armour, Climax ready and combo tiers once each', () => {
    const { events, hud, stage, step } = setup();
    stage.stageLogic = { skipIntroMessage: true };
    events.emit('stageStart', {});
    stage.player.armor = 30;
    step(4);
    stage.climax.ready = true;
    step(4);
    stage.scoring.combo = 12;
    step(4);
    const said = hud.lines.map((l) => l.text);
    expect(said.some((t) => texts('gen.lowArmor').includes(t))).toBe(true);
    expect(said.some((t) => texts('gen.climaxReady').includes(t))).toBe(true);
    expect(said.some((t) => texts('gen.combo10').includes(t))).toBe(true);
    expect(said.filter((t) => texts('gen.lowArmor').includes(t)).length).toBe(1);
  });

  it('legacy i18n radio keys still work', () => {
    const { events, hud, radio, step } = setup();
    events.emit('stageStart', {});
    registerStrings('en', { 'r.legacyTest.line': ['BOSS', 'An old unvoiced line.'] });
    expect(radio.say('r.legacyTest.line')).toBe(true);
    expect(radio.say('r.nope.missing')).toBe(false);
    step(0.5);
    expect(hud.lines.at(-1)).toMatchObject({ who: 'BOSS', text: 'An old unvoiced line.' });
  });
});

describe('AudioEngine voice API without Web Audio', () => {
  it('is a safe no-op', async () => {
    const a = new AudioEngine();
    expect(a.playVoice(null, { callsign: 'HAWK' })).toBeNull();
    expect(a.playVoice({ duration: 1 })).toBeNull();
    await expect(a.decodeVoice(new ArrayBuffer(8))).resolves.toBeNull();
  });
});

/** Parse MPEG audio frames: {sampleRate, mono, frames, samples}. */
function parseMp3(buf) {
  let p = 0;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) p = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  let frames = 0;
  let sampleRate = 0;
  let mono = true;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) break;
    const ver = (buf[p + 1] >> 3) & 3;
    const layer = (buf[p + 1] >> 1) & 3;
    if (layer !== 1 || ver === 1) break;
    const kb = KBPS[ver === 3 ? 1 : 2][buf[p + 2] >> 4];
    sampleRate = RATES[ver][(buf[p + 2] >> 2) & 3];
    const pad = (buf[p + 2] >> 1) & 1;
    mono = mono && (buf[p + 3] >> 6) === 3;
    const len = Math.floor(((ver === 3 ? 144 : 72) * kb * 1000) / sampleRate) + pad;
    if (!len) break;
    p += len;
    frames++;
  }
  return { sampleRate, mono, frames, samples: frames * 576, end: p, size: buf.length };
}

describe('voice clips (public/audio/voice)', () => {
  it('manifest exists and voices every line of lines.json (and radioLines.json)', () => {
    expect(manifest, 'run: python3 scripts/voices/generate.py').toBeTruthy();
    expect(manifest.version).toBe(1);
    for (const table of [LINES, STAGE_LINES]) {
      for (const [key, line] of Object.entries(table)) {
        if (table === STAGE_LINES && key in LINES) continue; // lines.json wins
        const m = manifest.lines[key];
        expect(m, `${key} not voiced — run scripts/voices/generate.py`).toBeTruthy();
        expect(m.variants.length, key).toBe(line.variants.length);
        line.variants.forEach((v, i) => {
          const mv = m.variants[i];
          expect(mv, `${key}[${i}]`).toBeTruthy();
          expect(mv.en, `${key}[${i}] voiced from stale text`).toBe(v.en);
          expect(existsSync(join(VOICE_DIR, mv.file)), mv.file).toBe(true);
          expect(mv.dur).toBeGreaterThan(0.4);
          expect(mv.dur).toBeLessThan(6);
        });
      }
    }
    for (const [id, s] of Object.entries(SPEAKERS)) expect(manifest.speakers[id]?.callsign).toBe(s.callsign);
  });

  it('clips are valid mono 24 kHz MP3s matching the manifest, 2 MB total at most', () => {
    const files = readdirSync(VOICE_DIR).filter((f) => f.endsWith('.mp3'));
    const referenced = new Set(Object.values(manifest.lines).flatMap((l) => l.variants.filter(Boolean).map((v) => v.file)));
    let total = 0;
    for (const f of files) {
      expect(referenced.has(f), `orphan clip ${f}`).toBe(true);
      total += statSync(join(VOICE_DIR, f)).size;
    }
    expect(total).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(manifest.totalBytes).toBe(total);
    for (const line of Object.values(manifest.lines)) {
      for (const v of line.variants) {
        if (!v) continue;
        const buf = readFileSync(join(VOICE_DIR, v.file));
        expect(buf.length).toBe(v.bytes);
        const info = parseMp3(buf);
        expect(info.sampleRate, v.file).toBe(24000);
        expect(info.mono, v.file).toBe(true);
        expect(info.end, `${v.file} frames cover the file`).toBeGreaterThanOrEqual(info.size - 4);
        // frame count vs. duration (encoder delay/padding + the info frame < 0.15 s)
        expect(Math.abs(info.samples / 24000 - v.dur), v.file).toBeLessThan(0.15);
      }
    }
  });
});
