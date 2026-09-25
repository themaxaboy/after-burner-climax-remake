/**
 * instruments.js - music instruments.
 *  - DRUM_DEFS: pre-rendered one-shots (same format as SFX_DEFS; rendered into the bank at init)
 *  - live synth voices (bass, power-chord guitar, supersaw lead, pads, brass, strings, horn, pluck arp, sub)
 *    Each live voice takes (ctx, dest, t, freq|freqs, dur, vel[, lfo]) and creates a handful of
 *    short-lived nodes that stop themselves.
 */
import { EPS } from './synth.js';

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metal(K, t, t1, mult = 1) {
  const sum = K.gain(0.18);
  for (const f of METAL) K.osc('square', f * mult, t, t1).connect(sum);
  return sum;
}

function tom(f0, f1) {
  return {
    dur: 0.7,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const o = K.osc('sine', f0, 0, 0.7);
      K.sweep(o.frequency, 0, f0, 0.3, f1);
      K.chain(o, K.pg(0, 1, 0.002, 0.14), K.out);
      const tr = K.osc('triangle', f0 * 1.5, 0, 0.3);
      K.sweep(tr.frequency, 0, f0 * 1.5, 0.2, f1 * 1.5);
      K.chain(tr, K.pg(0, 0.25, 0.002, 0.05), K.out);
      K.burst(K.out, 0, 'white', 'lowpass', 3000, 0.7, 0.3, 0.001, 0.012);
    }
  };
}

export const DRUM_DEFS = {
  m_kick: {
    dur: 0.5,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const bus = K.gain(1);
      K.chain(bus, K.shaper(1.6), K.filter('lowpass', 9000, 0.7), K.out);
      const o = K.osc('sine', 160, 0, 0.5);
      o.frequency.setValueAtTime(165, 0);
      o.frequency.exponentialRampToValueAtTime(52, 0.07);
      o.frequency.exponentialRampToValueAtTime(42, 0.4);
      const g = K.gain(0);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.002);
      g.gain.setValueAtTime(1, 0.03);
      g.gain.setTargetAtTime(0, 0.03, 0.11);
      K.chain(o, g, bus);
      // beater click
      K.burst(bus, 0, 'white', 'bandpass', 3800, 0.8, 0.35, 0.0005, 0.006);
      K.chain(K.osc('triangle', 330, 0, 0.05), K.pg(0, 0.3, 0.0008, 0.01), bus);
    }
  },
  m_snare: {
    dur: 0.45,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const bus = K.gain(1);
      K.chain(bus, K.shaper(1.4), K.out);
      const b = K.osc('triangle', 190, 0, 0.3);
      K.sweep(b.frequency, 0, 190, 0.05, 160);
      K.chain(b, K.pg(0, 0.8, 0.001, 0.05), bus);
      K.chain(K.osc('sine', 330, 0, 0.2), K.pg(0, 0.35, 0.001, 0.03), bus);
      const n = K.noise('white', 0, 0.45);
      K.chain(n, K.filter('highpass', 1200, 0.7), K.filter('peaking', 5000, 0.8, 4), K.pg(0, 0.9, 0.001, 0.07), bus);
    }
  },
  m_clap: {
    dur: 0.4,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const f = K.filter('bandpass', 1200, 1.1);
      f.connect(K.out);
      const n = K.noise('white', 0, 0.4);
      const g = K.gain(0);
      for (const t of [0, 0.011, 0.022]) {
        g.gain.setValueAtTime(0.9, t);
        g.gain.setTargetAtTime(0.1, t + 0.001, 0.003);
      }
      g.gain.setValueAtTime(0.8, 0.033);
      g.gain.setTargetAtTime(0, 0.034, 0.06);
      K.chain(n, g, f);
    }
  },
  m_hatC: {
    dur: 0.1,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const f = K.filter('highpass', 7000, 0.7);
      K.chain(metal(K, 0, 0.1), K.filter('bandpass', 10000, 1), f, K.pg(0, 1, 0.0008, 0.015), K.out);
      K.chain(K.noise('white', 0, 0.1), K.filter('highpass', 8000, 0.7), K.pg(0, 0.3, 0.0008, 0.012), K.out);
    }
  },
  m_hatO: {
    dur: 0.5,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const f = K.filter('highpass', 7000, 0.7);
      K.chain(metal(K, 0, 0.5), K.filter('bandpass', 10000, 1), f, K.pg(0, 1, 0.001, 0.11), K.out);
      K.chain(K.noise('white', 0, 0.5), K.filter('highpass', 8000, 0.7), K.pg(0, 0.3, 0.001, 0.09), K.out);
    }
  },
  m_crash: {
    dur: 2.4,
    bus: 'music',
    channels: 2,
    internal: true,
    render(K) {
      const out = K.gain(1);
      K.chain(out, K.filter('highpass', 3500, 0.7), K.out);
      K.chain(K.noise('white', 0, 2.4), K.filter('bandpass', 8000, 0.35), K.pg(0, 0.8, 0.002, 0.5), out);
      K.chain(metal(K, 0, 2.4, 1.47), K.filter('bandpass', 6000, 0.6), K.pg(0, 0.7, 0.002, 0.35), out);
      K.chain(K.noise('white', 0, 0.3), K.filter('highpass', 6000, 0.7), K.pg(0, 0.6, 0.001, 0.03), out);
    }
  },
  m_ride: {
    dur: 1.2,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const out = K.filter('highpass', 4000, 0.7);
      out.connect(K.out);
      K.chain(metal(K, 0, 1.2, 2.1), K.filter('bandpass', 9000, 1.2), K.pg(0, 0.6, 0.001, 0.3), out);
      K.chain(K.osc('sine', 3100, 0, 1.2), K.pg(0, 0.15, 0.001, 0.25), out);
      K.chain(K.noise('white', 0, 0.1), K.pg(0, 0.35, 0.0005, 0.01), out);
    }
  },
  m_shaker: {
    dur: 0.14,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const g = K.gain(0);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(1, 0.012);
      g.gain.setTargetAtTime(0, 0.014, 0.022);
      K.chain(K.noise('white', 0, 0.14), K.filter('highpass', 6000, 0.7), K.filter('bandpass', 9500, 0.8), g, K.out);
    }
  },
  m_tomH: tom(210, 150),
  m_tomM: tom(155, 110),
  m_tomL: tom(110, 76),
  /** Timpani tuned to A2 (110 Hz); pitched by playbackRate. */
  m_timpani: {
    dur: 2.6,
    bus: 'music',
    channels: 1,
    internal: true,
    render(K) {
      const out = K.gain(1);
      out.connect(K.out);
      const modes = [[1, 1, 0.55], [1.5, 0.45, 0.35], [1.99, 0.3, 0.25], [2.44, 0.18, 0.15], [2.99, 0.1, 0.1]];
      for (const [r, a, tc] of modes) {
        const o = K.osc('sine', 110 * r * 1.03, 0, 2.6);
        o.frequency.setValueAtTime(110 * r * 1.03, 0);
        o.frequency.exponentialRampToValueAtTime(110 * r, 0.12);
        K.chain(o, K.pg(0, a, 0.004, tc), out);
      }
      K.thump(out, 0, 90, 45, 0.1, 0.6, 0.12);
      K.burst(out, 0, 'white', 'lowpass', 900, 0.7, 0.35, 0.001, 0.015);
    }
  },
  /** Reverse cymbal swell peaking at the very end of the buffer. */
  m_revCymbal: {
    dur: 3.0,
    bus: 'music',
    channels: 2,
    internal: true,
    render(K) {
      const f = K.filter('highpass', 800, 0.7);
      K.sweep(f.frequency, 0, 800, 2.95, 5000);
      const g = K.gain(0);
      g.gain.setValueAtTime(EPS, 0);
      g.gain.exponentialRampToValueAtTime(1, 2.97);
      g.gain.linearRampToValueAtTime(0, 3.0);
      K.chain(K.noise('white', 0, 3), K.filter('bandpass', 7000, 0.4), f, g, K.out);
      K.chain(metal(K, 0, 3, 1.47), K.filter('bandpass', 6000, 0.6), K.gain(0.5), g);
    }
  }
};

/* ============================================================== live voices */

function osc(ctx, type, freq, detune, t0, t1, dest) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (detune) o.detune.value = detune;
  o.connect(dest);
  o.start(t0);
  o.stop(t1);
  return o;
}

function filt(ctx, type, freq, Q) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}

/** Pick bass: saw + sub triangle through an enveloped resonant lowpass. */
export function playBass(ctx, dest, t, freq, dur, vel) {
  const f = filt(ctx, 'lowpass', 400, 3);
  const g = ctx.createGain();
  const end = t + Math.max(0.05, dur - 0.01);
  osc(ctx, 'sawtooth', freq, 0, t, end + 0.15, f);
  osc(ctx, 'triangle', freq * 0.5, 0, t, end + 0.15, f);
  f.frequency.setValueAtTime(Math.min(8000, freq * 12 + 900 * vel), t);
  f.frequency.setTargetAtTime(freq * 3 + 150, t, 0.05);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.004);
  g.gain.setTargetAtTime(vel * 0.65, t + 0.004, 0.08);
  g.gain.setTargetAtTime(0, end, 0.018);
  f.connect(g).connect(dest);
}

/** Sub bass (anthem): sine + soft triangle. */
export function playSub(ctx, dest, t, freq, dur, vel) {
  const f = filt(ctx, 'lowpass', 500, 0.7);
  const g = ctx.createGain();
  const end = t + Math.max(0.1, dur - 0.05);
  osc(ctx, 'sine', freq, 0, t, end + 1, f);
  const tg = ctx.createGain();
  tg.gain.value = 0.35;
  osc(ctx, 'triangle', freq, 0, t, end + 1, tg);
  tg.connect(f);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.06);
  g.gain.setTargetAtTime(0, end, 0.15);
  f.connect(g).connect(dest);
}

const FIFTH = Math.pow(2, 7 / 12);

/**
 * Power chord into the (shared) amp chain: root x2 detuned, fifth, octave.
 * muted=true -> palm-muted chug (dark, short).
 */
export function playPowerChord(ctx, dest, t, root, dur, vel, muted) {
  const f = filt(ctx, 'lowpass', muted ? 650 + 500 * vel : 3000, muted ? 1.2 : 0.7);
  const g = ctx.createGain();
  const end = muted ? t + 0.42 : t + Math.max(0.08, dur) + 0.25;
  osc(ctx, 'sawtooth', root, -7, t, end, f);
  osc(ctx, 'sawtooth', root, 7, t, end, f);
  osc(ctx, 'sawtooth', root * FIFTH, 3, t, end, f);
  osc(ctx, 'sawtooth', root * 2, -4, t, end, f);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.003);
  if (muted) {
    g.gain.setTargetAtTime(0, t + 0.01, 0.045);
  } else {
    f.frequency.setTargetAtTime(1900, t + 0.02, 0.5);
    g.gain.setTargetAtTime(vel * 0.75, t + 0.003, 0.3);
    g.gain.setTargetAtTime(0, t + Math.max(0.06, dur - 0.02), 0.035);
  }
  f.connect(g).connect(dest);
}

/** Supersaw lead: 5 detuned saws, filter envelope, optional shared vibrato LFO (to detune). */
export function playSupersaw(ctx, dest, t, freq, dur, vel, lfo) {
  const f = filt(ctx, 'lowpass', 1200, 0.9);
  const g = ctx.createGain();
  const end = t + Math.max(0.05, dur - 0.015);
  for (const d of [-21, -9, 0, 9, 21]) {
    const o = osc(ctx, 'sawtooth', freq, d, t, end + 0.5, f);
    if (lfo) lfo.connect(o.detune);
  }
  f.frequency.setValueAtTime(1400, t);
  f.frequency.linearRampToValueAtTime(Math.min(12000, 5200 + freq), t + 0.03);
  f.frequency.setTargetAtTime(Math.min(9000, 2600 + freq * 1.5), t + 0.03, 0.25);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.012);
  g.gain.setTargetAtTime(vel * 0.8, t + 0.012, 0.2);
  g.gain.setTargetAtTime(0, end, 0.07);
  f.connect(g).connect(dest);
}

/** Horn/brass lead for the anthem: saws + octave-down triangle, swelling filter, vibrato. */
export function playHorn(ctx, dest, t, freq, dur, vel, lfo) {
  const f = filt(ctx, 'lowpass', 500, 1.2);
  const g = ctx.createGain();
  const end = t + Math.max(0.1, dur - 0.03);
  for (const d of [-6, 6]) {
    const o = osc(ctx, 'sawtooth', freq, d, t, end + 1.2, f);
    if (lfo) lfo.connect(o.detune);
  }
  osc(ctx, 'triangle', freq * 0.5, 0, t, end + 1.2, f);
  f.frequency.setValueAtTime(500, t);
  f.frequency.setTargetAtTime(900 + 1600 * vel, t, 0.08);
  f.frequency.setTargetAtTime(700 + 900 * vel, t + 0.3, 0.6);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.07);
  g.gain.setTargetAtTime(vel * 0.85, t + 0.07, 0.4);
  g.gain.setTargetAtTime(0, end, 0.18);
  f.connect(g).connect(dest);
}

/** Plucky arp note. */
export function playPluck(ctx, dest, t, freq, dur, vel) {
  const f = filt(ctx, 'lowpass', 4000, 3);
  const g = ctx.createGain();
  osc(ctx, 'sawtooth', freq, 0, t, t + 0.7, f);
  osc(ctx, 'square', freq, 7, t, t + 0.7, f);
  f.frequency.setValueAtTime(4500, t);
  f.frequency.setTargetAtTime(500, t, 0.05);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.004, 0.06 + Math.min(dur, 0.3) * 0.13);
  f.connect(g).connect(dest);
}

/** Warm synth pad (chord): 2 saws per note, gentle lowpass, slow attack. */
export function playPad(ctx, dest, t, freqs, dur, vel) {
  const f = filt(ctx, 'lowpass', 1500, 0.5);
  const g = ctx.createGain();
  const end = t + dur;
  for (const fr of freqs) {
    osc(ctx, 'sawtooth', fr, -9, t, end + 2, f);
    osc(ctx, 'sawtooth', fr, 9, t, end + 2, f);
  }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.25);
  g.gain.setTargetAtTime(0, end, 0.3);
  f.connect(g).connect(dest);
}

/** Orchestral-ish strings: 3 saws per note, wide detune, band-limited, slow bow. */
export function playStrings(ctx, dest, t, freqs, dur, vel) {
  const hp = filt(ctx, 'highpass', 180, 0.7);
  const f = filt(ctx, 'lowpass', 2600, 0.5);
  const g = ctx.createGain();
  const end = t + dur;
  for (const fr of freqs) {
    osc(ctx, 'sawtooth', fr, -13, t, end + 3, hp);
    osc(ctx, 'sawtooth', fr, 0, t, end + 3, hp);
    osc(ctx, 'sawtooth', fr, 12, t, end + 3, hp);
  }
  g.gain.setValueAtTime(0, t);
  g.gain.setTargetAtTime(vel, t, 0.35);
  g.gain.setTargetAtTime(0, end, 0.5);
  hp.connect(f).connect(g).connect(dest);
}

/** Brass section chord: filter swell (the "blat"), vibrato LFO on detune. */
export function playBrass(ctx, dest, t, freqs, dur, vel, lfo) {
  const f = filt(ctx, 'lowpass', 350, 1.0);
  const g = ctx.createGain();
  const end = t + dur;
  for (const fr of freqs) {
    for (const d of [-7, 7]) {
      const o = osc(ctx, 'sawtooth', fr, d, t, end + 1.5, f);
      if (lfo) lfo.connect(o.detune);
    }
  }
  f.frequency.setValueAtTime(350, t);
  f.frequency.setTargetAtTime(900 + 1700 * vel, t + 0.02, 0.09);
  f.frequency.setTargetAtTime(700 + 800 * vel, t + 0.4, 0.7);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.09);
  g.gain.setTargetAtTime(vel * 0.8, t + 0.09, 0.5);
  g.gain.setTargetAtTime(0, end, 0.25);
  f.connect(g).connect(dest);
}

/** Buffer one-shot helper (drums): source -> gain -> dest. */
export function playSample(ctx, dest, buffer, t, gain, rate = 1, offset = 0) {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  if (rate !== 1) s.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  s.connect(g).connect(dest);
  s.start(t, offset);
  return g;
}
