/**
 * music.js - data-driven song sequencer with a look-ahead scheduler.
 *
 * Songs (src/audio/songs/*.js) are plain data:
 *   { id, title, bpm, stepsPerBeat=4, beatsPerBar=4, swing=0,
 *     layers?: {track: minIntensity}, mix?: {track: gainMultiplier},
 *     sections: { name: { bars, chords: [...], patterns: { track: pattern } } },
 *     arrangement: [sectionName...], loop: indexToLoopBackTo }
 *
 * Pattern syntax (whitespace and '|' are ignored; a pattern repeats to fill its section,
 * so its length must divide the section's step count):
 *   drum / chord tracks - one char per step:
 *       '.' rest   '-' hold (chord tracks)   'x' hit   'X' accent
 *       snare 'g' ghost | hat 'o'/'O' open | tom 'h' 'm' 'l' (upper = accent) | timpani 'r' roll
 *       guitar: 'x' palm-muted chug, 'X' open power chord (held by following '-')
 *       pad/strings/brass may also be the string 'auto' (strike on every chord change)
 *   token tracks - whitespace separated tokens 'VALUE[:steps]':
 *       lead/horn: note names ('E5:4'), '.' rest, '-' tie
 *       bass/sub : semitone offsets from the chord's bass note ('0', '12', '-5') or note names
 *       arp      : chord-tone index (0 = root, 1 = next chord tone, ... wraps up octaves)
 *       swell    : 'x:16' = reverse cymbal peaking 16 steps later
 *
 * Scheduling: a 25 ms setInterval schedules every step whose time falls within
 * currentTime + 0.12 s, using AudioContext time (never per frame).
 */
import {
  StepClock,
  chordPitchClasses,
  clamp,
  getOfflineContextClass,
  midiToFreq,
  mulberry32,
  noteToMidi,
  parseChord,
  placePitchClass,
  startRendering,
  stepDuration
} from './synth.js';
import {
  playBass,
  playBrass,
  playHorn,
  playPad,
  playPluck,
  playPowerChord,
  playSample,
  playStrings,
  playSub,
  playSupersaw
} from './instruments.js';
import { SONGS, TRACK_IDS } from './songs/index.js';

export { SONGS, TRACK_IDS };

/* ----------------------------------------------------------- track table */

/**
 * kind: drum | chord | bass | melody | arp | swell
 * gain: base mix level, send: reverb send, layer: min intensity (exclusive) to be audible
 */
export const TRACKS = {
  kick: { kind: 'drum', gain: 0.85, send: 0, chars: '.xX' },
  kick2: { kind: 'drum', gain: 0.34, send: 0, chars: '.xX', layer: 0.6 },
  snare: { kind: 'drum', gain: 0.7, send: 0.22, chars: '.xXg' },
  clap: { kind: 'drum', gain: 0.28, send: 0.25, chars: '.xX', layer: 0.6 },
  hat: { kind: 'drum', gain: 0.26, send: 0.05, chars: '.xXoO', pan: 0.25 },
  shaker: { kind: 'drum', gain: 0.12, send: 0.1, chars: '.xX', pan: -0.35, layer: 0.6 },
  ride: { kind: 'drum', gain: 0.16, send: 0.1, chars: '.xX', pan: 0.35, layer: 0.6 },
  crash: { kind: 'drum', gain: 0.3, send: 0.3, chars: '.xX', pan: -0.15 },
  tom: { kind: 'drum', gain: 0.5, send: 0.25, chars: '.hmlHML', layer: 0.6 },
  timpani: { kind: 'drum', gain: 0.7, send: 0.45, chars: '.xXr' },
  swell: { kind: 'swell', gain: 0.3, send: 0.35 },
  bass: { kind: 'bass', gain: 0.3, send: 0, low: 33 },
  sub: { kind: 'bass', gain: 0.3, send: 0.04, low: 31 },
  guitar: { kind: 'chord', gain: 0.2, send: 0.08, chars: '.-xX', layer: 0.15, low: 40 },
  pad: { kind: 'chord', gain: 0.075, send: 0.35, chars: '.-xX', duck: true, low: 55 },
  strings: { kind: 'chord', gain: 0.085, send: 0.5, chars: '.-xX', duck: true, low: 55 },
  brass: { kind: 'chord', gain: 0.1, send: 0.45, chars: '.-xX', low: 50 },
  lead: { kind: 'melody', gain: 0.16, send: 0.2, layer: 0.6, delay: 0.22 },
  horn: { kind: 'melody', gain: 0.21, send: 0.5 },
  arp: { kind: 'arp', gain: 0.075, send: 0.15, layer: 0.35, delay: 0.3, low: 57 }
};

const TOKEN_KINDS = { bass: 1, melody: 1, arp: 1, swell: 1 };
const MUSIC_TRIM = 0.42;

export function stepsPerBar(song) {
  return (song.beatsPerBar ?? 4) * (song.stepsPerBeat ?? 4);
}

/* ---------------------------------------------------------- pattern parse */

export function parseCharPattern(p) {
  const s = Array.isArray(p) ? p.join('') : String(p);
  return s.replace(/[\s|]/g, '').split('');
}

export function parseTokens(p) {
  const s = Array.isArray(p) ? p.join(' ') : String(p);
  const out = [];
  for (const tok of s.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const m = /^([^:]+)(?::(\d+))?$/.exec(tok);
    if (!m) out.push({ value: tok, len: NaN });
    else out.push({ value: m[1], len: m[2] ? parseInt(m[2], 10) : 1 });
  }
  return out;
}

/** Step length of a pattern for the given track (NaN when malformed). */
export function patternLength(track, pattern) {
  const def = TRACKS[track];
  if (!def) return NaN;
  if (pattern === 'auto') return 0;
  if (TOKEN_KINDS[def.kind]) return parseTokens(pattern).reduce((a, t) => a + t.len, 0);
  return parseCharPattern(pattern).length;
}

function isInt(v) {
  return /^[+-]?\d+$/.test(v);
}

function tokenError(kind, v) {
  if (v === '.' || v === '-') return null;
  switch (kind) {
    case 'melody':
      return Number.isFinite(noteToMidi(v)) ? null : `bad note "${v}"`;
    case 'bass':
      return isInt(v) || Number.isFinite(noteToMidi(v)) ? null : `bad bass token "${v}"`;
    case 'arp':
      return /^\d+$/.test(v) ? null : `bad arp index "${v}"`;
    case 'swell':
      return v === 'x' || v === 'X' ? null : `bad swell token "${v}"`;
    default:
      return `unknown token kind ${kind}`;
  }
}

/* ------------------------------------------------------------- validation */

/** Returns an array of human-readable problems (empty = valid). */
export function validateSong(song) {
  const errors = [];
  const id = song && song.id ? song.id : '?';
  const E = (msg) => errors.push(`${id}: ${msg}`);
  if (!song || typeof song !== 'object') return ['song is not an object'];
  if (!(song.bpm >= 40 && song.bpm <= 240)) E(`bpm ${song.bpm} out of range`);
  const spb = stepsPerBar(song);
  if (!Number.isInteger(spb) || spb < 1) E('bad stepsPerBeat/beatsPerBar');
  const sections = song.sections || {};
  if (!Object.keys(sections).length) E('no sections');
  for (const [name, sec] of Object.entries(sections)) {
    const where = `section "${name}"`;
    if (!Number.isInteger(sec.bars) || sec.bars < 1) {
      E(`${where}: bars must be a positive integer`);
      continue;
    }
    const steps = sec.bars * spb;
    if (!Array.isArray(sec.chords) || !sec.chords.length) E(`${where}: needs chords`);
    else {
      if (steps % sec.chords.length !== 0) E(`${where}: ${sec.chords.length} chords do not divide ${steps} steps`);
      for (const c of sec.chords) if (!parseChord(c)) E(`${where}: bad chord "${c}"`);
    }
    const pats = sec.patterns || {};
    if (!Object.keys(pats).length) E(`${where}: no patterns`);
    for (const [trk, pat] of Object.entries(pats)) {
      const def = TRACKS[trk];
      if (!def) {
        E(`${where}: unknown track "${trk}"`);
        continue;
      }
      if (pat === 'auto') {
        if (def.kind !== 'chord') E(`${where}: 'auto' only valid for chord tracks (${trk})`);
        continue;
      }
      const len = patternLength(trk, pat);
      if (!(len > 0)) {
        E(`${where}: track ${trk} has empty/malformed pattern`);
        continue;
      }
      if (steps % len !== 0) E(`${where}: track ${trk} length ${len} does not divide ${steps} steps`);
      if (TOKEN_KINDS[def.kind]) {
        for (const t of parseTokens(pat)) {
          if (!(t.len >= 1)) E(`${where}: track ${trk} bad token length in "${t.value}"`);
          const te = tokenError(def.kind, t.value);
          if (te) E(`${where}: track ${trk} ${te}`);
        }
      } else {
        for (const ch of parseCharPattern(pat)) {
          if (!def.chars.includes(ch)) E(`${where}: track ${trk} invalid char "${ch}"`);
        }
      }
    }
  }
  if (!Array.isArray(song.arrangement) || !song.arrangement.length) E('empty arrangement');
  else {
    for (const n of song.arrangement) if (!sections[n]) E(`arrangement references missing section "${n}"`);
    const loop = song.loop ?? 0;
    if (!Number.isInteger(loop) || loop < 0 || loop >= song.arrangement.length) E(`loop index ${loop} invalid`);
  }
  for (const k of Object.keys(song.layers || {})) if (!TRACKS[k]) E(`layers: unknown track ${k}`);
  for (const k of Object.keys(song.mix || {})) if (!TRACKS[k]) E(`mix: unknown track ${k}`);
  return errors;
}

/* ---------------------------------------------------------------- compile */

function voicing(chord, low, withBass = true) {
  const notes = chordPitchClasses(chord).map((pc) => placePitchClass(pc, low));
  notes.sort((a, b) => a - b);
  if (withBass) notes.unshift(placePitchClass(chord.bass, low - 12));
  return notes.map(midiToFreq);
}

function drumVel(c) {
  if (c === 'g') return 0.3;
  return c === c.toUpperCase() ? 1 : 0.78;
}

function compileSection(song, name, sec) {
  const spb = stepsPerBar(song);
  const steps = sec.bars * spb;
  const chords = sec.chords.map(parseChord);
  const span = steps / chords.length;
  const chordAt = new Array(steps);
  for (let i = 0; i < steps; i++) chordAt[i] = chords[Math.floor(i / span)];
  const tracks = [];

  for (const [trk, pat] of Object.entries(sec.patterns)) {
    const def = TRACKS[trk];
    const events = new Array(steps).fill(null);
    const chordEvent = (i, len, vel, muted) => {
      const ch = chordAt[i];
      if (trk === 'guitar') return { root: midiToFreq(placePitchClass(ch.root, def.low)), len, vel, muted };
      return { freqs: voicing(ch, def.low, true), len, vel, muted: false };
    };

    if (def.kind === 'drum') {
      const chars = parseCharPattern(pat);
      const L = chars.length;
      for (let i = 0; i < steps; i++) {
        const c = chars[i % L];
        if (c === '.' || c === '-') continue;
        const ev = { c, vel: drumVel(c), rate: 1, roll: c === 'r' };
        if (trk === 'timpani') {
          ev.rate = midiToFreq(placePitchClass(chordAt[i].root, 41)) / 110;
          if (ev.roll) {
            let a = i;
            while (a > 0 && chars[(a - 1) % L] === 'r') a--;
            let b = i;
            while (b + 1 < steps && chars[(b + 1) % L] === 'r') b++;
            ev.vel = 0.22 + (0.6 * (i - a + 1)) / (b - a + 1);
          }
        }
        events[i] = ev;
      }
    } else if (def.kind === 'chord') {
      if (pat === 'auto') {
        for (let i = 0; i < steps; i++) {
          if (i > 0 && chordAt[i] === chordAt[i - 1]) continue;
          let len = 1;
          while (i + len < steps && chordAt[i + len] === chordAt[i]) len++;
          events[i] = chordEvent(i, len, 0.8);
        }
      } else {
        const chars = parseCharPattern(pat);
        const L = chars.length;
        for (let i = 0; i < steps; i++) {
          const c = chars[i % L];
          if (c !== 'x' && c !== 'X') continue;
          let len = 1;
          while (i + len < steps && chars[(i + len) % L] === '-') len++;
          events[i] = chordEvent(i, len, c === 'X' ? 1 : 0.8, c === 'x');
        }
      }
    } else {
      const toks = parseTokens(pat);
      const L = toks.reduce((a, t) => a + t.len, 0);
      let prev = null;
      for (let rep = 0; rep * L < steps; rep++) {
        let pos = rep * L;
        for (const t of toks) {
          if (pos >= steps) break;
          const v = t.value;
          if (v === '-') {
            if (prev) prev.len += t.len;
          } else if (v === '.') {
            prev = null;
          } else {
            let ev = null;
            const ch = chordAt[pos];
            if (def.kind === 'melody') {
              ev = { freq: midiToFreq(noteToMidi(v)), len: t.len, vel: 0.85 };
            } else if (def.kind === 'bass') {
              const midi = isInt(v) ? placePitchClass(ch.bass, def.low) + parseInt(v, 10) : noteToMidi(v);
              ev = { freq: midiToFreq(midi), len: t.len, vel: pos % 4 === 0 ? 0.95 : 0.8 };
            } else if (def.kind === 'arp') {
              const idx = parseInt(v, 10);
              const ivs = ch.intervals;
              const midi = placePitchClass(ch.root, def.low) + ivs[idx % ivs.length] + 12 * Math.floor(idx / ivs.length);
              ev = { freq: midiToFreq(midi), len: t.len, vel: pos % 4 === 0 ? 0.9 : 0.7 };
            } else if (def.kind === 'swell') {
              ev = { len: t.len, vel: v === 'X' ? 1 : 0.8 };
            }
            events[pos] = ev;
            prev = ev;
          }
          pos += t.len;
        }
      }
    }
    tracks.push({ name: trk, def, events });
  }
  return { name, steps, tracks };
}

/** Compile a song into per-step event arrays. Throws when invalid. */
export function compileSong(song) {
  const errors = validateSong(song);
  if (errors.length) throw new Error(`Invalid song: ${errors.join('; ')}`);
  const sections = {};
  for (const [name, sec] of Object.entries(song.sections)) sections[name] = compileSection(song, name, sec);
  const trackNames = new Set();
  for (const s of Object.values(sections)) for (const t of s.tracks) trackNames.add(t.name);
  const layers = {};
  for (const n of trackNames) layers[n] = song.layers && n in song.layers ? song.layers[n] : TRACKS[n].layer ?? 0;
  return {
    id: song.id,
    title: song.title,
    bpm: song.bpm,
    stepsPerBeat: song.stepsPerBeat ?? 4,
    swing: song.swing ?? 0,
    sections,
    order: song.arrangement.map((n) => sections[n]),
    loop: song.loop ?? 0,
    trackNames: [...trackNames],
    layers,
    mix: song.mix || {}
  };
}

/** Is a track audible at an intensity? (threshold 0 = always) */
export function layerActive(threshold, intensity) {
  return threshold <= 0 || intensity > threshold;
}

/* ------------------------------------------------------------ song voice */

function makePingPong(ctx, time, feedback, wet, dest) {
  const input = ctx.createGain();
  const dl = ctx.createDelay(2);
  const dr = ctx.createDelay(2);
  dl.delayTime.value = time;
  dr.delayTime.value = time;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3200;
  const merger = ctx.createChannelMerger(2);
  const w = ctx.createGain();
  w.gain.value = wet;
  input.connect(dl);
  dl.connect(merger, 0, 0);
  dl.connect(dr);
  dr.connect(merger, 0, 1);
  dr.connect(lp);
  lp.connect(fb);
  fb.connect(dl);
  merger.connect(w);
  w.connect(dest);
  return input;
}

/**
 * One playing song. rig = { ctx, output, reverbInput, buffers: {name: AudioBuffer} }.
 */
export class SongInstance {
  constructor(rig, compiled, startTime, fadeIn, intensity, startIndex = 0) {
    const ctx = rig.ctx;
    this.ctx = ctx;
    this.rig = rig;
    this.song = compiled;
    this.id = compiled.id;
    this.buffers = rig.buffers || {};
    this.stepDur = stepDuration(compiled.bpm, compiled.stepsPerBeat);
    this.clock = new StepClock(compiled.bpm, compiled.stepsPerBeat, startTime, compiled.swing);
    this.rng = mulberry32(0x5eed);
    this.stopping = false;
    this.stopAt = Infinity;
    this.silent = false;
    this.arrIdx = clamp(startIndex | 0, 0, compiled.order.length - 1);
    this.sec = compiled.order[this.arrIdx];
    this.pos = 0;
    this._openHat = null;
    this._kicks = [];
    this._kickT = -1;

    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, ctx.currentTime);
    this.out.gain.setValueAtTime(0, startTime);
    this.out.gain.linearRampToValueAtTime(MUSIC_TRIM, startTime + Math.max(0.01, fadeIn));
    this.out.connect(rig.output);
    this.send = ctx.createGain();
    this.send.connect(rig.reverbInput || rig.output);

    // shared vibrato for lead/horn/brass (in cents)
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 5.3;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 7;
    this.lfo.connect(this.lfoDepth);
    this.lfo.start(startTime);

    this.parts = {};
    this.ducks = [];
    this.on = {};
    this.offUntil = {};
    for (const name of compiled.trackNames) this.parts[name] = this._makePart(name);
    this.setIntensity(intensity, ctx.currentTime, true);
  }

  _makePart(name) {
    const ctx = this.ctx;
    const def = TRACKS[name];
    const level = ctx.createGain();
    level.gain.value = 0;
    const trim = ctx.createGain();
    trim.gain.value = def.gain * (this.song.mix[name] ?? 1);
    level.connect(trim);
    let input = level;

    if (name === 'guitar') {
      // amp: drive -> waveshaper -> cabinet EQ -> double-tracked stereo
      input = ctx.createGain();
      input.gain.value = 2.2;
      const sh = ctx.createWaveShaper();
      sh.curve = GUITAR_CURVE();
      sh.oversample = '2x';
      const cab = ctx.createBiquadFilter();
      cab.type = 'lowpass';
      cab.frequency.value = 4200;
      cab.Q.value = 0.8;
      const scoop = ctx.createBiquadFilter();
      scoop.type = 'peaking';
      scoop.frequency.value = 800;
      scoop.Q.value = 1;
      scoop.gain.value = -4;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 90;
      input.connect(sh).connect(cab).connect(scoop).connect(hp);
      if (typeof ctx.createStereoPanner === 'function') {
        const pl = ctx.createStereoPanner();
        pl.pan.value = -0.65;
        const pr = ctx.createStereoPanner();
        pr.pan.value = 0.65;
        const dly = ctx.createDelay(0.1);
        dly.delayTime.value = 0.013;
        hp.connect(pl).connect(level);
        hp.connect(dly).connect(pr).connect(level);
      } else hp.connect(level);
    } else if (def.duck) {
      input = ctx.createGain();
      input.connect(level);
      this.ducks.push(input.gain);
    } else if (def.pan && typeof ctx.createStereoPanner === 'function') {
      input = ctx.createStereoPanner();
      input.pan.value = def.pan;
      input.connect(level);
    }

    trim.connect(this.out);
    if (def.send > 0) {
      const s = ctx.createGain();
      s.gain.value = def.send;
      trim.connect(s).connect(this.send);
    }
    if (def.delay) {
      const beat = 60 / this.song.bpm;
      trim.connect(makePingPong(ctx, beat * 0.75, 0.32, def.delay, this.out));
    }
    return { input, level, trim };
  }

  setIntensity(v, now, immediate = false) {
    for (const name of this.song.trackNames) {
      const on = layerActive(this.song.layers[name], v);
      if (!immediate && on === this.on[name]) continue;
      this.on[name] = on;
      const g = this.parts[name].level.gain;
      if (immediate) g.value = on ? 1 : 0;
      else {
        g.cancelScheduledValues(now);
        g.setTargetAtTime(on ? 1 : 0, now, on ? 0.12 : 0.35);
      }
      if (!on) this.offUntil[name] = now + (immediate ? 0 : 1.8);
    }
  }

  stop(now, fade) {
    if (this.stopping) return;
    this.stopping = true;
    this.stopAt = now + fade;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + Math.max(0.02, fade));
  }

  dispose() {
    try {
      this.lfo.stop();
    } catch (e) {
      /* already stopped */
    }
    this.out.disconnect();
    this.send.disconnect();
  }

  /** Schedule all steps up to `until`; drops (does not bunch) steps that are already late. */
  schedule(now, until) {
    if (this.clock.nextTime < now - 0.03) {
      this.silent = true;
      this.clock.advance(now, this._step, this);
      this.silent = false;
    }
    this.clock.advance(until, this._step, this);
  }

  _step(step, time) {
    const sec = this.sec;
    const i = this.pos;
    if (!this.silent && time < this.stopAt) {
      const tracks = sec.tracks;
      for (let k = 0; k < tracks.length; k++) {
        const tr = tracks[k];
        const ev = tr.events[i];
        if (ev !== null && (this.on[tr.name] || time < this.offUntil[tr.name])) this._trigger(tr.name, tr.def, ev, time);
      }
    }
    if (++this.pos >= sec.steps) {
      this.pos = 0;
      this.arrIdx++;
      if (this.arrIdx >= this.song.order.length) this.arrIdx = this.song.loop;
      this.sec = this.song.order[this.arrIdx];
    }
  }

  _duck(time) {
    for (let i = 0; i < this.ducks.length; i++) {
      const p = this.ducks[i];
      p.setTargetAtTime(0.35, time, 0.006);
      p.setTargetAtTime(1, time + 0.05, 0.09);
    }
  }

  _trigger(name, def, ev, time) {
    const ctx = this.ctx;
    const dest = this.parts[name].input;
    const dur = ev.len * this.stepDur;
    switch (def.kind) {
      case 'drum':
        this._drum(name, ev, time, dest);
        break;
      case 'bass':
        (name === 'sub' ? playSub : playBass)(ctx, dest, time, ev.freq, dur, ev.vel);
        break;
      case 'chord':
        if (name === 'guitar') playPowerChord(ctx, dest, time, ev.root, dur, ev.vel, ev.muted);
        else if (name === 'strings') playStrings(ctx, dest, time, ev.freqs, dur, ev.vel);
        else if (name === 'brass') playBrass(ctx, dest, time, ev.freqs, dur, ev.vel, this.lfoDepth);
        else playPad(ctx, dest, time, ev.freqs, dur, ev.vel);
        break;
      case 'melody':
        if (name === 'horn') playHorn(ctx, dest, time, ev.freq, dur, ev.vel, this.lfoDepth);
        else playSupersaw(ctx, dest, time, ev.freq, dur, ev.vel, this.lfoDepth);
        break;
      case 'arp':
        playPluck(ctx, dest, time, ev.freq, dur, ev.vel);
        break;
      case 'swell': {
        const buf = this.buffers.m_revCymbal;
        if (!buf) break;
        const peak = time + dur;
        const start = Math.max(time, peak - buf.duration);
        const offset = Math.max(0, buf.duration - (peak - start));
        playSample(ctx, dest, buf, start, ev.vel, 1, offset);
        break;
      }
      default:
        break;
    }
  }

  _drum(name, ev, time, dest) {
    const B = this.buffers;
    const ctx = this.ctx;
    let buf = null;
    let vel = ev.vel;
    switch (name) {
      case 'kick':
      case 'kick2': {
        // choke the previous kick (dense double-kick patterns would otherwise pile up sub energy)
        if (!B.m_kick) return;
        if (time - this._kickT > 0.001) {
          for (const g of this._kicks) g.gain.setTargetAtTime(0, time, 0.005);
          this._kicks.length = 0;
          this._kickT = time;
        }
        if (name === 'kick') this._duck(time);
        this._kicks.push(playSample(ctx, dest, B.m_kick, time, vel));
        return;
      }
      case 'snare':
        buf = B.m_snare;
        break;
      case 'clap':
        buf = B.m_clap;
        break;
      case 'hat':
        if (ev.c === 'o' || ev.c === 'O') {
          if (B.m_hatO) this._openHat = playSample(ctx, dest, B.m_hatO, time, vel * 0.8);
          return;
        }
        if (this._openHat) {
          this._openHat.gain.setTargetAtTime(0, time, 0.008);
          this._openHat = null;
    this._kicks = [];
    this._kickT = -1;
        }
        buf = B.m_hatC;
        vel *= 0.85 + 0.15 * this.rng();
        break;
      case 'shaker':
        buf = B.m_shaker;
        vel *= 0.8 + 0.2 * this.rng();
        break;
      case 'ride':
        buf = B.m_ride;
        break;
      case 'crash':
        buf = B.m_crash;
        break;
      case 'tom': {
        const c = ev.c.toLowerCase();
        buf = c === 'h' ? B.m_tomH : c === 'm' ? B.m_tomM : B.m_tomL;
        break;
      }
      case 'timpani':
        if (!B.m_timpani) return;
        if (ev.roll) {
          for (let k = 0; k < 3; k++) {
            playSample(ctx, dest, B.m_timpani, time + (k * this.stepDur) / 3, vel * (0.8 + 0.2 * this.rng()), ev.rate);
          }
          return;
        }
        playSample(ctx, dest, B.m_timpani, time, vel, ev.rate);
        return;
      default:
        return;
    }
    if (buf) playSample(ctx, dest, buf, time, vel);
  }
}

let guitarCurve = null;
function GUITAR_CURVE() {
  if (!guitarCurve) {
    const n = 2049;
    guitarCurve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      // asymmetric soft clip -> a little even-harmonic "tube" colour
      const y = Math.tanh(6 * x + 0.3) - Math.tanh(0.3);
      guitarCurve[i] = y / 1.3;
    }
  }
  return guitarCurve;
}

/* ------------------------------------------------------------- the player */

export class MusicPlayer {
  /** engine must expose: isReady, ctx, _musicRig() -> { output, reverbInput, buffers } */
  constructor(engine) {
    this.engine = engine;
    this.instances = [];
    this.current = null;
    this.intensity = 0.5;
    this.lookahead = 0.12;
    this.interval = 25;
    this._timer = null;
    this._pending = null;
    this._compiled = new Map();
    this._tick = this._tick.bind(this);
    // background tabs throttle timers to ~1 Hz: schedule further ahead while hidden
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        this.lookahead = document.hidden ? 1.5 : 0.12;
      });
    }
  }

  get trackIds() {
    return TRACK_IDS;
  }
  get currentTrack() {
    return this.current ? this.current.id : this._pending ? this._pending.trackId : null;
  }
  get isPlaying() {
    return !!this.current;
  }

  compiled(trackId) {
    let c = this._compiled.get(trackId);
    if (!c) {
      c = compileSong(SONGS[trackId]);
      this._compiled.set(trackId, c);
    }
    return c;
  }

  /** Arrangement index of a section name / index (for play({section})). */
  sectionIndex(trackId, section) {
    if (section == null) return 0;
    if (typeof section === 'number') return section;
    const i = SONGS[trackId].arrangement.indexOf(section);
    return i < 0 ? 0 : i;
  }

  /**
   * Start (or crossfade to) a track. opts { fadeIn=1.5, intensity?, section? (name or arrangement index) }.
   * Before init() it is remembered and started once ready.
   */
  play(trackId, { fadeIn = 1.5, intensity, section } = {}) {
    if (!SONGS[trackId]) {
      console.warn(`[audio] unknown music track "${trackId}"`);
      return false;
    }
    if (intensity != null) this.intensity = clamp(intensity, 0, 1);
    const eng = this.engine;
    if (!eng.isReady || !eng.ctx) {
      this._pending = { trackId, fadeIn, section };
      return false;
    }
    if (this.current && this.current.id === trackId) return true;
    const ctx = eng.ctx;
    const now = ctx.currentTime;
    if (this.current) this.current.stop(now, clamp(fadeIn, 0.3, 2));
    const rig = eng._musicRig();
    const inst = new SongInstance({ ctx, ...rig }, this.compiled(trackId), now + 0.08, fadeIn, this.intensity, this.sectionIndex(trackId, section));
    this.instances.push(inst);
    this.current = inst;
    this._startTimer();
    this._tick();
    return true;
  }

  stop({ fadeOut = 1.5 } = {}) {
    this._pending = null;
    if (!this.current || !this.engine.ctx) return;
    this.current.stop(this.engine.ctx.currentTime, Math.max(0.02, fadeOut));
    this.current = null;
  }

  setIntensity(v) {
    this.intensity = clamp(Number(v) || 0, 0, 1);
    if (this.current && this.engine.ctx) this.current.setIntensity(this.intensity, this.engine.ctx.currentTime);
  }

  _tick() {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const until = now + this.lookahead;
    for (let i = this.instances.length - 1; i >= 0; i--) {
      const inst = this.instances[i];
      if (inst.stopping && now > inst.stopAt + 0.2) {
        inst.dispose();
        this.instances.splice(i, 1);
        continue;
      }
      inst.schedule(now, until);
    }
    if (!this.instances.length) this._stopTimer();
  }

  _startTimer() {
    if (!this._timer && typeof setInterval === 'function') this._timer = setInterval(this._tick, this.interval);
  }
  _stopTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }
  /** called by the engine */
  _onReady() {
    if (this._pending) {
      const p = this._pending;
      this._pending = null;
      this.play(p.trackId, { fadeIn: p.fadeIn, section: p.section });
    }
  }
  _pause() {
    this._stopTimer();
  }
  _resume() {
    if (this.instances.length) this._startTimer();
  }

  /**
   * Render `seconds` of a track into an AudioBuffer (pre-master, music volume 1) for
   * level checks / tests. Requires an initialised engine (drum buffers + IR).
   */
  async renderOffline(trackId, { seconds = 8, intensity = 1, sampleRate, section } = {}) {
    const Off = getOfflineContextClass();
    const eng = this.engine;
    if (!Off || !SONGS[trackId]) return null;
    const sr = sampleRate || (eng.ctx ? eng.ctx.sampleRate : 44100);
    const off = new Off(2, Math.ceil(seconds * sr), sr);
    const out = off.createGain();
    out.connect(off.destination);
    const rev = off.createGain();
    if (eng._irBuffer && eng._irBuffer.sampleRate === sr) {
      const conv = off.createConvolver();
      conv.buffer = eng._irBuffer;
      const ret = off.createGain();
      ret.gain.value = eng._reverbReturnLevel ?? 0.5;
      rev.connect(conv).connect(ret).connect(out);
    }
    const rig = eng._musicRig ? eng._musicRig() : { buffers: {} };
    const inst = new SongInstance({ ctx: off, output: out, reverbInput: rev, buffers: rig.buffers }, this.compiled(trackId), 0.02, 0.01, intensity, this.sectionIndex(trackId, section));
    inst.schedule(0, seconds);
    return startRendering(off);
  }
}
