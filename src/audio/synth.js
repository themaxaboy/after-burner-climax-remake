/**
 * synth.js - DSP helpers for the audio subsystem.
 *
 * The first half of this file is PURE (no Web Audio needed, unit-tested in node):
 * note/chord math, doppler, time-scale mapping, step clock, PRNG, noise/IR/curve generators.
 * The second half contains small helpers that need a BaseAudioContext.
 *
 * Nothing in this module touches browser globals at import time.
 */

export const SPEED_OF_SOUND = 343;
export const EPS = 0.0001;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a, b, t) {
  return a + (b - a) * t;
}
export function dbToGain(db) {
  return Math.pow(10, db / 20);
}
export function gainToDb(g) {
  return 20 * Math.log10(Math.max(g, 1e-12));
}

/* ------------------------------------------------------------------ notes */

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NOTE_RE = /^([A-Ga-g])([#b♯♭]{0,2})(-?\d+)$/;
const PC_RE = /^([A-G])([#b]{0,2})$/;

function accidental(acc) {
  let d = 0;
  for (const ch of acc) d += ch === '#' || ch === '♯' ? 1 : -1;
  return d;
}

/** 'A4' -> 69, 'C#3' -> 49, 'Bb2' -> 46, 'E#6' -> 89. Numbers pass through. Invalid -> NaN. */
export function noteToMidi(name) {
  if (typeof name === 'number') return name;
  const m = NOTE_RE.exec(String(name).trim());
  if (!m) return NaN;
  const pc = LETTER_PC[m[1].toUpperCase()] + accidental(m[2]);
  return (parseInt(m[3], 10) + 1) * 12 + pc;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function noteToFreq(name) {
  const m = noteToMidi(name);
  return Number.isFinite(m) ? midiToFreq(m) : NaN;
}

/** 'F#' -> 6, 'Bb' -> 10. Invalid -> NaN. */
export function pitchClassOf(name) {
  const m = PC_RE.exec(String(name).trim());
  if (!m) return NaN;
  return (((LETTER_PC[m[1]] + accidental(m[2])) % 12) + 12) % 12;
}

/** Put a pitch class into the MIDI window [lo, lo+11]. */
export function placePitchClass(pc, lo) {
  return lo + ((((pc - lo) % 12) + 12) % 12);
}

export const CHORD_QUALITIES = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  M: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  5: [0, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  madd9: [0, 3, 7, 14],
  9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  dim: [0, 3, 6],
  aug: [0, 4, 8]
};

/**
 * Parse a chord symbol: 'Em', 'F#m7', 'G/B', 'E5', 'Csus4', 'Bb'.
 * Returns { symbol, root, bass, intervals, quality } or null when invalid.
 */
export function parseChord(symbol) {
  const s = String(symbol).trim();
  const slash = s.indexOf('/');
  const main = slash >= 0 ? s.slice(0, slash) : s;
  const m = /^([A-G])([#b]?)(.*)$/.exec(main);
  if (!m) return null;
  const quality = m[3];
  const intervals = CHORD_QUALITIES[quality];
  if (!intervals) return null;
  const root = pitchClassOf(m[1] + m[2]);
  let bass = root;
  if (slash >= 0) {
    bass = pitchClassOf(s.slice(slash + 1));
    if (!Number.isFinite(bass)) return null;
  }
  return { symbol: s, root, bass, intervals, quality };
}

/** Unique pitch classes of a parsed chord, root first. */
export function chordPitchClasses(chord) {
  const out = [];
  for (const iv of chord.intervals) {
    const pc = (chord.root + iv) % 12;
    if (!out.includes(pc)) out.push(pc);
  }
  return out;
}

/* ---------------------------------------------------------------- doppler */

/**
 * Doppler playback-rate factor (scalar form, zero allocation).
 * dir = unit vector from source to listener.
 *   rate = (c - vListener.dir) / (c - vSource.dir)
 * (equivalently (c + vL.u)/(c - vS.dir) with u = listener->source).
 * Source moving toward the listener or listener moving toward the source -> rate > 1.
 */
export function dopplerRate(
  lx, ly, lz, lvx, lvy, lvz,
  sx, sy, sz, svx, svy, svz,
  c = SPEED_OF_SOUND, min = 0.5, max = 2
) {
  let dx = lx - sx;
  let dy = ly - sy;
  let dz = lz - sz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-6) return 1;
  dx /= d;
  dy /= d;
  dz /= d;
  const vl = lvx * dx + lvy * dy + lvz * dz;
  const vs = svx * dx + svy * dy + svz * dz;
  const num = c - vl;
  const den = c - vs;
  if (den <= 1e-6) return max;
  if (num <= 0) return min;
  return clamp(num / den, min, max);
}

const ZERO3 = Object.freeze({ x: 0, y: 0, z: 0 });
/** Vector-object convenience wrapper: {x,y,z} for listener/source positions & velocities. */
export function dopplerRateVec(listenerPos, listenerVel, sourcePos, sourceVel, c = SPEED_OF_SOUND, min = 0.5, max = 2) {
  const lv = listenerVel || ZERO3;
  const sv = sourceVel || ZERO3;
  return dopplerRate(
    listenerPos.x, listenerPos.y, listenerPos.z, lv.x, lv.y, lv.z,
    sourcePos.x, sourcePos.y, sourcePos.z, sv.x, sv.y, sv.z,
    c, min, max
  );
}

/* ------------------------------------------------------------- time scale */

/**
 * World-bus lowpass cutoff for a game time scale. ts=1 -> maxHz (open),
 * ts<=minTs -> minHz, exponential (perceptually linear) in between.
 */
export function timeScaleToCutoff(ts, minHz = 1200, maxHz = 20000, minTs = 0.3) {
  const t = clamp((ts - minTs) / (1 - minTs), 0, 1);
  return minHz * Math.pow(maxHz / minHz, t);
}

/** Pitch factor for slow motion: proportional to sqrt(timeScale). */
export function timeScaleToRate(ts) {
  return Math.sqrt(clamp(ts, 0.05, 4));
}

/* -------------------------------------------------------------- scheduler */

export function stepDuration(bpm, stepsPerBeat = 4) {
  return 60 / bpm / stepsPerBeat;
}

/** Absolute time of a step; swing (0..0.5) delays odd steps by swing*stepDur. */
export function stepTime(startTime, step, bpm, stepsPerBeat = 4, swing = 0) {
  const d = stepDuration(bpm, stepsPerBeat);
  return startTime + step * d + (step & 1 ? swing * d : 0);
}

/**
 * Drift-free step clock for look-ahead scheduling. Step times are always derived
 * from startTime + step*stepDur, never accumulated.
 */
export class StepClock {
  constructor(bpm = 120, stepsPerBeat = 4, startTime = 0, swing = 0) {
    this.bpm = bpm;
    this.stepsPerBeat = stepsPerBeat;
    this.swing = swing;
    this.stepDur = stepDuration(bpm, stepsPerBeat);
    this.reset(startTime);
  }
  reset(startTime) {
    this.startTime = startTime;
    this.step = 0;
    this.nextTime = startTime;
  }
  timeOf(step) {
    return this.startTime + step * this.stepDur + (step & 1 ? this.swing * this.stepDur : 0);
  }
  /** Invoke fn.call(thisArg, step, time) for every step whose grid time is < until. Returns count. */
  advance(until, fn, thisArg) {
    let n = 0;
    while (this.nextTime < until) {
      const s = this.step;
      if (fn) fn.call(thisArg, s, this.timeOf(s));
      this.step = s + 1;
      this.nextTime = this.startTime + this.step * this.stepDur;
      n++;
    }
    return n;
  }
}

/* -------------------------------------------------------------- random */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* ------------------------------------------------------ signal generators */

export function fillWhite(out, rng) {
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Paul Kellet's refined pink noise filter. */
export function fillPink(out, rng) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rng() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** Leaky-integrated (brown/red) noise, roughly within [-1, 1]. */
export function fillBrown(out, rng) {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rng() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/** One-pole DC blocker in place. */
export function dcBlock(data, r = 0.995) {
  let x1 = 0, y1 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = x - x1 + r * y1;
    x1 = x;
    y1 = y;
    data[i] = y;
  }
  return data;
}

/**
 * Sparse random crackle (poisson impulses). Density and amplitude decay with tau (s, 0 = constant).
 */
export function makeCrackle(length, sampleRate, rng, { rate = 200, tau = 0, burstMs = 1.2, start = 0 } = {}) {
  const out = new Float32Array(length);
  let t = start;
  for (;;) {
    t += -Math.log(1 - rng() * 0.999999) / rate;
    const i = Math.floor(t * sampleRate);
    if (i >= length) break;
    const env = tau > 0 ? Math.exp(-(t - start) / tau) : 1;
    if (tau > 0 && rng() > env) continue; // thinning: density falls with time
    const a = (0.3 + 0.7 * rng()) * (0.35 + 0.65 * env) * (rng() < 0.5 ? -1 : 1);
    const n = Math.max(2, Math.round(burstMs * 0.001 * sampleRate * (0.5 + rng())));
    for (let j = 0; j < n && i + j < length; j++) {
      out[i + j] += a * Math.exp((-4 * j) / n) * (j & 1 ? -0.7 : 1);
    }
  }
  return out;
}

/**
 * Procedural reverb impulse response: exponentially decaying stereo noise with
 * sparse early reflections and frequency-dependent damping (gets darker over time).
 * Returns an array of Float32Array (one per channel).
 */
export function generateImpulseResponse(sampleRate, seconds = 1.8, { channels = 2, seed = 7, preDelay = 0.012, damping = 0.85, early = 6 } = {}) {
  const len = Math.max(1, Math.floor(sampleRate * seconds));
  const pre = Math.floor(preDelay * sampleRate);
  const out = [];
  for (let c = 0; c < channels; c++) {
    const rng = mulberry32(seed * 7919 + c * 104729);
    const d = new Float32Array(len);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const env = Math.exp(-6.9 * t); // -60 dB at the end (RT60 = seconds)
      const coef = 1 - damping * t; // one-pole LP closing over time
      lp += (rng() * 2 - 1 - lp) * Math.max(0.05, coef);
      const fadeIn = Math.min(1, (i - pre) / (0.004 * sampleRate));
      d[i] = lp * env * fadeIn;
    }
    for (let k = 0; k < early; k++) {
      const idx = pre + Math.floor((0.004 + rng() * 0.07) * sampleRate);
      if (idx < len) d[idx] += (rng() < 0.5 ? -1 : 1) * (0.5 - k * 0.05);
    }
    out.push(d);
  }
  return out;
}

/**
 * Make [loopStart, loopEnd) loop seamlessly: the last `fade` samples of the loop are
 * blended with the samples right BEFORE loopStart, so wrapping end->start is continuous.
 * Uses a linear fade for correlated material (tonal, periodic) and equal-power otherwise.
 */
export function crossfadeLoop(channels, loopStart, loopEnd, fade) {
  const f = Math.max(0, Math.min(fade | 0, loopStart | 0, (loopEnd - loopStart) | 0));
  if (f < 2) return 0;
  // correlation of the two blended regions (on channel 0)
  const c0 = channels[0];
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < f; i++) {
    const a = c0[loopEnd - f + i];
    const b = c0[loopStart - f + i];
    sab += a * b;
    saa += a * a;
    sbb += b * b;
  }
  const rho = saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
  const linear = rho > 0.3;
  for (const d of channels) {
    for (let i = 0; i < f; i++) {
      const t = (i + 1) / f;
      const gIn = linear ? t : Math.sin((t * Math.PI) / 2);
      const gOut = linear ? 1 - t : Math.cos((t * Math.PI) / 2);
      const e = loopEnd - f + i;
      d[e] = d[e] * gOut + d[loopStart - f + i] * gIn;
    }
  }
  return rho;
}

/** Peak, overall RMS and loudest-window RMS of channel data. */
export function analyzeChannels(channels, windowSize = 2048) {
  let peak = 0, sum = 0, n = 0, maxWin = 0;
  for (const d of channels) {
    let win = 0, wn = 0;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v;
      win += v * v;
      if (++wn === windowSize) {
        const r = Math.sqrt(win / wn);
        if (r > maxWin) maxWin = r;
        win = 0;
        wn = 0;
      }
    }
    if (wn > 0) {
      const r = Math.sqrt(win / wn);
      if (r > maxWin) maxWin = r;
    }
    n += d.length;
  }
  const bad = !Number.isFinite(peak) || !Number.isFinite(sum);
  return { peak, rms: n ? Math.sqrt(sum / n) : 0, maxWindowRms: maxWin, finite: !bad };
}

export function scaleChannels(channels, g) {
  for (const d of channels) for (let i = 0; i < d.length; i++) d[i] *= g;
}

/* ----------------------------------------------------------------- curves */

/** Symmetric tanh drive curve, normalised so +-1 -> +-1. */
export function makeDriveCurve(amount = 4, n = 2049) {
  const c = new Float32Array(n);
  const k = Math.max(0.001, amount);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

/** Transparent below `knee`, smooth saturation up to `ceiling` (final safety clipper). */
export function makeSoftClipCurve(n = 4097, knee = 0.8, ceiling = 0.98) {
  const c = new Float32Array(n);
  const room = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room);
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

/* ============================================================ ctx helpers */

export function getAudioContextClass() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  return g.AudioContext || g.webkitAudioContext || null;
}

export function getOfflineContextClass() {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  return g.OfflineAudioContext || g.webkitOfflineAudioContext || null;
}

/** startRendering() that also works with the old callback-style webkit API. */
export function startRendering(offlineCtx) {
  return new Promise((resolve, reject) => {
    let done = false;
    offlineCtx.oncomplete = (e) => {
      if (!done) {
        done = true;
        resolve(e.renderedBuffer);
      }
    };
    try {
      const p = offlineCtx.startRendering();
      if (p && typeof p.then === 'function') {
        p.then((b) => {
          if (!done) {
            done = true;
            resolve(b);
          }
        }, reject);
      }
    } catch (err) {
      reject(err);
    }
  });
}

/** AudioBuffer from Float32Array channels. */
export function bufferFromChannels(ctx, channels, sampleRate = ctx.sampleRate) {
  const len = channels[0].length;
  const buf = ctx.createBuffer(channels.length, Math.max(1, len), sampleRate);
  for (let c = 0; c < channels.length; c++) buf.getChannelData(c).set(channels[c]);
  return buf;
}

/** Seamlessly looping noise buffer ('white' | 'pink' | 'brown'), independent per channel. */
export function createNoiseBuffer(ctx, kind = 'white', seconds = 2, seed = 1, channels = 2) {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const fade = Math.floor(0.05 * sr);
  const fill = kind === 'pink' ? fillPink : kind === 'brown' ? fillBrown : fillWhite;
  const chans = [];
  for (let c = 0; c < channels; c++) {
    const rng = mulberry32(seed * 31 + c * 977 + kind.length);
    const d = fill(new Float32Array(len + fade), rng);
    if (kind === 'brown') dcBlock(d, 0.9995);
    chans.push(d);
  }
  crossfadeLoop(chans, fade, len + fade, fade);
  const trimmed = chans.map((d) => d.subarray(fade, fade + len));
  const a = analyzeChannels(trimmed);
  if (a.peak > 0) scaleChannels(trimmed, 0.95 / a.peak);
  return bufferFromChannels(ctx, trimmed);
}

export function createImpulseBuffer(ctx, seconds = 1.8, opts) {
  return bufferFromChannels(ctx, generateImpulseResponse(ctx.sampleRate, seconds, opts));
}

/** Percussive envelope: 0 -> peak (linear, `attack` s) -> exponential decay (time constant tc). */
export function perc(param, t, peak, attack, tc) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, tc);
}

/** Exponential sweep between two positive values. */
export function sweep(param, t0, v0, t1, v1) {
  param.setValueAtTime(Math.max(v0, EPS), t0);
  param.exponentialRampToValueAtTime(Math.max(v1, EPS), t1);
}

export function makeStereoPanner(ctx, v = 0) {
  if (typeof ctx.createStereoPanner !== 'function') return null;
  const p = ctx.createStereoPanner();
  p.pan.value = v;
  return p;
}
