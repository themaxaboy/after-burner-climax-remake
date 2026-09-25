/**
 * audio.js - AudioEngine: context, buses, voice pool, positional/doppler, loops,
 * continuous jet-engine sound, slow-motion time scale, radio, music.
 *
 * Graph:
 *   worldIn -> worldFilter(LP, slow-mo) -> worldVol --+--> master -> glue comp -> limiter -> soft clip -> out
 *                                           \-> worldSend -> reverbIn
 *   uiIn -> uiVol ------------------------------------+
 *   voiceIn -> voiceVol -------------------------------+
 *   musicIn -> musicFilter -> musicDuck -> musicVol ---+
 *   musicRev (instances' sends) -> reverbIn
 *   reverbIn -> convolver(procedural IR) -> reverbFilter -> reverbReturn -> master
 *   pooled HRTF PannerNodes -> worldIn
 *
 * Every public method is a safe no-op until init() has resolved (music.play is remembered).
 */
import {
  bufferFromChannels,
  clamp,
  createImpulseBuffer,
  createNoiseBuffer,
  dopplerRate,
  getAudioContextClass,
  getOfflineContextClass,
  hashString,
  makeCrackle,
  makeDriveCurve,
  makeSoftClipCurve,
  makeStereoPanner,
  mulberry32,
  startRendering,
  timeScaleToCutoff,
  timeScaleToRate
} from './synth.js';
import { SFX_DEFS, SOUND_NAMES, LOOP_NAMES, renderBank } from './sfxBank.js';
import { DRUM_DEFS } from './instruments.js';
import { MusicPlayer } from './music.js';

const EMPTY = Object.freeze({});
const DEFAULT_VOLUMES = { master: 0.9, sfx: 1, music: 0.7, voice: 1 };
const WORLD_MIN_CUTOFF = 1200;
const MUSIC_MIN_CUTOFF = 900;
const ENGINE_LEVEL = 0.36;

/** Pre-master headroom trim (the glue compressor adds automatic make-up gain). */
const MASTER_TRIM = 0.75;

/** Master bus: glue compressor -> fast limiter -> transparent-below-0.8 soft clipper. */
export function buildMasterChain(ctx) {
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -10;
  glue.knee.value = 8;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.006;
  glue.release.value = 0.2;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  const clip = ctx.createWaveShaper();
  clip.curve = makeSoftClipCurve();
  glue.connect(limiter).connect(clip);
  return { input: glue, output: clip, glue, limiter };
}

/* -------------------------------------------------------------- voices */

class Voice {
  constructor(index) {
    this.index = index;
    this.id = 0;
    this.active = false;
    this.stopping = false;
    this.src = null;
    this.gain = null;
    this.panner = null; // pool slot { node, owner }
    this.name = '';
    this.bus = '';
    this.world = false;
    this.positional = false;
    this.hasVel = false;
    this.startTime = 0;
    this.dur = 0;
    this.level = 1;
    this.baseRate = 1;
    this.doppler = 1;
    this.defGain = 1;
    this.px = 0;
    this.py = 0;
    this.pz = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
  }
}

/** Returned by play(). Methods are no-ops once the voice has ended or been stolen. */
export class VoiceHandle {
  constructor(engine, voice) {
    this._e = engine;
    this._v = voice;
    this.id = voice.id;
    this.name = voice.name;
  }
  get playing() {
    return this._v.id === this.id && this._v.active && !this._v.stopping;
  }
  stop(fade = 0.05) {
    if (this.playing) this._e._stopVoice(this._v, fade);
  }
  setPosition(p) {
    const v = this._v;
    if (this.playing && v.positional && p) {
      v.px = p.x;
      v.py = p.y;
      v.pz = p.z;
      this._e._setPannerPos(v.panner.node, v.px, v.py, v.pz);
    }
    return this;
  }
  setVelocity(vel) {
    const v = this._v;
    if (this.playing && vel) {
      v.vx = vel.x;
      v.vy = vel.y;
      v.vz = vel.z;
      v.hasVel = true;
    }
    return this;
  }
  setGain(g, tc = 0.05) {
    const v = this._v;
    if (this.playing) v.gain.gain.setTargetAtTime(Math.max(0, g) * v.defGain, this._e.ctx.currentTime, tc);
    return this;
  }
  setRate(r) {
    const v = this._v;
    if (this.playing && r > 0) {
      v.baseRate = r;
      this._e._applyVoiceRate(v, 0.03);
    }
    return this;
  }
}

/* ---------------------------------------------------------- jet engine */

/**
 * Build the continuous jet-engine graph on any BaseAudioContext.
 * noise = {white, pink, brown} looping AudioBuffers, crackle = AudioBuffer.
 */
export function buildEngineGraph(ctx, dest, noise, crackle, startAt = ctx.currentTime) {
  const gain = (v) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const filter = (type, f, Q = 0.7071) => {
    const n = ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = Q;
    return n;
  };
  const rng = mulberry32(99);
  const loop = (buf) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(startAt, rng() * buf.duration * 0.9);
    return s;
  };
  const osc = (type, f, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.start(startAt);
    return o;
  };
  const out = gain(0);
  out.gain.setValueAtTime(0, startAt);
  out.gain.setTargetAtTime(ENGINE_LEVEL, startAt, 0.25);
  out.connect(dest);

  const brown = loop(noise.brown);
  const rumbleLp = filter('lowpass', 200, 0.7);
  const rumbleG = gain(0);
  brown.connect(rumbleLp).connect(rumbleG).connect(out);
  const buffetG = gain(0);
  brown.connect(filter('lowpass', 70, 1.2)).connect(buffetG).connect(out);

  const w1 = osc('sawtooth', 400);
  const w2 = osc('triangle', 400, 9);
  const w3 = osc('sine', 1600);
  const whineBp = filter('bandpass', 800, 1.2);
  const whineG = gain(0);
  w1.connect(whineBp);
  w2.connect(whineBp);
  whineBp.connect(whineG).connect(out);
  const hiG = gain(0);
  w3.connect(hiG).connect(out);

  const white = loop(noise.white);
  const hissG = gain(0);
  white.connect(filter('highpass', 3500, 0.7)).connect(hissG).connect(out);

  const brown2 = loop(noise.brown);
  const abLp = filter('lowpass', 300, 0.9);
  const abShape = ctx.createWaveShaper();
  abShape.curve = makeDriveCurve(2.5);
  const abG = gain(0);
  brown2.connect(abLp).connect(abShape).connect(abG).connect(out);
  const pinkAb = loop(noise.pink);
  pinkAb.connect(filter('bandpass', 600, 0.8)).connect(abG);
  const crk = loop(crackle);
  const crG = gain(0);
  crk.connect(filter('bandpass', 1800, 0.8)).connect(crG).connect(out);
  const sub = osc('sine', 38);
  const subG = gain(0);
  sub.connect(subG).connect(out);

  const pink = loop(noise.pink);
  const windBp = filter('bandpass', 800, 0.8);
  const windG = gain(0);
  pink.connect(windBp).connect(windG).connect(out);

  return {
    out,
    sources: [brown, white, brown2, pinkAb, crk, pink],
    oscs: [w1, w2, w3, sub],
    rumbleLp, rumbleG, buffetG, w1, w2, w3, whineBp, whineG, hiG, hissG,
    abLp, abG, crG, subG, windBp, windG,
    rate: 1
  };
}

/** Map engine parameters onto the graph (zero allocations). */
export function applyEngineParams(E, p, tsRate, now, tc = 0.15) {
  const th = clamp(p.throttle, 0, 1);
  const ab = clamp(p.afterburner, 0, 1);
  const sp = clamp((p.speed - 150) / 250, 0, 1);
  const gl = clamp((p.gLoad - 1) / 8, 0, 1);
  const r = tsRate;
  const wf = (220 + 460 * th + 220 * sp) * r; // turbine whine 220..900 Hz
  E.w1.frequency.setTargetAtTime(wf, now, tc * 2);
  E.w2.frequency.setTargetAtTime(wf * 1.006, now, tc * 2);
  E.w3.frequency.setTargetAtTime(wf * 4.1, now, tc * 2);
  E.whineBp.frequency.setTargetAtTime(wf * 1.8, now, tc);
  E.whineG.gain.setTargetAtTime(0.035 + 0.05 * th, now, tc);
  E.hiG.gain.setTargetAtTime(0.006 + 0.012 * th, now, tc);
  E.rumbleLp.frequency.setTargetAtTime((140 + 240 * th + 200 * ab) * r, now, tc);
  E.rumbleG.gain.setTargetAtTime(0.35 + 0.3 * th + 0.2 * ab, now, tc);
  E.buffetG.gain.setTargetAtTime(0.7 * Math.max(0, gl - 0.35), now, tc);
  E.hissG.gain.setTargetAtTime(0.02 + 0.03 * th + 0.04 * sp, now, tc);
  E.abG.gain.setTargetAtTime(0.6 * ab, now, tc * 0.8);
  E.abLp.frequency.setTargetAtTime((220 + 500 * ab) * r, now, tc);
  E.crG.gain.setTargetAtTime(0.45 * ab, now, tc);
  E.subG.gain.setTargetAtTime(0.25 * ab, now, tc);
  E.windBp.frequency.setTargetAtTime((450 + 1400 * sp) * r, now, tc);
  E.windG.gain.setTargetAtTime(0.04 + 0.35 * sp * sp + 0.1 * gl, now, tc);
  if (Math.abs(E.rate - r) > 1e-4) {
    E.rate = r;
    for (let i = 0; i < E.sources.length; i++) E.sources[i].playbackRate.setTargetAtTime(r, now, 0.08);
  }
}

/* ============================================================== engine */

export class AudioEngine {
  constructor(options = {}) {
    this.options = { maxVoices: 24, pannerPoolSize: 8, hrtf: true, reverbSeconds: 1.8, ...options };
    this.ctx = null;
    this.isReady = false;
    this.music = new MusicPlayer(this);
    this.renderTimeMs = 0;
    this._vol = { ...DEFAULT_VOLUMES };
    this._ts = 1;
    this._tsRate = 1;
    this._L = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0, vx: 0, vy: 0, vz: 0 };
    this._voices = [];
    this._panners = [];
    this._serial = 0;
    this._loops = new Map();
    this._bank = new Map();
    this._musicBuffers = {};
    this._lastPlay = new Map();
    this._eng = null;
    this._engineParams = { throttle: 0.5, afterburner: 0, speed: 250, gLoad: 1 };
    this._irBuffer = null;
    this._reverbReturnLevel = 0.5;
    this._initPromise = null;
    this._retimeLoop = (lp) => {
      if (lp.world) lp.src.playbackRate.setTargetAtTime(lp.baseRate * this._tsRate, this.ctx.currentTime, 0.06);
    };
  }

  /** True when the browser has Web Audio at all. */
  static get isSupported() {
    return !!getAudioContextClass();
  }

  get state() {
    return this.ctx ? this.ctx.state : 'uninitialized';
  }

  /* ------------------------------------------------------------- init */

  /**
   * Create the AudioContext (call from a user gesture), build the graph and pre-render
   * every sound. Safe to call repeatedly: later calls just resume a suspended context.
   * Resolves true when ready, false when Web Audio is unavailable.
   */
  init() {
    if (this._initPromise) {
      this._resumeCtx();
      return this._initPromise;
    }
    const AC = getAudioContextClass();
    if (!AC) {
      this._initPromise = Promise.resolve(false);
      return this._initPromise;
    }
    let ctx = null;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try {
        ctx = new AC();
      } catch (err) {
        console.warn('[audio] AudioContext creation failed', err);
        this._initPromise = Promise.resolve(false);
        return this._initPromise;
      }
    }
    this.ctx = ctx;
    this._resumeCtx(); // synchronously inside the gesture
    this._unlock();
    this._buildGraph();
    this._initPromise = this._load().then(
      () => {
        this.isReady = true;
        this._applyVolumes(true);
        this._applyListener();
        if (this._ts !== 1) {
          const ts = this._ts;
          this._ts = 1;
          this.setTimeScale(ts);
        }
        this.music._onReady();
        return true;
      },
      (err) => {
        console.warn('[audio] init failed', err);
        return false;
      }
    );
    return this._initPromise;
  }

  _resumeCtx() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    try {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      /* ignore */
    }
    // if the call was not inside a gesture, retry on the next one
    if (typeof window !== 'undefined' && !this._gestureHooked) {
      this._gestureHooked = true;
      const retry = () => {
        if (this.ctx && this.ctx.state === 'suspended' && !this._userSuspended) this.ctx.resume().catch(() => {});
        if (this.ctx && this.ctx.state === 'running') {
          window.removeEventListener('pointerdown', retry, true);
          window.removeEventListener('keydown', retry, true);
          window.removeEventListener('touchend', retry, true);
        }
      };
      window.addEventListener('pointerdown', retry, true);
      window.addEventListener('keydown', retry, true);
      window.addEventListener('touchend', retry, true);
    }
  }

  _unlock() {
    try {
      const b = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(this.ctx.destination);
      s.start(0);
    } catch (e) {
      /* ignore */
    }
  }

  _buildGraph() {
    const ctx = this.ctx;
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const lp = (f) => {
      const n = ctx.createBiquadFilter();
      n.type = 'lowpass';
      n.frequency.value = f;
      n.Q.value = 0.7071;
      return n;
    };
    const top = Math.min(20000, ctx.sampleRate / 2 - 100);
    this._nyq = top;

    this._master = g(this._vol.master * MASTER_TRIM);
    const chain = buildMasterChain(ctx);
    this._master.connect(chain.input);
    chain.output.connect(ctx.destination);
    this._outNode = chain.output;

    // reverb
    this._irBuffer = createImpulseBuffer(ctx, this.options.reverbSeconds);
    this._reverbIn = g(1);
    const conv = ctx.createConvolver();
    conv.buffer = this._irBuffer;
    this._reverbFilter = lp(top);
    this._reverbReturn = g(this._reverbReturnLevel);
    this._reverbIn.connect(conv).connect(this._reverbFilter).connect(this._reverbReturn).connect(this._master);

    // world (sfx) bus
    this._worldIn = g(1);
    this._worldFilter = lp(top);
    this._worldVol = g(this._vol.sfx);
    this._worldSend = g(0.18);
    this._worldIn.connect(this._worldFilter).connect(this._worldVol).connect(this._master);
    this._worldVol.connect(this._worldSend).connect(this._reverbIn);

    // ui + voice
    this._uiIn = g(1);
    this._uiVol = g(this._vol.sfx);
    this._uiIn.connect(this._uiVol).connect(this._master);
    this._voiceIn = g(1);
    this._voiceVol = g(this._vol.voice);
    this._voiceIn.connect(this._voiceVol).connect(this._master);

    // music
    this._musicIn = g(1);
    this._musicFilter = lp(top);
    this._musicDuck = g(1);
    this._musicVol = g(this._vol.music);
    this._musicIn.connect(this._musicFilter).connect(this._musicDuck).connect(this._musicVol).connect(this._master);
    this._musicRev = g(this._vol.music);
    this._musicRev.connect(this._reverbIn);

    // panner pool
    for (let i = 0; i < this.options.pannerPoolSize; i++) {
      const p = ctx.createPanner();
      p.panningModel = this.options.hrtf ? 'HRTF' : 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 50;
      p.maxDistance = 20000;
      p.rolloffFactor = 1;
      p.connect(this._worldIn);
      this._panners.push({ node: p, owner: null });
    }
    for (let i = 0; i < this.options.maxVoices; i++) this._voices.push(new Voice(i));
  }

  async _load() {
    const ctx = this.ctx;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this._noise = {
      white: createNoiseBuffer(ctx, 'white', 2.5, 11),
      pink: createNoiseBuffer(ctx, 'pink', 2.5, 12),
      brown: createNoiseBuffer(ctx, 'brown', 3, 13)
    };
    const rng = mulberry32(5);
    const clen = Math.floor(2 * ctx.sampleRate);
    this._crackleBuf = bufferFromChannels(ctx, [
      makeCrackle(clen, ctx.sampleRate, rng, { rate: 260, burstMs: 1.5 }),
      makeCrackle(clen, ctx.sampleRate, rng, { rate: 260, burstMs: 1.5 })
    ]);
    if (!getOfflineContextClass()) {
      console.warn('[audio] OfflineAudioContext unavailable - sound effects disabled');
      return;
    }
    const shared = { noise: this._noise, ir: this._irBuffer };
    const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
    this._bank = await renderBank({ ...SFX_DEFS, ...DRUM_DEFS }, ctx.sampleRate, shared, { concurrency: clamp(cores - 1, 2, 6) });
    for (const k of Object.keys(DRUM_DEFS)) {
      const e = this._bank.get(k);
      if (e) this._musicBuffers[k] = e.buffer;
    }
    if (typeof performance !== 'undefined') this.renderTimeMs = performance.now() - t0;
  }

  _musicRig() {
    return { output: this._musicIn, reverbInput: this._musicRev, buffers: this._musicBuffers };
  }

  _busInput(bus) {
    switch (bus) {
      case 'ui':
        return this._uiIn;
      case 'voice':
        return this._voiceIn;
      case 'music':
        return this._musicIn;
      default:
        return this._worldIn;
    }
  }

  /* ---------------------------------------------------------- volumes */

  /** { master, sfx, music, voice } each 0..1 (missing keys unchanged). Remembered before init. */
  setVolumes(v) {
    if (!v) return;
    const keys = ['master', 'sfx', 'music', 'voice'];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const x = v[k];
      if (typeof x === 'number' && Number.isFinite(x)) this._vol[k] = clamp(x, 0, 1);
    }
    if (this.ctx && this._master) this._applyVolumes(false);
  }

  getVolumes() {
    return { ...this._vol };
  }

  _applyVolumes(immediate) {
    const t = this.ctx.currentTime;
    const V = this._vol;
    const set = (param, val) => {
      if (immediate) param.value = val;
      else param.setTargetAtTime(val, t, 0.05);
    };
    set(this._master.gain, V.master * MASTER_TRIM);
    set(this._worldVol.gain, V.sfx);
    set(this._uiVol.gain, V.sfx);
    set(this._voiceVol.gain, V.voice);
    set(this._musicVol.gain, V.music);
    set(this._musicRev.gain, V.music);
  }

  /* --------------------------------------------------------- listener */

  /** Per frame. Vector3-like {x,y,z}; velocity is used for doppler. No allocations. */
  setListener(pos, forward, up, velocity) {
    const L = this._L;
    if (pos) {
      L.px = pos.x;
      L.py = pos.y;
      L.pz = pos.z;
    }
    if (forward) {
      L.fx = forward.x;
      L.fy = forward.y;
      L.fz = forward.z;
    }
    if (up) {
      L.ux = up.x;
      L.uy = up.y;
      L.uz = up.z;
    }
    if (velocity) {
      L.vx = velocity.x;
      L.vy = velocity.y;
      L.vz = velocity.z;
    }
    if (this.ctx) this._applyListener();
  }

  _applyListener() {
    const l = this.ctx.listener;
    const L = this._L;
    if (l.positionX) {
      l.positionX.value = L.px;
      l.positionY.value = L.py;
      l.positionZ.value = L.pz;
      l.forwardX.value = L.fx;
      l.forwardY.value = L.fy;
      l.forwardZ.value = L.fz;
      l.upX.value = L.ux;
      l.upY.value = L.uy;
      l.upZ.value = L.uz;
    } else if (l.setPosition) {
      l.setPosition(L.px, L.py, L.pz);
      l.setOrientation(L.fx, L.fy, L.fz, L.ux, L.uy, L.uz);
    }
  }

  _setPannerPos(p, x, y, z) {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }

  /* ---------------------------------------------------------- one-shots */

  /**
   * Play a one-shot. opts { position, velocity, gain, rate, pan, delay }.
   * Positional when `position` is given (pooled HRTF panner + doppler), else stereo.
   * Returns a VoiceHandle or null.
   */
  play(name, opts) {
    if (!this.isReady) return null;
    const entry = this._bank.get(name);
    if (!entry) return null;
    const o = opts || EMPTY;
    const def = entry.def;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (def.minInterval) {
      const last = this._lastPlay.get(name);
      if (last !== undefined && now - last < def.minInterval) return null;
      this._lastPlay.set(name, now);
    }
    if (def.maxInstances) this._limitInstances(name, def.maxInstances);

    const positional = !!o.position && this._panners.length > 0;
    const voice = this._allocVoice();
    voice.id = ++this._serial;
    voice.name = name;
    voice.bus = def.bus;
    voice.world = def.bus === 'world' || positional;
    voice.positional = positional;
    voice.stopping = false;

    let rate = o.rate > 0 ? o.rate : 1;
    if (def.variance) rate *= 1 + (Math.random() * 2 - 1) * def.variance;
    voice.baseRate = rate;
    voice.doppler = 1;
    voice.hasVel = false;
    if (positional) {
      voice.px = o.position.x;
      voice.py = o.position.y;
      voice.pz = o.position.z;
      if (o.velocity) {
        voice.vx = o.velocity.x;
        voice.vy = o.velocity.y;
        voice.vz = o.velocity.z;
        voice.hasVel = true;
      } else voice.vx = voice.vy = voice.vz = 0;
      voice.doppler = this._dopplerFor(voice);
    }

    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.playbackRate.value = rate * voice.doppler * (voice.world ? this._tsRate : 1);
    const g = ctx.createGain();
    voice.defGain = def.gain ?? 1;
    voice.level = (o.gain >= 0 ? o.gain : 1) * voice.defGain;
    g.gain.value = voice.level;
    src.connect(g);
    let sp = null;
    if (positional) {
      const slot = this._acquirePanner(voice);
      slot.node.refDistance = def.ref || 50;
      this._setPannerPos(slot.node, voice.px, voice.py, voice.pz);
      g.connect(slot.node);
    } else {
      const dest = this._busInput(def.bus);
      if (o.pan) sp = makeStereoPanner(ctx, clamp(o.pan, -1, 1));
      if (sp) g.connect(sp).connect(dest);
      else g.connect(dest);
    }
    const when = now + (o.delay > 0 ? o.delay : 0);
    src.start(when);
    voice.src = src;
    voice.gain = g;
    voice.startTime = when;
    voice.dur = entry.buffer.duration / (rate * voice.doppler * (voice.world ? this._tsRate : 1));
    voice.active = true;
    const id = voice.id;
    src.onended = () => {
      try {
        g.disconnect();
        if (sp) sp.disconnect();
      } catch (e) {
        /* ignore */
      }
      if (voice.id === id) this._releaseVoice(voice);
    };
    return new VoiceHandle(this, voice);
  }

  _dopplerFor(v) {
    const L = this._L;
    return dopplerRate(L.px, L.py, L.pz, L.vx, L.vy, L.vz, v.px, v.py, v.pz, v.hasVel ? v.vx : 0, v.hasVel ? v.vy : 0, v.hasVel ? v.vz : 0);
  }

  _limitInstances(name, max) {
    let count = 0;
    let oldest = null;
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (!v.active || v.stopping || v.name !== name) continue;
      count++;
      if (!oldest || v.startTime < oldest.startTime) oldest = v;
    }
    if (count >= max && oldest) this._stopVoice(oldest, 0.03);
  }

  _allocVoice() {
    const now = this.ctx.currentTime;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (!v.active) return v;
      let score;
      if (v.stopping) score = -1;
      else {
        const remaining = v.dur > 0 ? Math.max(0, 1 - (now - v.startTime) / v.dur) : 0;
        score = v.level * remaining * (v.bus === 'world' ? 1 : 3);
      }
      if (score < bestScore) {
        bestScore = score;
        best = v;
      }
    }
    this._kill(best, 0.02);
    return best;
  }

  _acquirePanner(voice) {
    let slot = null;
    for (let i = 0; i < this._panners.length; i++) {
      if (!this._panners[i].owner) {
        slot = this._panners[i];
        break;
      }
    }
    if (!slot) {
      for (let i = 0; i < this._panners.length; i++) {
        const p = this._panners[i];
        if (!slot || p.owner.startTime < slot.owner.startTime) slot = p;
      }
      this._kill(slot.owner, 0.03);
    }
    slot.owner = voice;
    voice.panner = slot;
    return slot;
  }

  /** Fade out and forget a voice immediately (its nodes clean themselves up onended). */
  _kill(v, fade) {
    if (!v || !v.active) return;
    const t = this.ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.01);
    } catch (e) {
      /* already stopped */
    }
    this._releaseVoice(v);
  }

  _stopVoice(v, fade = 0.05) {
    if (!v.active || v.stopping) return;
    const t = this.ctx.currentTime;
    v.stopping = true;
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + Math.max(0.005, fade));
      v.src.stop(t + Math.max(0.005, fade) + 0.01);
    } catch (e) {
      /* ignore */
    }
  }

  _releaseVoice(v) {
    v.active = false;
    v.stopping = false;
    v.src = null;
    v.gain = null;
    if (v.panner) {
      if (v.panner.owner === v) v.panner.owner = null;
      v.panner = null;
    }
  }

  _applyVoiceRate(v, tc) {
    if (!v.src) return;
    v.src.playbackRate.setTargetAtTime(v.baseRate * v.doppler * (v.world ? this._tsRate : 1), this.ctx.currentTime, tc);
  }

  /** Stop every one-shot and loop (e.g. scene change). Music continues unless {music:true}. */
  stopAll({ fade = 0.1, music = false } = {}) {
    if (!this.isReady) return;
    for (let i = 0; i < this._voices.length; i++) if (this._voices[i].active) this._stopVoice(this._voices[i], fade);
    for (const name of [...this._loops.keys()]) this.stopLoop(name, { fade, tail: false });
    if (music) this.music.stop({ fadeOut: fade });
  }

  /* ------------------------------------------------------------ loops */

  /** Start a looping sound by name (idempotent). opts { gain, rate, pan, fadeIn }. */
  startLoop(name, opts) {
    if (!this.isReady) return false;
    const entry = this._bank.get(name);
    if (!entry) return false;
    const o = opts || EMPTY;
    const existing = this._loops.get(name);
    if (existing) {
      if (o.gain != null || o.rate != null) this.setLoop(name, o);
      return true;
    }
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const def = entry.def;
    const world = def.bus === 'world';
    const src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.loop = true;
    src.loopStart = entry.loopStart;
    src.loopEnd = entry.loopEnd;
    const rate = o.rate > 0 ? o.rate : 1;
    src.playbackRate.value = rate * (world ? this._tsRate : 1);
    const g = ctx.createGain();
    const level = (o.gain >= 0 ? o.gain : 1) * (def.gain ?? 1);
    const fadeIn = o.fadeIn > 0 ? o.fadeIn : 0.015;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + fadeIn);
    src.connect(g);
    const sp = o.pan ? makeStereoPanner(ctx, clamp(o.pan, -1, 1)) : null;
    const dest = this._busInput(def.bus);
    if (sp) g.connect(sp).connect(dest);
    else g.connect(dest);
    src.start(now);
    this._loops.set(name, { name, src, gain: g, pan: sp, def, world, baseRate: rate });
    return true;
  }

  /** Stop a loop (idempotent). opts { fade=0.06, tail=true } - tail plays e.g. the vulcan spin-down. */
  stopLoop(name, opts) {
    const lp = this._loops.get(name);
    if (!lp || !this.ctx) return false;
    const o = opts || EMPTY;
    const fade = o.fade > 0 ? o.fade : 0.06;
    const t = this.ctx.currentTime;
    const gp = lp.gain.gain;
    gp.cancelScheduledValues(t);
    gp.setValueAtTime(gp.value, t);
    gp.linearRampToValueAtTime(0, t + fade);
    lp.src.stop(t + fade + 0.02);
    lp.src.onended = () => {
      lp.gain.disconnect();
      if (lp.pan) lp.pan.disconnect();
    };
    this._loops.delete(name);
    if (lp.def.tail && o.tail !== false) this.play(lp.def.tail);
    return true;
  }

  /** Change a running loop's gain / rate smoothly. */
  setLoop(name, { gain, rate } = EMPTY) {
    const lp = this._loops.get(name);
    if (!lp) return false;
    const t = this.ctx.currentTime;
    if (gain != null) lp.gain.gain.setTargetAtTime(Math.max(0, gain) * (lp.def.gain ?? 1), t, 0.05);
    if (rate > 0) {
      lp.baseRate = rate;
      lp.src.playbackRate.setTargetAtTime(rate * (lp.world ? this._tsRate : 1), t, 0.03);
    }
    return true;
  }

  _setLoopGain(name, gain) {
    const lp = this._loops.get(name);
    if (lp) lp.gain.gain.setTargetAtTime(Math.max(0, gain) * (lp.def.gain ?? 1), this.ctx.currentTime, 0.05);
  }

  isLooping(name) {
    return this._loops.has(name);
  }

  /* ------------------------------------------------------ jet engine */

  /**
   * Continuous engine: { throttle 0..1, afterburner 0..1, speed m/s (150..400), gLoad 1..9 }.
   * Starts the loops on the first call after init. Zero allocations.
   */
  setEngine(p) {
    const E = this._engineParams;
    if (p) {
      if (typeof p.throttle === 'number') E.throttle = p.throttle;
      if (typeof p.afterburner === 'number') E.afterburner = p.afterburner;
      if (typeof p.speed === 'number') E.speed = p.speed;
      if (typeof p.gLoad === 'number') E.gLoad = p.gLoad;
    }
    if (!this.isReady) return;
    if (!this._eng) {
      this._eng = buildEngineGraph(this.ctx, this._worldIn, this._noise, this._crackleBuf);
      applyEngineParams(this._eng, E, this._tsRate, this.ctx.currentTime, 0.01);
      return;
    }
    applyEngineParams(this._eng, E, this._tsRate, this.ctx.currentTime);
  }

  /** Fade the engine out and release its nodes (next setEngine rebuilds it). */
  stopEngine({ fade = 0.5 } = {}) {
    const E = this._eng;
    if (!E) return;
    this._eng = null;
    const t = this.ctx.currentTime;
    E.out.gain.cancelScheduledValues(t);
    E.out.gain.setTargetAtTime(0, t, fade / 4);
    const end = t + fade + 0.05;
    for (const s of E.sources) s.stop(end);
    for (const o of E.oscs) o.stop(end);
    setTimeout(() => E.out.disconnect(), (fade + 0.2) * 1000);
  }

  /* ------------------------------------------------------- time scale */

  /**
   * 1 = normal, ~0.3 = "Climax" slow motion: world bus lowpass sweep, pitch-down of world
   * buffer sources and engine by sqrt(ts), filtered music, heartbeat under 0.6.
   */
  setTimeScale(ts) {
    const v = clamp(Number.isFinite(ts) ? ts : 1, 0.05, 2);
    if (Math.abs(v - this._ts) < 1e-3) return;
    this._ts = v;
    this._tsRate = timeScaleToRate(v);
    if (!this.isReady) return;
    const now = this.ctx.currentTime;
    const r = this._tsRate;
    const wc = Math.min(this._nyq, timeScaleToCutoff(v, WORLD_MIN_CUTOFF));
    this._worldFilter.frequency.setTargetAtTime(wc, now, 0.05);
    this._reverbFilter.frequency.setTargetAtTime(wc, now, 0.05);
    this._musicFilter.frequency.setTargetAtTime(Math.min(this._nyq, timeScaleToCutoff(v, MUSIC_MIN_CUTOFF)), now, 0.08);
    for (let i = 0; i < this._voices.length; i++) {
      const vc = this._voices[i];
      if (vc.active && vc.world && vc.src) vc.src.playbackRate.setTargetAtTime(vc.baseRate * vc.doppler * r, now, 0.06);
    }
    this._loops.forEach(this._retimeLoop);
    if (this._eng) applyEngineParams(this._eng, this._engineParams, r, now, 0.06);
    if (v < 0.6) {
      const level = clamp((0.6 - v) / 0.3, 0.35, 1);
      if (!this._loops.has('heartbeat')) this.startLoop('heartbeat', { gain: level, fadeIn: 0.3 });
      else this._setLoopGain('heartbeat', level);
    } else if (this._loops.has('heartbeat')) this.stopLoop('heartbeat', { fade: 0.4 });
  }

  get timeScale() {
    return this._ts;
  }

  /* ------------------------------------------------------------ radio */

  /**
   * Radio transmission bed: squelch open + short static + squelch close on the voice bus.
   * Music is ducked meanwhile. opts { duration=0.9 } seconds of static. Returns total seconds.
   */
  radio(callsign, opts) {
    if (!this.isReady) return 0;
    const open = this._bank.get('radioOpen');
    const stat = this._bank.get('radioStatic');
    const close = this._bank.get('radioClose');
    if (!open || !stat || !close) return 0;
    const o = opts || EMPTY;
    const dur = clamp(o.duration > 0 ? o.duration : 0.9, 0.1, 15);
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const rate = 0.94 + (hashString(callsign || '') % 13) / 100;
    const dest = this._voiceIn;
    const one = (entry, when, gain) => {
      const s = ctx.createBufferSource();
      s.buffer = entry.buffer;
      s.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = gain;
      s.connect(g).connect(dest);
      s.start(when);
      s.onended = () => g.disconnect();
      return { s, g };
    };
    one(open, t, open.def.gain);
    const st = ctx.createBufferSource();
    st.buffer = stat.buffer;
    st.loop = true;
    st.loopStart = stat.loopStart;
    st.loopEnd = stat.loopEnd;
    st.playbackRate.value = rate;
    const sg = ctx.createGain();
    const lvl = stat.def.gain * (o.gain > 0 ? o.gain : 1);
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(lvl, t + 0.05);
    sg.gain.setValueAtTime(lvl, t + 0.05 + dur);
    sg.gain.linearRampToValueAtTime(0, t + 0.09 + dur);
    st.connect(sg).connect(dest);
    st.start(t + 0.02);
    st.stop(t + 0.12 + dur);
    st.onended = () => sg.disconnect();
    one(close, t + 0.05 + dur, close.def.gain);
    const duck = this._musicDuck.gain;
    duck.setTargetAtTime(0.55, t, 0.05);
    duck.setTargetAtTime(1, t + dur + 0.2, 0.25);
    return 0.06 + dur + close.buffer.duration;
  }

  /* ----------------------------------------------------------- frame */

  /** Per frame: extrapolate moving positional voices, update panners and doppler. No allocations. */
  update(realDt) {
    if (!this.isReady) return;
    const dt = realDt > 0 ? (realDt > 0.1 ? 0.1 : realDt) : 0;
    const wdt = dt * this._ts;
    const now = this.ctx.currentTime;
    const r = this._tsRate;
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (!v.active || !v.positional || !v.panner) continue;
      if (v.hasVel && wdt > 0) {
        v.px += v.vx * wdt;
        v.py += v.vy * wdt;
        v.pz += v.vz * wdt;
        this._setPannerPos(v.panner.node, v.px, v.py, v.pz);
      }
      const d = this._dopplerFor(v);
      if (Math.abs(d - v.doppler) > 0.002) {
        v.doppler = d;
        v.src.playbackRate.setTargetAtTime(v.baseRate * d * r, now, 0.04);
      }
    }
  }

  /* ------------------------------------------------------ pause menu */

  suspend() {
    this._userSuspended = true;
    this.music._pause();
    if (!this.ctx || this.ctx.state !== 'running') return Promise.resolve();
    return this.ctx.suspend().catch(() => {});
  }

  resume() {
    this._userSuspended = false;
    if (!this.ctx) return Promise.resolve();
    return this.ctx
      .resume()
      .then(() => this.music._resume())
      .catch(() => {});
  }

  /* ------------------------------------------------------ utilities */

  get soundNames() {
    return SOUND_NAMES;
  }
  get loopNames() {
    return LOOP_NAMES;
  }

  /** The pre-rendered AudioBuffer for a sound (or null). */
  getBuffer(name) {
    const e = this._bank.get(name);
    return e ? e.buffer : null;
  }

  /** Debug counters. */
  stats() {
    let voices = 0;
    let positional = 0;
    for (const v of this._voices) {
      if (v.active) voices++;
      if (v.active && v.positional) positional++;
    }
    return {
      state: this.state,
      voices,
      positional,
      loops: [...this._loops.keys()],
      engine: !!this._eng,
      music: this.music.currentTrack,
      musicInstances: this.music.instances.length,
      timeScale: this._ts,
      renderTimeMs: Math.round(this.renderTimeMs),
      bankSize: this._bank.size
    };
  }

  /** AnalyserNode tapped after the master chain (for meters/scopes). */
  createAnalyser(fftSize = 2048) {
    if (!this.ctx) return null;
    const a = this.ctx.createAnalyser();
    a.fftSize = fftSize;
    this._outNode.connect(a);
    return a;
  }

  /**
   * Offline mix of pre-rendered sounds through a replica of the master chain.
   * events: [{ name, time=0, gain=1, rate=1 }]. Resolves an AudioBuffer (or null).
   */
  async renderOfflineMix(events, seconds = 3) {
    const Off = getOfflineContextClass();
    if (!Off || !this.isReady) return null;
    const sr = this.ctx.sampleRate;
    const off = new Off(2, Math.ceil(seconds * sr), sr);
    const master = off.createGain();
    master.gain.value = this._vol.master * MASTER_TRIM;
    const chain = buildMasterChain(off);
    master.connect(chain.input);
    chain.output.connect(off.destination);
    for (const ev of events) {
      const e = this._bank.get(ev.name);
      if (!e) continue;
      const s = off.createBufferSource();
      s.buffer = e.buffer;
      s.playbackRate.value = ev.rate > 0 ? ev.rate : 1;
      const g = off.createGain();
      g.gain.value = (ev.gain >= 0 ? ev.gain : 1) * (e.def.gain ?? 1);
      s.connect(g).connect(master);
      s.start(ev.time || 0);
    }
    return startRendering(off);
  }

  /** Render the jet-engine loop offline (level checks). */
  async renderEngineOffline(params, seconds = 2) {
    const Off = getOfflineContextClass();
    if (!Off || !this.isReady) return null;
    const sr = this.ctx.sampleRate;
    const off = new Off(2, Math.ceil(seconds * sr), sr);
    const E = buildEngineGraph(off, off.destination, this._noise, this._crackleBuf, 0);
    applyEngineParams(E, { ...this._engineParams, ...params }, 1, 0, 0.01);
    E.out.gain.cancelScheduledValues(0);
    E.out.gain.setValueAtTime(ENGINE_LEVEL, 0);
    return startRendering(off);
  }

  /** Close the context and release everything. */
  async dispose() {
    this.music.stop({ fadeOut: 0.01 });
    this.music._stopTimer();
    this.isReady = false;
    if (this.ctx && this.ctx.state !== 'closed') await this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
