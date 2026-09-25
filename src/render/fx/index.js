// FX: the game's visual effects library (explosions, smoke, sparks, trails,
// tracers, afterburners, vapor cones, beams).
//
//   const fx = new FX({ scene, renderer, maxParticles, quality });
//   fx.update(realDt, worldTime, camera);  // once per rendered frame
//
// Particles are stateless on the GPU (spawn once, evaluated analytically from
// world time), so slow motion slows every effect for free and the CPU cost of
// a live particle is zero. Pools are preallocated; emitters never allocate.
import { Color, Group, Vector2 } from 'three';
import { fxQuality, TRAIL_DEFAULTS, TRAIL_KINDS, K_FIRE, K_FLASH, K_SPARK, K_GLOW, K_FLARE, K_RING, K_EMBER, K_MUZZLE, S_SMOKE, S_DEBRIS, S_SPRAY, S_MIST } from './config.js';
import { createFxTextures } from './atlas.js';
import { ParticleLayer } from './particles.js';
import { TrailSystem } from './trails.js';
import { Tracers } from './tracers.js';
import { Afterburner } from './afterburner.js';
import { VaporCone } from './vapor.js';
import { Beam, disposeBeamGeometry } from './beam.js';
import { worldFogUniforms } from './glsl.js';
import { motionAt } from './ballistic.js';
import {
  FxRng, makeParticle, recipeDebris, recipeEmitterPuff, recipeExplosion, recipeFlares, recipeHeadGlow,
  recipeHitSparks, recipeMuzzle, recipeShockRing, recipeSmokePuff, recipeSplash, resetParticle
} from './recipes.js';

export { FX_QUALITY, fxQuality, TRAIL_DEFAULTS } from './config.js';

const MAX_EMITTERS = 32;
const _m = { x: 0, y: 0, z: 0 };
const _c = new Color();
const _vp = new Vector2();

const NULL_TRAIL = Object.freeze({ push() {}, stop() {}, alive: false, index: -1 });
const NULL_EMITTER = Object.freeze({ update() {}, stop() {}, alive: false });

class TrailHandle {
  constructor(fx, j, gen) {
    this.fx = fx;
    this.index = j;
    this.gen = gen;
  }
  /** Head position (world). Optional explicit world time. */
  push(pos, time) {
    const b = this.fx.trails.buf;
    const j = this.index;
    if (b.gen[j] !== this.gen || b.state[j] !== 1) return;
    b.push(j, pos.x, pos.y, pos.z, time === undefined ? this.fx.time : time);
  }
  /** Stop emitting; the trail fades and is recycled automatically. */
  stop() {
    const b = this.fx.trails.buf;
    if (b.gen[this.index] === this.gen) b.stop(this.index, this.fx.time);
  }
  get alive() {
    const b = this.fx.trails.buf;
    return b.gen[this.index] === this.gen && b.state[this.index] !== 0;
  }
}

class EmitterSlot {
  constructor() {
    this.active = false;
    this.gen = 0;
    this.fire = true;
    this.has = false;
    this.primed = false;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.px = 0; this.py = 0; this.pz = 0;
    this.intensity = 1;
    this.lastT = 0;
    this.acc = 0;
  }
}

class EmitterHandle {
  constructor(slot, gen) {
    this.slot = slot;
    this.gen = gen;
  }
  /** pos/vel world (Vector3-like), intensity 0..1+ (0 = no emission). */
  update(pos, vel, intensity = 1) {
    const s = this.slot;
    if (!s.active || s.gen !== this.gen) return;
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    if (vel) {
      s.vx = vel.x; s.vy = vel.y; s.vz = vel.z;
    }
    s.intensity = intensity;
    s.has = true;
  }
  stop() {
    if (this.slot.gen === this.gen) this.slot.active = false;
  }
  get alive() {
    return this.slot.active && this.slot.gen === this.gen;
  }
}

class Follower {
  constructor() {
    this.active = false;
    this.pending = false;
    this.j = -1;
    this.gen = 0;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.k = 0; this.ay = 0; this.t0 = 0; this.life = 0;
  }
}

export class FX {
  /**
   * @param {object} o
   * @param {import('three').Scene} o.scene
   * @param {import('three').WebGLRenderer} o.renderer
   * @param {number} [o.maxParticles]  total particle pool (default per quality: 4k/8k/16k/32k)
   * @param {'low'|'medium'|'high'|'ultra'} [o.quality]
   */
  constructor({ scene, renderer, maxParticles, quality = 'high' } = {}) {
    const Q = fxQuality(quality);
    this.Q = Q;
    this.quality = Q.name;
    this.scene = scene;
    this.renderer = renderer;
    const cap = Math.max(512, (maxParticles || Q.particles) | 0);
    const capSmoke = Math.floor(cap * Q.smokeShare);
    const capAdd = cap - capSmoke;
    this.time = 0;
    this._started = false;

    this.textures = createFxTextures(renderer, { atlasSize: Q.atlas, noiseSize: Q.noise });
    const fog = worldFogUniforms();
    const u = (this.uniforms = {
      uFxTime: { value: 0 },
      uViewport: { value: new Vector2(1920, 1080) },
      uMinPx: { value: 1.3 },
      uMaxPx: { value: 900 },
      uFxSun: { value: 3.5 }, // sun radiance scale (game: sun light intensity)
      uFxAmbient: { value: 0.55 }, // sky ambient scale on uFogColor
      uFxSkyTint: { value: new Color(0.72, 0.88, 1.2) }, // shadow side of smoke is cooler (sky light)
      uAtlas: { value: this.textures.atlas },
      uNoise: { value: this.textures.noise }
    });
    const pu = { ...fog, uFxTime: u.uFxTime, uViewport: u.uViewport, uMinPx: u.uMinPx, uMaxPx: u.uMaxPx, uAtlas: u.uAtlas, uFxSun: u.uFxSun, uFxAmbient: u.uFxAmbient, uFxSkyTint: u.uFxSkyTint };
    this.smokeLayer = new ParticleLayer({ capacity: capSmoke, additive: false, uniforms: pu, name: 'fxSmoke' });
    this.addLayer = new ParticleLayer({ capacity: capAdd, additive: true, uniforms: pu, name: 'fxAdditive' });
    this.trails = new TrailSystem({
      maxTrails: Q.trails,
      points: Q.trailPoints,
      uniforms: { ...fog, uFxTime: u.uFxTime, uViewport: u.uViewport, uNoise: u.uNoise, uFxSun: u.uFxSun, uFxAmbient: u.uFxAmbient, uFxSkyTint: u.uFxSkyTint }
    });
    this._trailGlow = new Float32Array(Q.trails);
    this.tracers = new Tracers({ capacity: Q.tracers, uniforms: { uViewport: u.uViewport, fog } });
    this._shared = { uFxTime: u.uFxTime, uFxSun: u.uFxSun, uFxAmbient: u.uFxAmbient, uFxSkyTint: u.uFxSkyTint, fog };
    this.vapor = new VaporCone({ uniforms: this._shared, noise: this.textures.noise });

    this.group = new Group();
    this.group.name = 'fx';
    this.group.add(this.smokeLayer.mesh, this.trails.mesh, this.addLayer.mesh, this.tracers.mesh);
    if (scene) scene.add(this.group);

    this.afterburners = [];
    this.beams = [];
    this.emitters = [];
    for (let i = 0; i < MAX_EMITTERS; i++) this.emitters.push(new EmitterSlot());
    this.followers = [];
    for (let i = 0; i < Math.max(8, Q.trails >> 1); i++) this.followers.push(new Follower());
    this._warm = 0;
    this._warmObjects = null;

    this.P = makeParticle();
    this.rng = new FxRng(0x5eed1);
    const rng = this.rng;
    const smoke = this.smokeLayer, add = this.addLayer;
    this.sink = {
      time: 0,
      q: Q.count,
      flares: Q.flares,
      rand: () => rng.next(),
      add: (P) => add.push(P),
      smoke: (P) => smoke.push(P),
      flareTrail: (x, y, z, vx, vy, vz, k, ay, life, delay) => this._flareTrail(x, y, z, vx, vy, vz, k, ay, life, delay)
    };
  }

  /** Sun radiance scale for lit smoke (set to the sun light intensity) and sky ambient. */
  setLighting(sunIntensity, ambient) {
    if (sunIntensity !== undefined) this.uniforms.uFxSun.value = sunIntensity;
    if (ambient !== undefined) this.uniforms.uFxAmbient.value = ambient;
  }

  _begin(seed) {
    if (seed !== undefined && seed !== null) this.rng.seed(seed);
    this.sink.time = this.time;
    return this.sink;
  }

  // ------------------------------------------------------------ one-shots

  /** opts: { size = 1, vel = null, kind = 'air'|'big'|'ground'|'water'|'missile', seed } */
  explosion(pos, opts) {
    let size = 1, vel = null, kind = 'air', seed;
    if (opts) {
      if (opts.size !== undefined) size = opts.size;
      if (opts.vel) vel = opts.vel;
      if (opts.kind) kind = opts.kind;
      seed = opts.seed;
    }
    const s = this._begin(seed);
    recipeExplosion(s, this.P, pos.x, pos.y, pos.z, vel ? vel.x : 0, vel ? vel.y : 0, vel ? vel.z : 0, size, kind);
  }

  hitSparks(pos, dir, count = 12) {
    const s = this._begin();
    recipeHitSparks(s, this.P, pos.x, pos.y, pos.z, dir ? dir.x : 0, dir ? dir.y : 0, dir ? dir.z : -1, count);
  }

  smokePuff(pos, vel, size = 4, life = 2) {
    const s = this._begin();
    recipeSmokePuff(s, this.P, pos.x, pos.y, pos.z, vel ? vel.x : 0, vel ? vel.y : 0, vel ? vel.z : 0, size, life);
  }

  debris(pos, vel, count = 10) {
    const s = this._begin();
    recipeDebris(s, this.P, pos.x, pos.y, pos.z, vel ? vel.x : 0, vel ? vel.y : 0, vel ? vel.z : 0, count, 1, 0.3);
  }

  waterSplash(pos, size = 1) {
    const s = this._begin();
    recipeSplash(s, this.P, pos.x, pos.y, pos.z, size);
  }

  /** dir = barrel direction; optional vel = shooter velocity (keeps the flash on the gun). */
  muzzleFlash(pos, dir, vel) {
    const s = this._begin();
    recipeMuzzle(s, this.P, pos.x, pos.y, pos.z, dir.x, dir.y, dir.z, vel ? vel.x : 0, vel ? vel.y : 0, vel ? vel.z : 0);
  }

  flareBurst(pos, vel) {
    const s = this._begin();
    return recipeFlares(s, this.P, pos.x, pos.y, pos.z, vel ? vel.x : 0, vel ? vel.y : 0, vel ? vel.z : 0);
  }

  shockRing(pos, size = 40) {
    const s = this._begin();
    recipeShockRing(s, this.P, pos.x, pos.y, pos.z, size);
  }

  /** Transonic vapor cone attached to object3D (the jet group). strength 0..1. opts {z, length, radius}. */
  vaporCone(object3D, strength, opts) {
    this.vapor.set(object3D, strength, opts);
  }

  // ------------------------------------------------------------ continuous

  /** Ribbon trail. kind: 'missile'|'vortex'|'contrail'|'smoke'|'fire'|'flare'. width = start width (m). */
  createTrail(opts) {
    let kind = 'missile', width, life, color, opacity, headGlow;
    if (opts) {
      if (opts.kind) kind = opts.kind;
      width = opts.width;
      life = opts.life;
      color = opts.color;
      opacity = opts.opacity;
      headGlow = opts.headGlow;
    }
    const d = TRAIL_DEFAULTS[kind] || TRAIL_DEFAULTS.missile;
    const kid = TRAIL_KINDS[kind] ?? 0;
    const buf = this.trails.buf;
    const j = buf.alloc();
    if (j < 0) return NULL_TRAIL;
    const w0 = width !== undefined ? width : d.width0;
    const w1 = width !== undefined ? width * (d.width1 / d.width0) : d.width1;
    const lf = life !== undefined ? life : d.life;
    let r = d.color[0], g = d.color[1], b = d.color[2];
    if (color !== undefined && color !== null) {
      if (Array.isArray(color)) _c.setRGB(color[0], color[1], color[2]);
      else _c.set(color);
      r = _c.r; g = _c.g; b = _c.b;
    }
    const gen = buf.begin(j, this.time, w0, w1, lf, kid, r, g, b, opacity !== undefined ? opacity : d.opacity);
    this._trailGlow[j] = (headGlow !== undefined ? headGlow : d.headGlow) ? Math.max(0.5, w0) : 0;
    return new TrailHandle(this, j, gen);
  }

  /** Burning / damaged wreck smoke. handle.update(pos, vel, intensity) each frame; handle.stop(). */
  createSmokeEmitter(opts) {
    const fire = opts && opts.fire === false ? false : true;
    for (let i = 0; i < this.emitters.length; i++) {
      const s = this.emitters[i];
      if (s.active) continue;
      s.active = true;
      s.gen++;
      s.fire = fire;
      s.has = false;
      s.primed = false;
      s.acc = 0;
      s.vx = s.vy = s.vz = 0;
      s.intensity = 1;
      return new EmitterHandle(s, s.gen);
    }
    return NULL_EMITTER;
  }

  /**
   * Engine exhaust for a jet. nozzles: [{position, radius, direction}] in the
   * jet's LOCAL space (direction = exhaust flow, e.g. +Z). Add `ab.object` to
   * the jet group; call ab.set(throttle01, afterburner01).
   */
  createAfterburner(nozzles, opts) {
    const ab = new Afterburner(nozzles, {
      color: opts && opts.color,
      steps: this.Q.abSteps,
      uniforms: this._shared,
      noise: this.textures.noise
    });
    this.afterburners.push(ab);
    const self = this;
    const dispose = ab.dispose.bind(ab);
    ab.dispose = function () {
      const i = self.afterburners.indexOf(ab);
      if (i >= 0) self.afterburners.splice(i, 1);
      dispose();
    };
    return ab;
  }

  /** Volumetric light cone (apex at origin, pointing -Z). */
  createBeam(opts) {
    const beam = new Beam({
      length: opts && opts.length !== undefined ? opts.length : 600,
      radius: opts && opts.radius !== undefined ? opts.radius : 60,
      color: opts && opts.color !== undefined ? opts.color : 0xfff2dd,
      uniforms: this._shared,
      noise: this.textures.noise
    });
    this.beams.push(beam);
    const self = this;
    const dispose = beam.dispose.bind(beam);
    beam.dispose = function () {
      const i = self.beams.indexOf(beam);
      if (i >= 0) self.beams.splice(i, 1);
      dispose();
    };
    return beam;
  }

  _flareTrail(x, y, z, vx, vy, vz, k, ay, life, delay = 0) {
    let f = null;
    for (let i = 0; i < this.followers.length; i++) {
      if (!this.followers[i].active) {
        f = this.followers[i];
        break;
      }
    }
    if (!f) return false;
    const buf = this.trails.buf;
    const j = buf.alloc();
    if (j < 0) return false;
    const d = TRAIL_DEFAULTS.flare;
    const gen = buf.begin(j, this.time, d.width0, d.width1, d.life, TRAIL_KINDS.flare, d.color[0], d.color[1], d.color[2], d.opacity);
    this._trailGlow[j] = 0;
    f.active = true;
    f.j = j;
    f.gen = gen;
    f.x = x; f.y = y; f.z = z;
    f.vx = vx; f.vy = vy; f.vz = vz;
    f.k = k; f.ay = ay;
    f.t0 = this.time + delay;
    f.life = life * 0.92;
    f.pending = true; // shifted to the rendered frame like its particles
    return true;
  }

  // ------------------------------------------------------------ frame

  /**
   * Once per rendered frame. worldTime = accumulated world seconds (slow-mo
   * aware). Effects triggered since the previous frame start at this frame.
   */
  update(realDt, worldTime, camera) {
    const wt = worldTime !== undefined ? worldTime : this.time + realDt;
    // world clock went backwards (stage restart): nothing alive can be valid any more
    if (this._started && wt < this.time - 1e-3) this.clear();
    const dtW = this._started ? Math.max(0, wt - this.time) : 0;
    this._started = true;
    this.smokeLayer.shiftPending(wt - this.time);
    this.addLayer.shiftPending(wt - this.time);
    for (let i = 0; i < this.followers.length; i++) {
      const f = this.followers[i];
      if (f.pending) {
        f.t0 += wt - this.time;
        f.pending = false;
      }
    }
    // trails pushed with the old clock keep their (slightly older) births
    this.time = wt;
    this.sink.time = wt;
    const u = this.uniforms;
    u.uFxTime.value = wt;
    if (this.renderer) {
      this.renderer.getDrawingBufferSize(_vp);
      if (_vp.y > 0) u.uViewport.value.copy(_vp);
    }
    u.uMaxPx.value = u.uViewport.value.y * this.Q.maxScreen;

    // analytic trail followers (flares)
    const buf = this.trails.buf;
    for (let i = 0; i < this.followers.length; i++) {
      const f = this.followers[i];
      if (!f.active) continue;
      if (buf.gen[f.j] !== f.gen || buf.state[f.j] !== 1) {
        f.active = false;
        continue;
      }
      const t = wt - f.t0;
      if (t < 0) continue;
      if (t > f.life) {
        buf.stop(f.j, wt);
        f.active = false;
        continue;
      }
      motionAt(_m, f.x, f.y, f.z, f.vx, f.vy, f.vz, f.k, f.ay, t);
      buf.push(f.j, _m.x, _m.y, _m.z, wt);
    }

    // burning wreck emitters
    const s = this.sink;
    for (let i = 0; i < this.emitters.length; i++) {
      const e = this.emitters[i];
      if (!e.active || !e.has) continue;
      if (!e.primed) {
        e.primed = true;
        e.px = e.x; e.py = e.y; e.pz = e.z;
        e.lastT = wt;
        continue;
      }
      const dt = wt - e.lastT;
      if (dt <= 0) continue;
      const it = e.intensity;
      if (it > 0.01) {
        const dx = e.x - e.px, dy = e.y - e.py, dz = e.z - e.pz;
        const dist = Math.hypot(dx, dy, dz);
        const spacing = 3 + 2.5 * (1 - Math.min(it, 1));
        let want = e.acc + Math.max(dt * (10 + 30 * it), dist / spacing);
        let n = Math.floor(want);
        e.acc = want - n;
        if (n > 8) n = 8;
        for (let k = 1; k <= n; k++) {
          const f = k / n;
          recipeEmitterPuff(s, this.P, e.px + dx * f, e.py + dy * f, e.pz + dz * f, e.vx, e.vy, e.vz, it, e.fire, e.lastT + dt * f);
        }
      }
      e.px = e.x; e.py = e.y; e.pz = e.z;
      e.lastT = wt;
    }

    // missile motor glow at trail heads
    for (let j = 0; j <= buf.hi; j++) {
      const g = this._trailGlow[j];
      if (g <= 0 || buf.state[j] !== 1 || wt - buf.lastPush[j] > 0.1 || buf.count[j] === 0) continue;
      recipeHeadGlow(s, this.P, buf.headPos[j * 3], buf.headPos[j * 3 + 1], buf.headPos[j * 3 + 2],
        buf.headVel[j * 3], buf.headVel[j * 3 + 1], buf.headVel[j * 3 + 2], g);
    }

    for (let i = 0; i < this.afterburners.length; i++) this.afterburners[i].update(dtW, wt);
    this.vapor.update(realDt);

    this.trails.update(wt);
    this.smokeLayer.flush();
    this.addLayer.flush();

    if (this._warm > 0 && --this._warm === 0) this._endWarmup();
    this.camera = camera;
  }

  /** Removes every live particle, trail, emitter and flare follower (e.g. on stage restart). */
  clear() {
    this.smokeLayer.killAll();
    this.addLayer.killAll();
    const buf = this.trails.buf;
    for (let j = 0; j < buf.maxTrails; j++) buf.kill(j);
    for (let i = 0; i < this.emitters.length; i++) {
      this.emitters[i].active = false;
      this.emitters[i].gen++;
    }
    for (let i = 0; i < this.followers.length; i++) this.followers[i].active = false;
    this.tracers.setData(this.tracers.pos.array, this.tracers.vel.array, 0);
  }

  /**
   * Makes every FX program/geometry live so `renderer.compileAsync(scene,
   * camera)` (or the next render) compiles and uploads everything before
   * gameplay. Warm objects are hidden again after two updates.
   */
  warmup() {
    const P = this.P;
    const far = -20000;
    const addKinds = [K_FIRE, K_FLASH, K_SPARK, K_GLOW, K_FLARE, K_RING, K_EMBER, K_MUZZLE];
    const smokeKinds = [S_SMOKE, S_DEBRIS, S_SPRAY, S_MIST];
    for (const k of addKinds) {
      resetParticle(P);
      P.y = far; P.t0 = this.time; P.life = 0.05; P.kind = k; P.r = 0; P.g = 0; P.b = 1; P.i = 0;
      this.addLayer.push(P);
    }
    for (const k of smokeKinds) {
      resetParticle(P);
      P.y = far; P.t0 = this.time; P.life = 0.05; P.kind = k; P.i = 0;
      this.smokeLayer.push(P);
    }
    this.tracers.setData(new Float32Array([0, far, 0]), new Float32Array([0, 0, -1000]), 1);
    if (!this._warmObjects) {
      const ab = new Afterburner([{ position: { x: 0, y: far, z: 0 }, radius: 0.5, direction: { x: 0, y: 0, z: 1 } }], {
        steps: this.Q.abSteps, uniforms: this._shared, noise: this.textures.noise
      });
      const beam = new Beam({ length: 10, radius: 1, uniforms: this._shared, noise: this.textures.noise });
      beam.mesh.position.y = far;
      this._warmObjects = { ab, beam };
      this.group.add(ab.object, beam.object);
    }
    this._warmObjects.ab.object.visible = true;
    this._warmObjects.beam.object.visible = true;
    if (!this.vapor.parent) this.group.add(this.vapor.mesh);
    this.vapor.mesh.visible = true;
    this.trails.mesh.visible = true;
    this._warm = 2;
  }

  _endWarmup() {
    if (this._warmObjects) {
      // stay in the graph (hidden) so their programs are never released
      this._warmObjects.ab.object.visible = false;
      this._warmObjects.beam.object.visible = false;
    }
    if (!this.vapor.parent) this.vapor.mesh.visible = false;
    this.tracers.setData(this.tracers.pos.array, this.tracers.vel.array, 0);
  }

  /** { particles, smoke, additive, trails, emitters, drawCalls } */
  stats() {
    const smoke = this.smokeLayer.alive(this.time);
    const add = this.addLayer.alive(this.time);
    let calls = 2;
    if (this.trails.mesh.visible) calls++;
    if (this.tracers.mesh.visible) calls++;
    if (this.vapor.mesh.visible && this.vapor.parent) calls++;
    for (const ab of this.afterburners) if (ab.object.parent && ab.object.visible) calls++;
    for (const b of this.beams) if (b.object.parent && b.object.visible) calls++;
    let em = 0;
    for (const e of this.emitters) if (e.active) em++;
    return { particles: smoke + add, smoke, additive: add, trails: this.trails.active, emitters: em, drawCalls: calls };
  }

  dispose() {
    this.group.removeFromParent();
    this.smokeLayer.dispose();
    this.addLayer.dispose();
    this.trails.dispose();
    this.tracers.dispose();
    this.vapor.dispose();
    for (const ab of this.afterburners.slice()) ab.dispose();
    for (const b of this.beams.slice()) b.dispose();
    if (this._warmObjects) {
      this._warmObjects.ab.dispose();
      this._warmObjects.beam.dispose();
    }
    disposeBeamGeometry();
    this.textures.dispose();
  }
}

export default FX;
