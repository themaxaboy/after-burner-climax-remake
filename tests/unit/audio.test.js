// Unit tests for the audio subsystem's pure helpers (node env, no Web Audio).
import { describe, it, expect } from 'vitest';
import {
  noteToMidi,
  noteToFreq,
  midiToFreq,
  pitchClassOf,
  placePitchClass,
  parseChord,
  chordPitchClasses,
  dopplerRate,
  dopplerRateVec,
  timeScaleToCutoff,
  timeScaleToRate,
  stepDuration,
  stepTime,
  StepClock,
  mulberry32,
  hashString,
  fillBrown,
  fillPink,
  generateImpulseResponse,
  crossfadeLoop,
  analyzeChannels,
  makeDriveCurve,
  makeSoftClipCurve,
  makeCrackle
} from '../../src/audio/synth.js';
import {
  TRACKS,
  SONGS,
  TRACK_IDS,
  validateSong,
  compileSong,
  parseCharPattern,
  parseTokens,
  patternLength,
  stepsPerBar,
  layerActive
} from '../../src/audio/music.js';
import { SFX_DEFS, SOUND_NAMES, LOOP_NAMES } from '../../src/audio/sfxBank.js';
import { DRUM_DEFS } from '../../src/audio/instruments.js';
import { AudioEngine } from '../../src/audio/index.js';
import { loopOffset } from '../../src/audio/audio.js';
import { LoopGate, BurstGate, ALARM_GATE, GUN_GATE, AUTO_BURST } from '../../src/audio/loopGates.js';
import { warnQualifies, WARN_TGO, URGENT_TGO } from '../../src/states/stage/enemyOps.js';

const close = (a, b, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('note / chord math', () => {
  it('converts note names to midi and frequency', () => {
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('C#3')).toBe(49);
    expect(noteToMidi('Db3')).toBe(49);
    expect(noteToMidi('Bb2')).toBe(46);
    expect(noteToMidi('E#6')).toBe(noteToMidi('F6'));
    expect(noteToMidi('C-1')).toBe(0);
    close(noteToFreq('A4'), 440);
    close(noteToFreq('C4'), 261.6256);
    close(noteToFreq('E2'), 82.4069);
    close(midiToFreq(81), 880);
    expect(Number.isNaN(noteToMidi('H2'))).toBe(true);
    expect(Number.isNaN(noteToFreq('x'))).toBe(true);
  });

  it('parses pitch classes and places them into windows', () => {
    expect(pitchClassOf('F#')).toBe(6);
    expect(pitchClassOf('Bb')).toBe(10);
    expect(pitchClassOf('Cb')).toBe(11);
    expect(placePitchClass(4, 33)).toBe(40); // E into A1..G#2 -> E2
    expect(placePitchClass(9, 33)).toBe(33); // A -> A1
    for (let pc = 0; pc < 12; pc++) {
      const m = placePitchClass(pc, 40);
      expect(m).toBeGreaterThanOrEqual(40);
      expect(m).toBeLessThanOrEqual(51);
      expect(m % 12).toBe(pc);
    }
  });

  it('parses chord symbols', () => {
    expect(parseChord('Em')).toMatchObject({ root: 4, bass: 4, intervals: [0, 3, 7] });
    expect(parseChord('F#m7')).toMatchObject({ root: 6, intervals: [0, 3, 7, 10] });
    expect(parseChord('G/B')).toMatchObject({ root: 7, bass: 11, intervals: [0, 4, 7] });
    expect(parseChord('E5').intervals).toEqual([0, 7]);
    expect(parseChord('Gsus4').intervals).toEqual([0, 5, 7]);
    expect(chordPitchClasses(parseChord('Cmaj7'))).toEqual([0, 4, 7, 11]);
    expect(parseChord('Xm')).toBeNull();
    expect(parseChord('Cwhatever')).toBeNull();
  });
});

describe('doppler', () => {
  const L = [0, 0, 0, 0, 0, 0];
  it('is 1 for stationary source and listener', () => {
    expect(dopplerRate(...L, 100, 0, 0, 0, 0, 0)).toBe(1);
  });
  it('raises pitch for an approaching source and lowers it when receding', () => {
    close(dopplerRate(...L, 100, 0, 0, -100, 0, 0), 343 / 243);
    close(dopplerRate(...L, 100, 0, 0, 100, 0, 0), 343 / 443);
  });
  it('accounts for listener motion', () => {
    close(dopplerRate(0, 0, 0, 50, 0, 0, 100, 0, 0, 0, 0, 0), (343 + 50) / 343);
    close(dopplerRate(0, 0, 0, -50, 0, 0, 100, 0, 0, 0, 0, 0), (343 - 50) / 343);
  });
  it('ignores the perpendicular velocity component', () => {
    close(dopplerRate(...L, 100, 0, 0, 0, 0, 300), 1);
  });
  it('clamps to 0.5..2 (and handles supersonic sources)', () => {
    expect(dopplerRate(...L, 100, 0, 0, -340, 0, 0)).toBe(2);
    expect(dopplerRate(...L, 100, 0, 0, -500, 0, 0)).toBe(2);
    expect(dopplerRate(...L, 100, 0, 0, 400, 0, 0)).toBe(0.5);
    expect(dopplerRate(0, 0, 0, -400, 0, 0, 100, 0, 0, 0, 0, 0)).toBe(0.5);
  });
  it('vector wrapper matches scalar form and tolerates missing velocities', () => {
    const r = dopplerRateVec({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 30, y: 40, z: 0 }, { x: -30, y: -40, z: 0 });
    close(r, dopplerRate(0, 0, 0, 0, 0, 10, 30, 40, 0, -30, -40, 0));
    expect(dopplerRateVec({ x: 0, y: 0, z: 0 }, null, { x: 5, y: 0, z: 0 }, undefined)).toBe(1);
  });
});

describe('time scale mapping', () => {
  it('opens the world filter at 1 and closes to ~1.2 kHz at 0.3', () => {
    expect(timeScaleToCutoff(1)).toBeGreaterThanOrEqual(18000);
    close(timeScaleToCutoff(0.3), 1200, 1);
    close(timeScaleToCutoff(0.1), 1200, 1);
    expect(timeScaleToCutoff(0.6)).toBeGreaterThan(timeScaleToCutoff(0.4));
  });
  it('pitch factor is sqrt(ts)', () => {
    close(timeScaleToRate(0.25), 0.5);
    close(timeScaleToRate(1), 1);
    close(timeScaleToRate(0.3), Math.sqrt(0.3));
    expect(timeScaleToRate(0)).toBeGreaterThan(0);
  });
});

describe('scheduler timing', () => {
  it('computes step durations', () => {
    close(stepDuration(150, 4), 0.1);
    close(stepDuration(120, 4), 0.125);
    close(stepDuration(72, 4), 60 / 72 / 4);
  });
  it('stepTime applies swing to odd steps only', () => {
    close(stepTime(1, 4, 150), 1.4);
    close(stepTime(0, 3, 150, 4, 0.2), 0.3 + 0.02);
    close(stepTime(0, 2, 150, 4, 0.2), 0.2);
  });
  it('StepClock yields each step exactly once inside the look-ahead window', () => {
    const clock = new StepClock(150, 4, 10);
    const seen = [];
    const push = (s, t) => seen.push([s, t]);
    expect(clock.advance(10.12, push)).toBe(2); // steps at 10.0 and 10.1
    expect(clock.advance(10.12, push)).toBe(0); // idempotent for the same window
    expect(clock.advance(10.35, push)).toBe(2); // 10.2, 10.3
    expect(seen.map((x) => x[0])).toEqual([0, 1, 2, 3]);
    seen.forEach(([s, t]) => close(t, 10 + s * 0.1, 1e-9));
  });
  it('StepClock does not drift over long runs', () => {
    const clock = new StepClock(156, 4, 0);
    let lastT = 0;
    clock.advance(600, (s, t) => {
      lastT = t;
    });
    close(lastT, (clock.step - 1) * stepDuration(156, 4), 1e-9);
  });
});

describe('song data', () => {
  it('has every required track id', () => {
    expect(TRACK_IDS.sort()).toEqual(['anthem', 'results', 'stage1', 'stage2', 'stage3', 'title']);
  });

  it.each(TRACK_IDS)('%s validates and compiles', (id) => {
    const song = SONGS[id];
    expect(validateSong(song)).toEqual([]);
    const c = compileSong(song);
    expect(c.order.length).toBe(song.arrangement.length);
    let events = 0;
    for (const sec of Object.values(c.sections)) for (const t of sec.tracks) events += t.events.filter(Boolean).length;
    expect(events).toBeGreaterThan(50);
  });

  it.each(TRACK_IDS)('%s sections have patterns of consistent step length', (id) => {
    const song = SONGS[id];
    const spb = stepsPerBar(song);
    for (const [name, sec] of Object.entries(song.sections)) {
      const steps = sec.bars * spb;
      expect(steps % sec.chords.length, `${id}/${name} chords`).toBe(0);
      for (const [trk, pat] of Object.entries(sec.patterns)) {
        if (pat === 'auto') continue;
        const len = patternLength(trk, pat);
        expect(len, `${id}/${name}/${trk}`).toBeGreaterThan(0);
        expect(steps % len, `${id}/${name}/${trk} len ${len} vs ${steps}`).toBe(0);
      }
    }
  });

  it('tempos: arcade tracks ~150-160 BPM, anthem 72 BPM', () => {
    for (const id of ['title', 'stage1', 'stage2', 'stage3', 'results']) {
      expect(SONGS[id].bpm).toBeGreaterThanOrEqual(150);
      expect(SONGS[id].bpm).toBeLessThanOrEqual(160);
    }
    expect(SONGS.anthem.bpm).toBe(72);
  });

  it('melodies stay within a sane range and melodic notes parse', () => {
    for (const id of TRACK_IDS) {
      for (const sec of Object.values(SONGS[id].sections)) {
        for (const trk of ['lead', 'horn']) {
          if (!sec.patterns[trk]) continue;
          for (const t of parseTokens(sec.patterns[trk])) {
            if (t.value === '.' || t.value === '-') continue;
            const m = noteToMidi(t.value);
            expect(m).toBeGreaterThanOrEqual(55);
            expect(m).toBeLessThanOrEqual(96);
          }
        }
      }
    }
  });

  it('validator catches broken songs', () => {
    const bad = {
      id: 'bad',
      bpm: 150,
      sections: {
        a: { bars: 1, chords: ['Em', 'Q'], patterns: { kick: 'x..', lead: 'E5:4 Z9:4', nope: 'x' } }
      },
      arrangement: ['a', 'b'],
      loop: 5
    };
    const errs = validateSong(bad).join('\n');
    expect(errs).toMatch(/bad chord "Q"/);
    expect(errs).toMatch(/kick length 3 does not divide 16/);
    expect(errs).toMatch(/bad note "Z9"/);
    expect(errs).toMatch(/unknown track "nope"/);
    expect(errs).toMatch(/missing section "b"/);
    expect(errs).toMatch(/loop index 5/);
    expect(() => compileSong(bad)).toThrow();
  });

  it('parses char and token patterns', () => {
    expect(parseCharPattern('x... | x.x.')).toEqual(['x', '.', '.', '.', 'x', '.', 'x', '.']);
    expect(parseCharPattern(['x.', 'X-'])).toEqual(['x', '.', 'X', '-']);
    expect(parseTokens('E5:4 . G5:2 -:3 | 12')).toEqual([
      { value: 'E5', len: 4 },
      { value: '.', len: 1 },
      { value: 'G5', len: 2 },
      { value: '-', len: 3 },
      { value: '12', len: 1 }
    ]);
    expect(patternLength('lead', 'E5:4 . G5:2 -:3')).toBe(10);
    expect(patternLength('kick', 'x...x...')).toBe(8);
  });

  it('compiles ties, chord-relative bass and auto pads', () => {
    const song = {
      id: 't',
      bpm: 150,
      sections: {
        s: {
          bars: 2,
          chords: ['A', 'E'],
          patterns: { lead: 'A4:2 - . C5:12 . . .:14', bass: '0:8 12:8', pad: 'auto', guitar: 'X---x.x.' }
        }
      },
      arrangement: ['s'],
      loop: 0
    };
    const c = compileSong(song).sections.s;
    const tr = (n) => c.tracks.find((t) => t.name === n).events;
    const lead = tr('lead');
    expect(lead[0].len).toBe(3); // A4:2 + tie
    close(lead[0].freq, 440);
    expect(lead[3]).toBeNull();
    expect(lead[4].len).toBe(12);
    const bass = tr('bass');
    close(bass[0].freq, midiToFreq(33)); // A1
    close(bass[8].freq, midiToFreq(45)); // +12
    close(bass[16].freq, midiToFreq(40)); // E2 (second chord)
    const pad = tr('pad');
    expect(pad[0].len).toBe(16);
    expect(pad[16].len).toBe(16);
    expect(pad.filter(Boolean).length).toBe(2);
    const gtr = tr('guitar');
    expect(gtr[0]).toMatchObject({ len: 4, muted: false });
    expect(gtr[4]).toMatchObject({ len: 1, muted: true });
    expect(gtr[8]).toMatchObject({ len: 4 }); // pattern repeats
  });

  it('layer thresholds: lead + extra drums only above 0.6', () => {
    expect(TRACKS.lead.layer).toBe(0.6);
    expect(layerActive(TRACKS.lead.layer, 0.6)).toBe(false);
    expect(layerActive(TRACKS.lead.layer, 0.61)).toBe(true);
    expect(layerActive(TRACKS.tom.layer, 0.8)).toBe(true);
    expect(layerActive(0, 0)).toBe(true);
  });
});

describe('dsp generators', () => {
  it('prng is deterministic and in [0,1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(hashString('Maverick')).toBe(hashString('Maverick'));
    expect(hashString('Maverick')).not.toBe(hashString('Rooster'));
  });

  it('noise generators stay bounded', () => {
    const rng = mulberry32(1);
    const br = fillBrown(new Float32Array(48000), rng);
    const pk = fillPink(new Float32Array(48000), rng);
    expect(analyzeChannels([br]).peak).toBeLessThan(1.5);
    expect(analyzeChannels([pk]).peak).toBeLessThan(1.5);
    expect(analyzeChannels([pk]).rms).toBeGreaterThan(0.01);
  });

  it('reverb impulse response decays and is stereo', () => {
    const ir = generateImpulseResponse(22050, 1.8);
    expect(ir.length).toBe(2);
    expect(ir[0].length).toBe(Math.floor(22050 * 1.8));
    const n = ir[0].length;
    const head = analyzeChannels([ir[0].subarray(0, n / 10)]).rms;
    const tail = analyzeChannels([ir[0].subarray(n - n / 10)]).rms;
    expect(head).toBeGreaterThan(0.01);
    expect(tail).toBeLessThan(head / 20);
    expect(ir[0][500]).not.toBe(ir[1][500]); // decorrelated channels
  });

  it('crossfadeLoop makes the wrap point continuous', () => {
    const sr = 1000;
    const d = new Float32Array(1200);
    for (let i = 0; i < d.length; i++) d[i] = Math.sin((i / sr) * 2 * Math.PI * 3.3) + i * 0.001; // not periodic
    const loopStart = 100;
    const loopEnd = 1200;
    crossfadeLoop([d], loopStart, loopEnd, 80);
    const jump = Math.abs(d[loopEnd - 1] - d[loopStart - 1]);
    expect(jump).toBeLessThan(0.02); // end sample ~ the sample that precedes loopStart
  });

  it('drive curve is odd, monotonic and bounded; soft clip is transparent below the knee', () => {
    const c = makeDriveCurve(5, 1025);
    close(c[512], 0, 1e-6);
    close(c[0], -1, 1e-6);
    close(c[1024], 1, 1e-6);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    const s = makeSoftClipCurve(4097, 0.8, 0.98);
    close(s[2048 + 1024], 0.5, 1e-6); // x = 0.5 -> 0.5
    expect(s[4096]).toBeLessThan(0.98);
    expect(s[0]).toBeGreaterThan(-0.98);
  });

  it('crackle is sparse and non-silent', () => {
    const c = makeCrackle(44100, 44100, mulberry32(3), { rate: 100 });
    const nz = c.filter((v) => v !== 0).length;
    expect(nz).toBeGreaterThan(100);
    expect(nz).toBeLessThan(44100 / 2);
  });
});

describe('sound bank definitions', () => {
  const REQUIRED = [
    'vulcan', 'missileLaunch', 'lockOn', 'lockTone', 'missileAlert', 'radarWarning', 'explosionSmall',
    'explosionLarge', 'hit', 'playerHit', 'flare', 'roll', 'climaxStart', 'climaxEnd', 'sonicBoom', 'flyby',
    'catapult', 'uiMove', 'uiSelect', 'uiBack', 'stageClear', 'combo', 'eoAlert', 'lowAltitude', 'gLoad'
  ];
  it('defines every required sound', () => {
    for (const n of REQUIRED) {
      expect(SOUND_NAMES, n).toContain(n);
      expect(typeof SFX_DEFS[n].render).toBe('function');
    }
    for (const n of ['vulcan', 'lockTone', 'missileAlert']) expect(LOOP_NAMES).toContain(n);
  });
  it('definitions are well formed', () => {
    for (const [n, d] of Object.entries({ ...SFX_DEFS, ...DRUM_DEFS })) {
      expect(d.dur, n).toBeGreaterThan(0);
      expect(['world', 'ui', 'voice', 'music'], n).toContain(d.bus);
      expect([1, 2], n).toContain(d.channels);
      if (d.loop) {
        expect(d.loop.start, n).toBeGreaterThan(0);
        expect(d.loop.start + (d.loop.fade ?? 0.04), n).toBeLessThan(d.dur);
      }
      if (d.tail) expect(SFX_DEFS[d.tail], n).toBeDefined();
    }
  });
});

describe('AudioEngine without Web Audio', () => {
  it('every method is a safe no-op before/without init', async () => {
    const a = new AudioEngine();
    const v = { x: 1, y: 2, z: 3 };
    expect(a.isReady).toBe(false);
    expect(() => {
      a.setVolumes({ master: 0.5, music: 2 });
      a.setListener(v, v, v, v);
      a.setEngine({ throttle: 1, afterburner: 1, speed: 400, gLoad: 9 });
      a.setTimeScale(0.3);
      a.startLoop('vulcan');
      a.stopLoop('vulcan');
      a.music.setIntensity(0.9);
      a.music.stop();
      a.update(0.016);
      a.radio('Hawk');
      a.stopAll();
    }).not.toThrow();
    expect(a.play('explosionLarge', { position: v })).toBeNull();
    expect(a.music.play('stage1')).toBe(false); // remembered until ready
    expect(a.music.currentTrack).toBe('stage1');
    expect(a.getVolumes().music).toBe(1);
    await expect(a.suspend()).resolves.toBeUndefined();
    await expect(a.resume()).resolves.toBeUndefined();
    await expect(a.init()).resolves.toBe(false); // no AudioContext in node
    await expect(a.init()).resolves.toBe(false); // safe twice
    expect(a.isReady).toBe(false);
  });

  it('startLoop offset / resume options are safe no-ops before init', () => {
    const a = new AudioEngine();
    expect(a.startLoop('vulcan', { resume: true })).toBe(false);
    expect(a.startLoop('missileAlert', { offset: 0.5, gain: 0.5 })).toBe(false);
    expect(a.startLoop('missileAlert', { offset: -3 })).toBe(false);
    expect(a.isLooping('vulcan')).toBe(false);
    expect(a.stopLoop('missileAlert')).toBe(false);
  });
});

describe('loop start offset', () => {
  const entry = { loopStart: 0.3, loopEnd: 2.3 };
  it('resume starts at the loop start, offset is clamped into the buffer', () => {
    expect(loopOffset(entry)).toBe(0);
    expect(loopOffset(entry, {})).toBe(0);
    expect(loopOffset(entry, { resume: true })).toBe(0.3);
    expect(loopOffset(entry, { offset: 1.2 })).toBe(1.2);
    expect(loopOffset(entry, { offset: -1 })).toBe(0);
    expect(loopOffset(entry, { offset: NaN })).toBe(0);
    expect(loopOffset(entry, { offset: 9 })).toBe(0.3); // past the end -> loop start
    expect(loopOffset(null, { resume: true })).toBe(0);
  });
});

describe('loop gates', () => {
  /** Run a gate for `secs` at 60 Hz with a fixed request; returns the actions seen. */
  const run = (gate, secs, want, cut = false) => {
    const acts = [];
    for (let i = 0; i < Math.round(secs * 60); i++) {
      const a = gate.update(1 / 60, want, cut);
      if (a) acts.push(a);
    }
    return acts;
  };

  it('missile alarm: at least 0.8 s on, off 0.4 s after the last threat, resumes within 1.5 s', () => {
    const g = new LoopGate(ALARM_GATE);
    expect(g.update(1 / 60, true)).toBe('start');
    expect(g.on).toBe(true);
    run(g, 0.1, true);
    // a threat that vanishes early still keeps the tone for the minimum on-time
    expect(run(g, 0.5, false)).toEqual([]);
    expect(run(g, 0.3, false)).toEqual(['stop']);
    expect(g.on).toBe(false);
    // back within 1.5 s -> resume (no intro replay)
    run(g, 1.0, false);
    expect(g.update(1 / 60, true)).toBe('resume');
    run(g, 2, true);
    // a flickering threat (gaps < 0.4 s) never stops the tone
    for (let k = 0; k < 5; k++) {
      expect(run(g, 0.3, false)).toEqual([]);
      run(g, 0.1, true);
    }
    expect(run(g, 0.45, false)).toEqual(['stop']);
    // long silence -> a fresh start
    run(g, 2, false);
    expect(g.update(1 / 60, true)).toBe('start');
    g.reset();
    expect(g.on).toBe(false);
    expect(g.update(1 / 60, true)).toBe('start');
  });

  it('vulcan: at least 0.35 s on, off 0.25 s after the trigger, resumes within 0.4 s', () => {
    const g = new LoopGate(GUN_GATE);
    expect(g.update(1 / 60, true)).toBe('start'); // a single-frame tap
    expect(run(g, 0.3, false)).toEqual([]);
    expect(run(g, 0.1, false)).toEqual(['stop']);
    expect(run(g, 0.2, false)).toEqual([]);
    expect(g.update(1 / 60, true)).toBe('resume');
    run(g, 1, true);
    // trigger flicker shorter than the release keeps the loop running
    for (let k = 0; k < 10; k++) {
      expect(run(g, 0.2, false)).toEqual([]);
      run(g, 1 / 60, true);
    }
    // a deliberate pause (cut) stops right away once the minimum on-time is met
    expect(g.update(1 / 60, false, true)).toBe('stop');
    run(g, 0.3, false);
    expect(g.update(1 / 60, true)).toBe('resume');
    expect(run(g, 0.2, false, true)).toEqual([]); // still inside the minimum on-time
    expect(run(g, 0.2, false, true)).toEqual(['stop']);
    run(g, 0.5, false);
    expect(g.update(1 / 60, true)).toBe('start');
  });

  it('auto-fire bursts: 1.4 s on, 0.3 s off; a natural gap counts as a pause', () => {
    const b = new BurstGate(AUTO_BURST);
    const dt = 1 / 60;
    let fired = 0, pauses = 0, prev = false;
    const onRuns = [];
    let run = 0;
    for (let i = 0; i < 60 * 6; i++) {
      const f = b.update(dt, true);
      if (f) fired++;
      if (f) run++;
      if (!f && prev) {
        pauses++;
        onRuns.push(run);
        run = 0;
      }
      prev = f;
    }
    // 6 s of wanting fire -> 1.7 s cycles: 3 full pauses, ~82 % duty
    expect(pauses).toBe(3);
    for (const r of onRuns) expect(Math.abs(r * dt - AUTO_BURST.on)).toBeLessThan(0.05);
    expect(fired * dt).toBeGreaterThan(4.5);
    expect(fired * dt).toBeLessThan(5.2);
    // pause length
    const c = new BurstGate(AUTO_BURST);
    let t = 0;
    while (c.update(dt, true)) t += dt;
    expect(c.pausing).toBe(true);
    let off = 0;
    while (!c.update(dt, true)) off += dt;
    expect(Math.abs(off - AUTO_BURST.off)).toBeLessThan(0.05);
    // flicker inside a burst does not reset the burst clock; a long gap does
    const d = new BurstGate(AUTO_BURST);
    d.update(dt, true);
    for (let i = 0; i < 30; i++) d.update(dt, i % 3 !== 0);
    expect(d.phase).toBe(1);
    expect(d.t).toBeGreaterThan(0.45);
    for (let i = 0; i < 20; i++) d.update(dt, false);
    expect(d.phase).toBe(0);
    expect(d.update(dt, true)).toBe(true);
    expect(d.t).toBe(0);
    expect(d.update(dt, false)).toBe(false);
  });
});

describe('missile warning gate', () => {
  it('warns only for terminal-phase or close missiles, not during the cinematic arc', () => {
    expect(warnQualifies(null, 0.5)).toBe(false);
    expect(warnQualifies({ phase: 0 }, 4)).toBe(false); // arc, far
    expect(warnQualifies({ phase: 0 }, WARN_TGO + 0.1)).toBe(false);
    expect(warnQualifies({ phase: 0 }, WARN_TGO - 0.1)).toBe(true);
    expect(warnQualifies({ phase: 1 }, 5)).toBe(true); // terminal
    expect(WARN_TGO).toBeCloseTo(2.2);
    expect(URGENT_TGO).toBeLessThan(WARN_TGO);
  });
});

describe('weapon / warning sound tuning', () => {
  it('missile tone: one 0.5 s cycle per loop, quiet, ducked by the radio', () => {
    const d = SFX_DEFS.missileAlert;
    close(d.dur - d.loop.start, 0.5, 1e-9);
    expect(d.gain).toBeLessThanOrEqual(0.12);
    expect(d.duck).toBe(true);
  });
  it('vulcan loop and tail levels, hit rate limit', () => {
    const v = SFX_DEFS.vulcan, tail = SFX_DEFS[v.tail];
    expect(v.gain).toBeLessThanOrEqual(0.25);
    expect(tail.gain).toBeLessThan(v.gain);
    expect(tail.maxInstances).toBe(1);
    // the loop region holds a whole number of 10 ms rounds (100 rounds/s)
    const rounds = (v.dur - v.loop.start) / 0.01;
    close(rounds, Math.round(rounds), 1e-6);
    const h = SFX_DEFS.hit;
    expect(h.gain).toBeLessThanOrEqual(0.25);
    expect(h.minInterval).toBeGreaterThanOrEqual(0.09);
  });
});
