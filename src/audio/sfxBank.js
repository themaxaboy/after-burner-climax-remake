/**
 * sfxBank.js - every one-shot / loop sound, synthesized once at init with
 * OfflineAudioContext and cached as AudioBuffers.
 *
 * Each definition:
 *   dur       seconds rendered
 *   bus       'world' (slow-mo filtered/pitched, reverb send) | 'ui' | 'voice'
 *   gain      mix gain applied at play time (buffers are peak-normalised)
 *   channels  1 (mono, preferred for positional) or 2
 *   loop      { start, fade } -> seamless loop region [start, dur)
 *   tail      one-shot played when the loop stops
 *   variance  random playback-rate spread (+-) for repetitive sounds
 *   maxInstances / minInterval  retrigger limiting
 *   ref       PannerNode refDistance (m) when played positionally
 *   render(K) builds the offline graph (K = kit, see makeKit)
 */
import {
  EPS,
  analyzeChannels,
  bufferFromChannels,
  crossfadeLoop,
  dcBlock,
  getOfflineContextClass,
  hashString,
  makeCrackle,
  makeDriveCurve,
  mulberry32,
  noteToFreq,
  scaleChannels,
  startRendering
} from './synth.js';

/* ---------------------------------------------------------------- kit */

const curveCache = new Map();
function driveCurve(amount) {
  const key = Math.round(amount * 100);
  let c = curveCache.get(key);
  if (!c) {
    c = makeDriveCurve(amount);
    curveCache.set(key, c);
  }
  return c;
}

/**
 * Tiny graph-building toolkit bound to one (offline) context.
 * shared = { noise: {white,pink,brown}, ir } AudioBuffers at the same sample rate.
 */
export function makeKit(ctx, shared, seed = 1) {
  const sr = ctx.sampleRate;
  const rng = mulberry32(seed);
  const K = {
    ctx,
    sr,
    rng,
    out: ctx.destination,
    shared,
    rand: (a, b) => a + (b - a) * rng(),
    gain(v = 1) {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    },
    filter(type, freq, Q = 0.7071, gainDb = 0) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = Q;
      f.gain.value = gainDb;
      return f;
    },
    osc(type, freq, t0 = 0, t1 = null) {
      const o = ctx.createOscillator();
      if (typeof type === 'string') o.type = type;
      else o.setPeriodicWave(type);
      o.frequency.value = freq;
      o.start(t0);
      if (t1 != null) o.stop(t1);
      return o;
    },
    noise(kind = 'white', t0 = 0, t1 = null, rate = 1) {
      const s = ctx.createBufferSource();
      s.buffer = shared.noise[kind];
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(t0, rng() * (s.buffer.duration - 0.01));
      if (t1 != null) s.stop(t1);
      return s;
    },
    src(buffer, t0 = 0, rate = 1, loop = false) {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = loop;
      s.playbackRate.value = rate;
      s.start(t0);
      return s;
    },
    data(channels) {
      return bufferFromChannels(ctx, channels);
    },
    crackle(dur, opts, stereo = false) {
      const len = Math.ceil(dur * sr);
      const ch = [makeCrackle(len, sr, rng, opts)];
      if (stereo) ch.push(makeCrackle(len, sr, rng, opts));
      return bufferFromChannels(ctx, ch);
    },
    shaper(amount = 4, oversample = '2x') {
      const w = ctx.createWaveShaper();
      w.curve = driveCurve(amount);
      w.oversample = oversample;
      return w;
    },
    pan(v = 0) {
      if (typeof ctx.createStereoPanner !== 'function') return K.gain(1);
      const p = ctx.createStereoPanner();
      p.pan.value = v;
      return p;
    },
    /** input node that feeds dry (dryLevel) + convolution reverb (wet) into dest. */
    verb(wet = 0.3, dryLevel = 1, dest = ctx.destination) {
      const input = K.gain(1);
      const dry = K.gain(dryLevel);
      input.connect(dry).connect(dest);
      if (wet > 0 && shared.ir) {
        const conv = ctx.createConvolver();
        conv.buffer = shared.ir;
        const w = K.gain(wet);
        input.connect(conv).connect(w).connect(dest);
      }
      return input;
    },
    chain(...nodes) {
      for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
      return nodes[nodes.length - 1];
    },
    perc(param, t, peak, attack, tc) {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + attack);
      param.setTargetAtTime(0, t + attack, tc);
    },
    /** attack/hold/release envelope */
    ahr(param, t, peak, attack, holdEnd, releaseTc) {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + attack);
      param.setValueAtTime(peak, Math.max(t + attack, holdEnd));
      param.setTargetAtTime(0, Math.max(t + attack, holdEnd), releaseTc);
    },
    sweep(param, t0, v0, t1, v1) {
      param.setValueAtTime(Math.max(v0, EPS), t0);
      param.exponentialRampToValueAtTime(Math.max(v1, EPS), t1);
    },
    lin(param, t0, v0, t1, v1) {
      param.setValueAtTime(v0, t0);
      param.linearRampToValueAtTime(v1, t1);
    },
    /** gain node carrying a percussive envelope */
    pg(t, peak, attack, tc) {
      const g = K.gain(0);
      K.perc(g.gain, t, peak, attack, tc);
      return g;
    },
    /** short tonal "thump": sine sweeping f0 -> f1 */
    thump(dest, t, f0, f1, sweepT, peak, tc) {
      const o = K.osc('sine', f0, t, t + sweepT + tc * 7);
      K.sweep(o.frequency, t, f0, t + sweepT, f1);
      K.chain(o, K.pg(t, peak, 0.003, tc), dest);
      return o;
    },
    /** filtered noise burst */
    burst(dest, t, kind, type, freq, Q, peak, attack, tc) {
      const n = K.noise(kind, t, t + attack + tc * 8);
      K.chain(n, K.filter(type, freq, Q), K.pg(t, peak, attack, tc), dest);
      return n;
    }
  };
  return K;
}

/* ------------------------------------------------------ shared recipes */

function vulcanShots(K, dur, times) {
  const { sr, rng } = K;
  const len = Math.ceil(dur * sr);
  const L = new Float32Array(len);
  const R = new Float32Array(len);
  const nb = Math.round(0.0045 * sr);
  const nc = Math.round(0.008 * sr);
  const tau = 0.0013 * sr;
  for (const [t, amp] of times) {
    const i0 = Math.round(t * sr);
    for (let j = 0; j < nb && i0 + j < len; j++) {
      // one damped bipolar cycle per round (no DC build-up)
      const v = Math.sin((2 * Math.PI * j) / nb) * Math.exp(-j / (nb * 0.7)) * amp * 0.9;
      L[i0 + j] += v;
      R[i0 + j] += v;
    }
    for (let j = 0; j < nc && i0 + j < len; j++) {
      const e = Math.exp(-j / tau) * amp * 0.8;
      L[i0 + j] += (rng() * 2 - 1) * e;
      R[i0 + j] += (rng() * 2 - 1) * e;
    }
  }
  return K.data([L, R]);
}

function beep(K, dest, t, freq, len, peak, type = 'sine', attack = 0.004, releaseTc = 0.008) {
  const o = K.osc(type, freq, t, t + len + releaseTc * 8);
  const g = K.gain(0);
  K.ahr(g.gain, t, peak, attack, t + len, releaseTc);
  K.chain(o, g, dest);
  return o;
}

function supersawNote(K, dest, t, freq, len, peak, spread = 12, voices = 3, cutoff = 3500) {
  const f = K.filter('lowpass', cutoff, 0.8);
  const g = K.gain(0);
  K.ahr(g.gain, t, peak, 0.012, t + len, 0.12);
  for (let v = 0; v < voices; v++) {
    const o = K.osc('sawtooth', freq, t, t + len + 1);
    o.detune.value = voices === 1 ? 0 : -spread + (2 * spread * v) / (voices - 1);
    o.connect(f);
  }
  K.chain(f, g, dest);
}

/* ------------------------------------------------------------- the bank */

export const SFX_DEFS = {
  /* ---------------- weapons */
  vulcan: {
    dur: 1.35,
    loop: { start: 0.35, fade: 0.06 },
    bus: 'world',
    gain: 0.4,
    channels: 2,
    tail: 'vulcanTail',
    render(K) {
      // M61: 6000 rpm = 100 rounds/s. Spin-up to steady 100 Hz by t=0.25 s.
      const times = [];
      let t = 0.25;
      let iv = 0.01;
      const spin = [];
      while (t > 0.02) {
        iv *= 1.09;
        t -= iv;
        spin.push(t);
      }
      spin.reverse().forEach((st, i) => times.push([st, 0.45 + (0.5 * i) / spin.length]));
      for (let k = 0; 0.25 + k * 0.01 < 1.35; k++) times.push([0.25 + k * 0.01, 0.82 + K.rng() * 0.18]);
      const s = K.src(vulcanShots(K, 1.35, times));
      const bus = K.verb(0.12);
      K.chain(s, K.filter('lowpass', 3200, 0.7), K.filter('peaking', 180, 1, 5), K.shaper(3.5), K.gain(0.75), bus);
      K.chain(s, K.filter('highpass', 2500, 0.7), K.gain(0.35), bus);
      // mechanical rotor whine, spin-up then steady 1150 Hz (integer cycles per 1 s loop)
      const w = K.osc('sawtooth', 180, 0);
      K.sweep(w.frequency, 0, 180, 0.25, 1150);
      const lfo = K.osc('sine', 6, 0);
      K.chain(lfo, K.gain(12), w.frequency);
      const wg = K.gain(0);
      K.lin(wg.gain, 0, 0, 0.25, 0.07);
      K.chain(w, K.filter('bandpass', 1200, 4), wg, bus);
      // propellant gas rush
      const n = K.noise('pink', 0);
      const ng = K.gain(0);
      K.lin(ng.gain, 0, 0, 0.25, 0.3);
      K.chain(n, K.filter('bandpass', 650, 0.9), ng, bus);
    }
  },
  vulcanTail: {
    dur: 0.9,
    bus: 'world',
    gain: 0.5,
    channels: 2,
    render(K) {
      const times = [];
      let t = 0;
      let iv = 0.012;
      for (let i = 0; i < 9; i++) {
        times.push([t, 0.9 * Math.pow(0.8, i)]);
        iv *= 1.28;
        t += iv;
      }
      const s = K.src(vulcanShots(K, 0.9, times));
      const bus = K.verb(0.2);
      K.chain(s, K.filter('lowpass', 3000, 0.7), K.shaper(3), K.gain(0.75), bus);
      K.chain(s, K.filter('highpass', 2500, 0.7), K.gain(0.3), bus);
      const w = K.osc('sawtooth', 1150, 0, 0.9);
      K.sweep(w.frequency, 0, 1150, 0.7, 220);
      K.chain(w, K.filter('bandpass', 1000, 3), K.pg(0, 0.09, 0.005, 0.2), bus);
    }
  },
  missileLaunch: {
    dur: 2.6,
    bus: 'world',
    gain: 0.75,
    channels: 2,
    maxInstances: 4,
    ref: 40,
    render(K) {
      const bus = K.verb(0.25);
      const pan = K.pan(-0.35);
      if (pan.pan) {
        pan.pan.setValueAtTime(-0.35, 0);
        pan.pan.linearRampToValueAtTime(0.4, 2.2);
      }
      pan.connect(bus);
      // ignition pop + thump
      K.burst(bus, 0, 'white', 'bandpass', 900, 0.8, 0.9, 0.002, 0.03);
      K.thump(bus, 0, 130, 42, 0.18, 0.8, 0.08);
      // rocket roar
      const roar = K.filter('bandpass', 300, 0.7);
      K.sweep(roar.frequency, 0.02, 300, 0.18, 1500);
      roar.frequency.exponentialRampToValueAtTime(600, 2.4);
      K.noise('brown', 0.02, 2.6).connect(roar);
      K.chain(K.noise('white', 0.02, 2.6), K.gain(0.3), roar);
      const lp = K.filter('lowpass', 9000, 0.5);
      K.sweep(lp.frequency, 0.15, 9000, 2.4, 1300);
      const rg = K.gain(0);
      rg.gain.setValueAtTime(0, 0.02);
      rg.gain.linearRampToValueAtTime(1, 0.1);
      rg.gain.setTargetAtTime(0, 0.35, 0.55);
      K.chain(roar, K.shaper(3), lp, rg, pan);
      // air whoosh
      const wf = K.filter('bandpass', 6000, 1.2);
      K.sweep(wf.frequency, 0, 6000, 0.9, 1200);
      const wg = K.gain(0);
      K.lin(wg.gain, 0, 0, 0.12, 0.5);
      wg.gain.setTargetAtTime(0, 0.2, 0.25);
      K.chain(K.noise('pink', 0, 1.8), wf, wg, pan);
      // motor crackle
      const cr = K.src(K.crackle(2.5, { rate: 350, tau: 1.0, start: 0.05 }, true), 0);
      K.chain(cr, K.filter('bandpass', 2600, 0.8), K.gain(0.5), pan);
    }
  },
  flare: {
    dur: 1.4,
    bus: 'world',
    gain: 0.5,
    channels: 2,
    maxInstances: 2,
    render(K) {
      const bus = K.verb(0.2);
      [-0.5, 0.5, 0].forEach((p, i) => {
        const t = i * 0.13;
        const pn = K.pan(p);
        pn.connect(bus);
        K.burst(pn, t, 'white', 'bandpass', 1400, 1.2, 0.9, 0.001, 0.02);
        K.thump(pn, t, 190, 90, 0.05, 0.5, 0.035);
        const h = K.noise('white', t, t + 1.2);
        const hg = K.gain(0);
        K.perc(hg.gain, t, 0.3, 0.01, 0.22);
        K.chain(h, K.filter('highpass', 4000, 0.7), K.filter('bandpass', 7000, 0.6), hg, pn);
      });
    }
  },

  /* ---------------- cockpit tones */
  lockOn: {
    dur: 0.14,
    bus: 'ui',
    gain: 0.35,
    channels: 1,
    maxInstances: 3,
    render(K) {
      const f = K.filter('lowpass', 6000, 0.7);
      f.connect(K.out);
      beep(K, f, 0.002, 2200, 0.07, 0.8, 'square', 0.002, 0.01);
      beep(K, f, 0.002, 4400, 0.05, 0.15, 'sine', 0.002, 0.01);
    }
  },
  lockTone: {
    dur: 0.6,
    loop: { start: 0.1, fade: 0.05 },
    bus: 'ui',
    gain: 0.18,
    channels: 1,
    render(K) {
      const am = K.gain(0.75);
      const lfo = K.osc('sine', 12, 0);
      K.chain(lfo, K.gain(0.25), am.gain);
      K.osc('sine', 1600, 0).connect(am);
      K.chain(K.osc('triangle', 1600, 0), K.gain(0.3), am);
      K.chain(am, K.filter('lowpass', 5000, 0.7), K.out);
    }
  },
  missileAlert: {
    dur: 0.6,
    loop: { start: 0.2, fade: 0.02 },
    bus: 'ui',
    gain: 0.22,
    channels: 1,
    render(K) {
      // 800/1000 Hz alternating every 100 ms (integer cycles per segment -> phase continuous)
      const o = K.osc('square', 800, 0);
      for (let i = 0; i < 6; i++) o.frequency.setValueAtTime(i & 1 ? 1000 : 800, i * 0.1);
      K.chain(o, K.filter('lowpass', 3500, 0.7), K.gain(0.8), K.out);
    }
  },
  radarWarning: {
    dur: 1.1,
    loop: { start: 0.1, fade: 0.03 },
    bus: 'ui',
    gain: 0.25,
    channels: 1,
    render(K) {
      const f = K.filter('lowpass', 4000, 0.7);
      f.connect(K.out);
      for (const t of [0.1, 0.32]) {
        beep(K, f, t, 1250, 0.13, 0.7, 'triangle', 0.005, 0.01);
        beep(K, f, t, 2500, 0.13, 0.12, 'sine', 0.005, 0.01);
      }
    }
  },
  lowAltitude: {
    dur: 1.1,
    loop: { start: 0.1, fade: 0.03 },
    bus: 'ui',
    gain: 0.28,
    channels: 1,
    render(K) {
      const f = K.filter('lowpass', 3500, 0.7);
      f.connect(K.out);
      for (const t of [0.1, 0.55]) {
        for (const [type, lvl] of [['sine', 0.7], ['square', 0.12]]) {
          const o = K.osc(type, 450, t, t + 0.45);
          K.sweep(o.frequency, t, 450, t + 0.3, 1100);
          const g = K.gain(0);
          K.ahr(g.gain, t, lvl, 0.02, t + 0.3, 0.02);
          K.chain(o, g, f);
        }
      }
    }
  },
  eoAlert: {
    dur: 1.3,
    loop: { start: 0.1, fade: 0.03 },
    bus: 'ui',
    gain: 0.3,
    channels: 2,
    render(K) {
      // klaxon: 590 / 440 Hz, 0.3 s each (integer cycles), 0.6 s period
      const bus = K.verb(0.15);
      const mix = K.gain(1);
      const oa = K.osc('sawtooth', 440, 0);
      const ob = K.osc('square', 440, 0);
      ob.detune.value = 8;
      const g = K.gain(0.5);
      const steps = [[0, 440], [0.1, 590], [0.4, 440], [0.7, 590], [1.0, 440]];
      for (const [t, f] of steps) {
        oa.frequency.setValueAtTime(f, t);
        ob.frequency.setValueAtTime(f, t);
        if (t > 0) {
          g.gain.setValueAtTime(0.5, t);
          g.gain.linearRampToValueAtTime(0.25, t + 0.012);
          g.gain.linearRampToValueAtTime(0.5, t + 0.03);
        }
      }
      oa.connect(mix);
      K.chain(ob, K.gain(0.5), mix);
      K.chain(mix, g, K.filter('bandpass', 1200, 0.7), K.shaper(2.5), K.filter('lowpass', 3500, 0.7), bus);
    }
  },

  /* ---------------- impacts */
  explosionSmall: {
    dur: 1.6,
    bus: 'world',
    gain: 0.8,
    channels: 2,
    variance: 0.08,
    maxInstances: 5,
    ref: 60,
    render(K) {
      const bus = K.verb(0.25);
      K.burst(bus, 0, 'white', 'highpass', 1500, 0.7, 0.8, 0.001, 0.012);
      const body = K.filter('lowpass', 4000, 0.5);
      K.sweep(body.frequency, 0, 4000, 0.6, 280);
      K.noise('brown', 0, 1.6).connect(body);
      K.chain(K.noise('white', 0, 1.6), K.gain(0.3), body);
      K.chain(body, K.shaper(2.5), K.pg(0, 1, 0.004, 0.22), bus);
      K.thump(bus, 0, 95, 38, 0.3, 0.9, 0.14);
      const cr = K.src(K.crackle(1.4, { rate: 300, tau: 0.35, start: 0.03 }, true), 0);
      K.chain(cr, K.filter('bandpass', 3000, 0.6), K.gain(0.45), bus);
    }
  },
  explosionLarge: {
    dur: 4.2,
    bus: 'world',
    gain: 1.0,
    channels: 2,
    variance: 0.05,
    maxInstances: 3,
    ref: 150,
    render(K) {
      const bus = K.verb(0.4);
      K.burst(bus, 0, 'white', 'highpass', 1200, 0.7, 0.9, 0.001, 0.02);
      // body: two stacked blasts
      for (const [t, peak] of [[0, 1], [0.07, 0.7]]) {
        const body = K.filter('lowpass', 2600, 0.5);
        K.sweep(body.frequency, t, 2600, t + 2.0, 110);
        K.noise('brown', t, 4.2).connect(body);
        K.chain(K.noise('pink', t, 4.2), K.gain(0.5), body);
        const g = K.gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.006);
        g.gain.setTargetAtTime(peak * 0.45, t + 0.006, 0.12);
        g.gain.setTargetAtTime(0, t + 0.35, 0.75);
        K.chain(body, K.shaper(2.2), g, bus);
      }
      // sub-bass drop
      const sub = K.osc('sine', 70, 0, 4.2);
      K.sweep(sub.frequency, 0, 70, 1.5, 24);
      K.chain(sub, K.pg(0, 1, 0.005, 0.6), bus);
      // debris crackle, long tail
      const cr = K.src(K.crackle(3.8, { rate: 420, tau: 1.1, start: 0.12 }, true), 0);
      K.chain(cr, K.filter('bandpass', 2400, 0.5), K.gain(0.45), bus);
    }
  },
  /*
   * Layered kill booms (chosen by distance in src/states/stage/fxHooks.js):
   *   boomNear  < ~700 m: sharp crack + ~45 Hz sub thump + blast body + debris rattle
   *   boomFar   farther: low-passed, soft onset, rolling rumble
   *   boomHuge  big kills (bombers, bosses): stacked blasts + long sub drop + rumble
   */
  boomNear: {
    dur: 2.8,
    bus: 'world',
    gain: 1.0,
    channels: 1,
    variance: 0.07,
    maxInstances: 4,
    ref: 160,
    render(K) {
      const bus = K.verb(0.28);
      // crack: the supersonic front of the blast
      K.burst(bus, 0, 'white', 'highpass', 2200, 0.7, 1, 0.0004, 0.006);
      K.chain(K.noise('white', 0, 0.06), K.filter('bandpass', 4200, 1.2), K.shaper(4), K.pg(0, 0.5, 0.0005, 0.01), bus);
      // sub thump: fast drop into ~45 Hz, driven a little so small speakers hear it
      const sub = K.osc('sine', 72, 0, 2.2);
      K.sweep(sub.frequency, 0, 72, 0.16, 45);
      sub.frequency.exponentialRampToValueAtTime(38, 1.4);
      const sg = K.gain(0);
      sg.gain.setValueAtTime(0, 0);
      sg.gain.linearRampToValueAtTime(1, 0.006);
      sg.gain.setTargetAtTime(0.55, 0.006, 0.08);
      sg.gain.setTargetAtTime(0, 0.2, 0.32);
      K.chain(sub, K.shaper(1.6), sg, bus);
      // blast body: brown/pink noise under a closing low-pass
      const body = K.filter('lowpass', 3600, 0.6);
      K.sweep(body.frequency, 0, 3600, 1.1, 170);
      K.noise('brown', 0, 2.8).connect(body);
      K.chain(K.noise('pink', 0, 2.8), K.gain(0.45), body);
      const bg = K.gain(0);
      bg.gain.setValueAtTime(0, 0);
      bg.gain.linearRampToValueAtTime(0.95, 0.004);
      bg.gain.setTargetAtTime(0.4, 0.004, 0.09);
      bg.gain.setTargetAtTime(0, 0.3, 0.55);
      K.chain(body, K.shaper(2.4), bg, bus);
      // debris rattle: sparse crackle + a few metallic pings
      const cr = K.src(K.crackle(2.4, { rate: 380, tau: 0.6, start: 0.05 }), 0);
      K.chain(cr, K.filter('bandpass', 2800, 0.6), K.gain(0.5), bus);
      for (let i = 0; i < 4; i++) {
        const t = 0.08 + K.rand(0, 0.5);
        const o = K.osc('triangle', K.rand(1700, 4200), t, t + 0.25);
        K.chain(o, K.pg(t, 0.06, 0.001, 0.03), bus);
      }
    }
  },
  boomFar: {
    dur: 3.2,
    bus: 'world',
    gain: 0.85,
    channels: 1,
    variance: 0.08,
    maxInstances: 4,
    ref: 160,
    render(K) {
      const bus = K.verb(0.45);
      const lp = K.filter('lowpass', 900, 0.6);
      lp.connect(bus);
      // soft (air-absorbed) front
      K.burst(lp, 0, 'pink', 'lowpass', 1400, 0.7, 0.7, 0.012, 0.05);
      // low thump
      const sub = K.osc('sine', 58, 0, 2.6);
      K.sweep(sub.frequency, 0, 58, 0.3, 36);
      K.chain(sub, K.pg(0, 0.9, 0.02, 0.35), lp);
      // rolling rumble
      const body = K.filter('lowpass', 520, 0.7);
      K.sweep(body.frequency, 0, 520, 2.4, 90);
      K.noise('brown', 0, 3.2).connect(body);
      const bg = K.gain(0);
      bg.gain.setValueAtTime(0, 0);
      bg.gain.linearRampToValueAtTime(0.9, 0.03);
      bg.gain.setTargetAtTime(0.35, 0.05, 0.25);
      bg.gain.setTargetAtTime(0, 0.6, 0.7);
      K.chain(body, K.shaper(1.5), bg, lp);
      const cr = K.src(K.crackle(2.6, { rate: 160, tau: 0.9, start: 0.1 }), 0);
      K.chain(cr, K.filter('bandpass', 1100, 0.7), K.gain(0.25), lp);
    }
  },
  boomHuge: {
    dur: 5.0,
    bus: 'world',
    gain: 1.0,
    channels: 2,
    variance: 0.04,
    maxInstances: 2,
    ref: 300,
    render(K) {
      const bus = K.verb(0.45);
      K.burst(bus, 0, 'white', 'highpass', 1600, 0.7, 1, 0.0005, 0.012);
      // stacked blasts (primary + secondary detonations)
      for (const [t, peak, f0] of [[0, 1, 3000], [0.09, 0.75, 2400], [0.32, 0.6, 1800], [0.7, 0.4, 1400]]) {
        const body = K.filter('lowpass', f0, 0.55);
        K.sweep(body.frequency, t, f0, t + 1.8, 100);
        K.noise('brown', t, 5).connect(body);
        K.chain(K.noise('pink', t, 5), K.gain(0.5), body);
        const g = K.gain(0);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.006);
        g.gain.setTargetAtTime(peak * 0.45, t + 0.006, 0.14);
        g.gain.setTargetAtTime(0, t + 0.4, 0.9);
        K.chain(body, K.shaper(2.2), g, bus);
      }
      // long sub drop
      const sub = K.osc('sine', 66, 0, 5);
      K.sweep(sub.frequency, 0, 66, 2.5, 22);
      const sg = K.gain(0);
      sg.gain.setValueAtTime(0, 0);
      sg.gain.linearRampToValueAtTime(1, 0.008);
      sg.gain.setTargetAtTime(0, 0.3, 1.0);
      K.chain(sub, K.shaper(1.4), sg, bus);
      // rumble tail
      const rum = K.filter('lowpass', 220, 0.8);
      K.noise('brown', 0.1, 5).connect(rum);
      const rg = K.gain(0);
      rg.gain.setValueAtTime(0, 0.1);
      rg.gain.linearRampToValueAtTime(0.6, 0.5);
      rg.gain.setTargetAtTime(0, 0.9, 1.3);
      K.chain(rum, rg, bus);
      const cr = K.src(K.crackle(4.6, { rate: 420, tau: 1.8, start: 0.12 }, true), 0);
      K.chain(cr, K.filter('bandpass', 2200, 0.5), K.gain(0.45), bus);
    }
  },
  whoosh: {
    // near miss / missile fly-by (positional; doppler comes from the velocity)
    dur: 1.3,
    bus: 'world',
    gain: 0.8,
    channels: 1,
    variance: 0.1,
    maxInstances: 3,
    minInterval: 0.08,
    ref: 60,
    render(K) {
      const mix = K.gain(1);
      mix.connect(K.out);
      const env = K.gain(0);
      env.gain.setValueAtTime(0, 0);
      env.gain.linearRampToValueAtTime(0.35, 0.3);
      env.gain.linearRampToValueAtTime(1, 0.5);
      env.gain.setTargetAtTime(0, 0.56, 0.18);
      const bp = K.filter('bandpass', 500, 1.1);
      K.sweep(bp.frequency, 0, 500, 0.5, 2600);
      bp.frequency.exponentialRampToValueAtTime(420, 1.2);
      K.chain(K.noise('pink', 0, 1.3), bp, env, mix);
      // jet roar body riding the whoosh
      const roar = K.filter('lowpass', 900, 0.7);
      K.sweep(roar.frequency, 0, 900, 0.5, 1600);
      roar.frequency.exponentialRampToValueAtTime(300, 1.2);
      const rg = K.gain(0);
      rg.gain.setValueAtTime(0, 0);
      rg.gain.linearRampToValueAtTime(0.7, 0.48);
      rg.gain.setTargetAtTime(0, 0.55, 0.22);
      K.chain(K.noise('brown', 0, 1.3), roar, K.shaper(1.5), rg, mix);
      // thin hiss on top
      const hg = K.gain(0);
      hg.gain.setValueAtTime(0, 0);
      hg.gain.linearRampToValueAtTime(0.25, 0.48);
      hg.gain.setTargetAtTime(0, 0.52, 0.08);
      K.chain(K.noise('white', 0, 1.3), K.filter('highpass', 5000, 0.7), hg, mix);
    }
  },
  evade: {
    // missiles defeated by a roll: stereo swish across the head + airy zip
    dur: 1.1,
    bus: 'world',
    gain: 0.55,
    channels: 2,
    maxInstances: 2,
    minInterval: 0.2,
    render(K) {
      const pan = K.pan(0.8);
      if (pan.pan) {
        pan.pan.setValueAtTime(0.8, 0);
        pan.pan.linearRampToValueAtTime(-0.8, 0.7);
      }
      pan.connect(K.out);
      const bp = K.filter('bandpass', 800, 1.4);
      K.sweep(bp.frequency, 0, 800, 0.35, 3800);
      bp.frequency.exponentialRampToValueAtTime(700, 1.0);
      const g = K.gain(0);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.32);
      g.gain.setTargetAtTime(0, 0.36, 0.14);
      K.chain(K.noise('pink', 0, 1.1), bp, g, pan);
      const zip = K.osc('sawtooth', 1800, 0.25, 0.7);
      K.sweep(zip.frequency, 0.25, 1800, 0.6, 500);
      K.chain(zip, K.filter('bandpass', 1500, 3), K.pg(0.25, 0.12, 0.02, 0.1), pan);
    }
  },
  hit: {
    dur: 0.35,
    bus: 'world',
    gain: 0.4,
    channels: 1,
    variance: 0.12,
    maxInstances: 4,
    minInterval: 0.03,
    ref: 40,
    render(K) {
      const bus = K.gain(1);
      K.chain(bus, K.shaper(1.5), K.out);
      K.burst(bus, 0, 'white', 'bandpass', 3500, 1, 0.8, 0.0005, 0.008);
      const partials = [1250, 2140, 3380, 4570];
      partials.forEach((f, i) => {
        const o = K.osc('sine', f * K.rand(0.96, 1.04), 0, 0.35);
        K.chain(o, K.pg(0, 0.35 / (i + 1), 0.001, 0.05 - i * 0.008), bus);
      });
      const r = K.osc('sine', 2800, 0.01, 0.3);
      K.sweep(r.frequency, 0.01, 2800, 0.22, 1600);
      K.chain(r, K.pg(0.01, 0.2, 0.004, 0.05), bus);
    }
  },
  playerHit: {
    dur: 0.9,
    bus: 'ui',
    gain: 0.75,
    channels: 2,
    maxInstances: 2,
    render(K) {
      const bus = K.verb(0.15);
      K.thump(bus, 0, 75, 30, 0.25, 1, 0.12);
      K.burst(bus, 0, 'brown', 'lowpass', 500, 0.7, 0.8, 0.002, 0.08);
      // metallic crunch
      const n = K.noise('white', 0, 0.5);
      K.chain(n, K.filter('bandpass', 1800, 2), K.shaper(6), K.pg(0, 0.35, 0.001, 0.04), bus);
      // alarm chirp
      const f = K.filter('lowpass', 4000, 0.7);
      f.connect(bus);
      beep(K, f, 0.14, 1900, 0.06, 0.28, 'square', 0.003, 0.008);
      beep(K, f, 0.22, 1450, 0.07, 0.28, 'square', 0.003, 0.01);
    }
  },
  sonicBoom: {
    dur: 2.2,
    bus: 'world',
    gain: 0.9,
    channels: 2,
    maxInstances: 2,
    ref: 300,
    render(K) {
      const bus = K.verb(0.35);
      for (const t of [0, 0.11]) {
        K.burst(bus, t, 'white', 'highpass', 800, 0.7, 1, 0.0005, 0.008);
        K.burst(bus, t, 'brown', 'lowpass', 600, 0.7, 0.9, 0.002, 0.07);
        K.thump(bus, t, 60, 40, 0.05, 0.9, 0.09);
      }
      const r = K.noise('brown', 0.02, 2.2);
      const rg = K.gain(0);
      rg.gain.setValueAtTime(0, 0.02);
      rg.gain.linearRampToValueAtTime(0.5, 0.15);
      rg.gain.setTargetAtTime(0, 0.2, 0.45);
      K.chain(r, K.filter('lowpass', 180, 0.7), rg, bus);
    }
  },

  /* ---------------- movement / environment */
  roll: {
    dur: 1.0,
    bus: 'world',
    gain: 0.45,
    channels: 2,
    maxInstances: 2,
    render(K) {
      const pan = K.pan(-0.7);
      if (pan.pan) {
        pan.pan.setValueAtTime(-0.7, 0);
        pan.pan.linearRampToValueAtTime(0.7, 1.0);
      }
      pan.connect(K.out);
      const f = K.filter('bandpass', 300, 1.2);
      K.sweep(f.frequency, 0, 300, 0.45, 1600);
      f.frequency.exponentialRampToValueAtTime(500, 1.0);
      const g = K.gain(0);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.9, 0.45);
      g.gain.linearRampToValueAtTime(0, 0.99);
      K.chain(K.noise('pink', 0, 1), f, g, pan);
      const hg = K.gain(0);
      hg.gain.setValueAtTime(0, 0);
      hg.gain.linearRampToValueAtTime(0.12, 0.5);
      hg.gain.linearRampToValueAtTime(0, 0.99);
      K.chain(K.noise('white', 0, 1), K.filter('highpass', 3000, 0.7), hg, pan);
    }
  },
  flyby: {
    dur: 3.5,
    bus: 'world',
    gain: 0.9,
    channels: 1,
    maxInstances: 4,
    ref: 80,
    render(K) {
      const mix = K.gain(1);
      const env = K.gain(0);
      env.gain.setValueAtTime(0, 0);
      env.gain.linearRampToValueAtTime(1, 0.4);
      env.gain.setValueAtTime(1, 2.4);
      env.gain.linearRampToValueAtTime(0, 3.45);
      K.chain(mix, env, K.out);
      const roar = K.filter('lowpass', 1800, 0.5);
      K.noise('brown', 0).connect(roar);
      K.chain(K.noise('pink', 0), K.gain(0.5), roar);
      K.chain(roar, K.shaper(1.5), mix);
      const wf = K.filter('bandpass', 1400, 4);
      K.osc('sawtooth', 820, 0).connect(wf);
      K.osc('sawtooth', 1234, 0).connect(wf);
      K.chain(wf, K.gain(0.12), mix);
      K.chain(K.noise('white', 0), K.filter('highpass', 5000, 0.7), K.gain(0.15), mix);
    }
  },
  catapult: {
    dur: 3.2,
    bus: 'world',
    gain: 0.85,
    channels: 2,
    maxInstances: 1,
    render(K) {
      const bus = K.verb(0.25);
      // shuttle release clunk
      K.thump(bus, 0, 120, 60, 0.08, 0.9, 0.06);
      K.burst(bus, 0, 'white', 'lowpass', 1200, 0.7, 0.6, 0.001, 0.02);
      // steam hiss
      const hg = K.gain(0);
      hg.gain.setValueAtTime(0, 0);
      hg.gain.linearRampToValueAtTime(0.7, 0.1);
      hg.gain.setValueAtTime(0.7, 2.0);
      hg.gain.setTargetAtTime(0, 2.0, 0.35);
      K.chain(K.noise('white', 0, 3.2), K.filter('highpass', 1800, 0.7), K.filter('bandpass', 4500, 0.4), hg, bus);
      // shuttle travel rumble, rising
      const rf = K.filter('bandpass', 80, 1.4);
      K.sweep(rf.frequency, 0, 80, 2.0, 420);
      const rg = K.gain(0);
      rg.gain.setValueAtTime(0, 0);
      rg.gain.linearRampToValueAtTime(0.9, 1.95);
      rg.gain.setTargetAtTime(0, 2.02, 0.05);
      K.chain(K.noise('brown', 0, 3.2), rf, K.shaper(2), rg, bus);
      // water-brake thud + steam burst
      K.thump(bus, 2.05, 90, 40, 0.15, 1, 0.12);
      K.burst(bus, 2.05, 'brown', 'lowpass', 300, 0.7, 0.7, 0.003, 0.08);
      K.burst(bus, 2.06, 'white', 'highpass', 2000, 0.7, 0.45, 0.01, 0.15);
    }
  },

  /* ---------------- climax / cinematic */
  climaxStart: {
    dur: 3.4,
    bus: 'ui',
    gain: 0.8,
    channels: 2,
    maxInstances: 1,
    render(K) {
      const bus = K.verb(0.5);
      // reverse swell
      const sf = K.filter('bandpass', 300, 1.1);
      K.sweep(sf.frequency, 0, 300, 0.9, 5000);
      const sg = K.gain(0);
      sg.gain.setValueAtTime(EPS, 0);
      sg.gain.exponentialRampToValueAtTime(0.9, 0.88);
      sg.gain.linearRampToValueAtTime(0, 0.92);
      K.noise('white', 0, 1).connect(sf);
      K.chain(K.noise('pink', 0, 1), K.gain(0.8), sf);
      K.chain(sf, sg, bus);
      const rise = K.osc('sawtooth', 110, 0, 1);
      K.sweep(rise.frequency, 0, 110, 0.9, 880);
      const rf = K.filter('lowpass', 400, 2);
      K.sweep(rf.frequency, 0, 400, 0.9, 4000);
      const rg = K.gain(0);
      rg.gain.setValueAtTime(0, 0);
      rg.gain.linearRampToValueAtTime(0.25, 0.88);
      rg.gain.linearRampToValueAtTime(0, 0.92);
      K.chain(rise, rf, rg, bus);
      // deep boom
      const t = 0.9;
      K.thump(bus, t, 58, 22, 1.8, 1, 0.7);
      K.burst(bus, t, 'brown', 'lowpass', 260, 0.7, 0.9, 0.004, 0.3);
      K.burst(bus, t, 'white', 'highpass', 1500, 0.7, 0.5, 0.001, 0.02);
      // glassy "time freeze" shimmer
      for (const [f, d] of [[1760, 0], [2637, 3], [3520, -4]]) {
        const o = K.osc('sine', f, t, 3.4);
        o.detune.value = d;
        K.chain(o, K.pg(t, 0.05, 0.02, 0.5), bus);
      }
    }
  },
  climaxEnd: {
    dur: 1.3,
    bus: 'ui',
    gain: 0.7,
    channels: 2,
    maxInstances: 1,
    render(K) {
      const bus = K.verb(0.3);
      const f = K.filter('bandpass', 200, 1.5);
      K.sweep(f.frequency, 0, 200, 0.6, 4000);
      const g = K.gain(0);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.5);
      g.gain.linearRampToValueAtTime(0, 1.0);
      K.chain(K.noise('pink', 0, 1.2), f, g, bus);
      const o = K.osc('sawtooth', 60, 0, 1.2);
      K.sweep(o.frequency, 0, 60, 0.5, 440);
      const og = K.gain(0);
      og.gain.setValueAtTime(0, 0);
      og.gain.linearRampToValueAtTime(0.3, 0.45);
      og.gain.setTargetAtTime(0, 0.5, 0.1);
      K.chain(o, K.filter('lowpass', 1500, 1), og, bus);
      K.burst(bus, 0.5, 'white', 'highpass', 2500, 0.7, 0.5, 0.001, 0.02);
    }
  },

  /* ---------------- UI */
  uiMove: {
    dur: 0.08,
    bus: 'ui',
    gain: 0.22,
    channels: 1,
    maxInstances: 2,
    minInterval: 0.025,
    render(K) {
      K.chain(K.osc('sine', 1400, 0, 0.08), K.pg(0, 0.8, 0.001, 0.012), K.out);
      K.chain(K.osc('triangle', 2800, 0, 0.08), K.pg(0, 0.15, 0.001, 0.008), K.out);
    }
  },
  uiSelect: {
    dur: 0.3,
    bus: 'ui',
    gain: 0.22,
    channels: 1,
    maxInstances: 2,
    render(K) {
      const f = K.filter('lowpass', 3500, 0.7);
      f.connect(K.out);
      beep(K, f, 0, 880, 0.05, 0.6, 'square', 0.002, 0.01);
      beep(K, f, 0.065, 1320, 0.12, 0.6, 'square', 0.002, 0.03);
      beep(K, K.out, 0.065, 2640, 0.1, 0.12, 'sine', 0.002, 0.03);
    }
  },
  uiBack: {
    dur: 0.22,
    bus: 'ui',
    gain: 0.2,
    channels: 1,
    maxInstances: 2,
    render(K) {
      const f = K.filter('lowpass', 2500, 0.7);
      f.connect(K.out);
      beep(K, f, 0, 660, 0.05, 0.6, 'square', 0.002, 0.01);
      beep(K, f, 0.065, 440, 0.09, 0.6, 'square', 0.002, 0.02);
    }
  },
  combo: {
    dur: 0.7,
    bus: 'ui',
    gain: 0.3,
    channels: 2,
    maxInstances: 3,
    render(K) {
      const bus = K.verb(0.2);
      const note = (t, f0, p) => {
        const pn = K.pan(p);
        pn.connect(bus);
        [[1, 0.6, 0.12], [2.0, 0.25, 0.06], [3.01, 0.15, 0.04], [4.17, 0.08, 0.025]].forEach(([r, a, tc]) => {
          K.chain(K.osc('sine', f0 * r, t, t + 0.7), K.pg(t, a, 0.002, tc), pn);
        });
      };
      note(0, 1318.5, -0.2); // E6
      note(0.06, 1975.5, 0.2); // B6
    }
  },
  stageClear: {
    dur: 2.8,
    bus: 'ui',
    gain: 0.6,
    channels: 2,
    maxInstances: 1,
    render(K) {
      // original fanfare: C5 E5 G5 (triplet) - A5 - G5 - C major chord swell
      const bus = K.verb(0.35);
      const L = K.pan(-0.3);
      const R = K.pan(0.3);
      L.connect(bus);
      R.connect(bus);
      const seq = [['C5', 0, 0.08], ['E5', 0.09, 0.08], ['G5', 0.18, 0.08], ['A5', 0.27, 0.17], ['G5', 0.48, 0.1]];
      const f = noteToFreq;
      seq.forEach(([n, t, len], i) => supersawNote(K, i & 1 ? R : L, t, f(n), len, 0.3, 14, 3, 4000));
      const tc = 0.62;
      ['C4', 'G4', 'C5', 'E5', 'G5', 'C6'].forEach((n, i) => supersawNote(K, i & 1 ? R : L, tc, f(n), 1.3, 0.16, 16, 3, 3000));
      supersawNote(K, bus, tc, f('C3'), 1.3, 0.25, 6, 2, 900);
      K.thump(bus, tc, 110, 55, 0.2, 0.8, 0.25);
      const cr = K.noise('white', tc, 2.8);
      K.chain(cr, K.filter('highpass', 5000, 0.7), K.pg(tc, 0.25, 0.002, 0.45), bus);
    }
  },

  /* ---------------- alarms & body */
  gLoad: {
    dur: 1.8,
    bus: 'voice',
    gain: 0.35,
    channels: 2,
    maxInstances: 1,
    render(K) {
      const out = K.filter('lowpass', 3000, 0.7);
      out.connect(K.out);
      // inhale through mask
      const ig = K.gain(0);
      ig.gain.setValueAtTime(0, 0);
      ig.gain.linearRampToValueAtTime(0.35, 0.3);
      ig.gain.linearRampToValueAtTime(0.05, 0.45);
      const inh = K.noise('pink', 0, 0.5);
      K.chain(inh, K.filter('bandpass', 1400, 1.5), ig, out);
      K.chain(inh, K.filter('bandpass', 2600, 3), K.gain(0.5), ig);
      // strain "hnnng" through vowel formants
      const v = K.osc('sawtooth', 105, 0.4, 1.4);
      const vib = K.osc('sine', 5.3, 0.4, 1.4);
      K.chain(vib, K.gain(3), v.frequency);
      const src = K.gain(1);
      v.connect(src);
      K.chain(K.noise('pink', 0.4, 1.4), K.gain(0.3), src);
      const fg = K.gain(0);
      fg.gain.setValueAtTime(0, 0.42);
      fg.gain.linearRampToValueAtTime(0.35, 0.6);
      fg.gain.setValueAtTime(0.35, 1.15);
      fg.gain.linearRampToValueAtTime(0, 1.3);
      K.chain(src, K.filter('bandpass', 520, 5), fg, out);
      K.chain(src, K.filter('bandpass', 1100, 6), K.gain(0.6), fg);
      // exhale burst
      const eg = K.gain(0);
      K.perc(eg.gain, 1.3, 0.45, 0.03, 0.12);
      K.chain(K.noise('pink', 1.3, 1.8), K.filter('bandpass', 900, 1), eg, out);
    }
  },

  /* ---------------- internal: heartbeat + radio */
  heartbeat: {
    dur: 0.96,
    loop: { start: 0.1, fade: 0.03 },
    bus: 'ui',
    gain: 0.55,
    channels: 1,
    internal: true,
    render(K) {
      const lp = K.filter('lowpass', 160, 0.7);
      lp.connect(K.out);
      K.thump(lp, 0.1, 58, 40, 0.1, 1, 0.05);
      K.burst(lp, 0.1, 'brown', 'lowpass', 120, 0.7, 0.5, 0.004, 0.04);
      K.thump(lp, 0.38, 50, 36, 0.1, 0.75, 0.055);
    }
  },
  radioOpen: {
    dur: 0.14,
    bus: 'voice',
    gain: 0.35,
    channels: 1,
    internal: true,
    render(K) {
      const f = K.filter('highpass', 300, 0.7);
      K.chain(f, K.filter('lowpass', 3400, 0.7), K.out);
      K.burst(f, 0, 'white', 'highpass', 1000, 0.7, 0.9, 0.0005, 0.002);
      K.burst(f, 0.004, 'white', 'bandpass', 2000, 0.8, 0.7, 0.002, 0.025);
      beep(K, f, 0.01, 1750, 0.03, 0.2, 'sine', 0.002, 0.005);
    }
  },
  radioStatic: {
    dur: 1.1,
    loop: { start: 0.1, fade: 0.08 },
    bus: 'voice',
    gain: 0.16,
    channels: 1,
    internal: true,
    render(K) {
      const f = K.filter('highpass', 400, 0.7);
      K.chain(f, K.filter('lowpass', 3200, 0.7), K.out);
      K.chain(K.noise('white', 0), K.filter('bandpass', 1800, 0.5), K.gain(0.5), f);
      const cr = K.src(K.crackle(1.1, { rate: 120, burstMs: 2 }), 0);
      K.chain(cr, K.gain(0.8), f);
    }
  },
  radioClose: {
    dur: 0.24,
    bus: 'voice',
    gain: 0.35,
    channels: 1,
    internal: true,
    render(K) {
      const f = K.filter('highpass', 300, 0.7);
      K.chain(f, K.filter('lowpass', 3400, 0.7), K.out);
      K.burst(f, 0, 'white', 'bandpass', 2400, 0.8, 0.8, 0.002, 0.04);
      K.burst(f, 0.17, 'white', 'highpass', 1000, 0.7, 0.6, 0.0005, 0.002);
    }
  }
};

/** Public one-shot/loop names (excludes internal helpers). */
export const SOUND_NAMES = Object.keys(SFX_DEFS).filter((n) => !SFX_DEFS[n].internal && n !== 'vulcanTail');
export const LOOP_NAMES = Object.keys(SFX_DEFS).filter((n) => SFX_DEFS[n].loop && !SFX_DEFS[n].internal);

/* -------------------------------------------------------------- render */

/**
 * Render one definition into an AudioBuffer (peak-normalised, loop made seamless).
 * Resolves { buffer, def, loopStart, loopEnd, peak, rms }.
 */
export async function renderSound(name, def, sampleRate, shared) {
  const Off = getOfflineContextClass();
  if (!Off) throw new Error('OfflineAudioContext unavailable');
  const channels = def.channels || 2;
  const len = Math.max(1, Math.ceil(def.dur * sampleRate));
  const ctx = new Off(channels, len, sampleRate);
  const K = makeKit(ctx, shared, hashString(name));
  def.render(K);
  const buffer = await startRendering(ctx);
  const data = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) data.push(dcBlock(buffer.getChannelData(c), 0.9995));
  let loopStart = 0;
  const loopEnd = buffer.duration;
  if (def.loop) {
    const ls = Math.round(def.loop.start * sampleRate);
    crossfadeLoop(data, ls, len, Math.round((def.loop.fade ?? 0.04) * sampleRate));
    loopStart = ls / sampleRate;
  } else {
    const f = Math.min(len, Math.round(0.004 * sampleRate));
    for (const d of data) for (let i = 0; i < f; i++) d[len - 1 - i] *= i / f;
  }
  let a = analyzeChannels(data);
  if (!a.finite) throw new Error(`non-finite samples in ${name}`);
  if (a.peak > 0) {
    scaleChannels(data, (def.peak ?? 0.89) / a.peak);
    a = analyzeChannels(data);
  }
  return { buffer, def, loopStart, loopEnd, peak: a.peak, rms: a.rms };
}

/** Render many definitions in parallel (bounded concurrency). Returns Map name -> entry. */
export async function renderBank(defs, sampleRate, shared, { concurrency = 6, onProgress } = {}) {
  const names = Object.keys(defs);
  const out = new Map();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < names.length) {
      const name = names[next++];
      try {
        out.set(name, await renderSound(name, defs[name], sampleRate, shared));
      } catch (err) {
        console.warn(`[audio] failed to render "${name}":`, err);
      }
      done++;
      if (onProgress) onProgress(done, names.length, name);
    }
  };
  const n = Math.max(1, Math.min(concurrency, names.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}
