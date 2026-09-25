// Stateless GPU particles. Each particle is written ONCE when spawned (24
// floats in a ring buffer); the vertex shader evaluates motion, size, colour
// and expiry analytically from world time, so the CPU never touches live
// particles. Two layers = two draw calls:
//   smoke layer   premultiplied alpha (lit smoke, dust, spray, debris, and the
//                 fireball puffs: emissive + occluding so billows hide each other)
//   add layer     additive HDR (fire, flashes, sparks, flares, rings)
import {
  CustomBlending, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, BufferAttribute,
  DynamicDrawUsage, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, ZeroFactor, AddEquation
} from 'three';
import { WORLD_FOG_PARS } from '../worldUniforms.js';
import { RingAllocator, DirtyRanges, flushRanges } from './ring.js';
import { FX_MOTION_GLSL } from './ballistic.js';
import { FX_DEFINES } from './config.js';
import { FX_FIRE_GLSL } from './glsl.js';

export const PARTICLE_STRIDE = 24;

const PARTICLE_VS = /* glsl */ `
attribute vec2 corner;
attribute vec4 a0; // pos0.xyz, t0
attribute vec4 a1; // vel0.xyz, life
attribute vec4 a2; // size0, size1, rot0, spin
attribute vec4 a3; // drag, accY, seed, kind
attribute vec4 a4; // rgb, intensity | opacity
attribute vec4 a5; // kind params (p0, p1 stretch, p2 size-curve exp, p3 fade-in)

uniform float uFxTime;
uniform vec2 uViewport;
uniform float uMinPx;
uniform float uMaxPx;
${WORLD_FOG_PARS}
${FX_MOTION_GLSL}

varying vec2 vUv;
varying vec2 vUvA;
varying vec2 vUvB;
varying vec4 vCol;
varying vec4 vPrm;
varying vec4 vInfo;  // age01, ageSec, kind, seed
varying vec4 vLight; // sun in sprite frame, forward-scatter phase
varying vec4 vFog;   // fog colour, amount

const float PAD = 0.012;

vec2 atlasUv(vec2 cell, vec2 uv01) {
  return (cell + mix(vec2(PAD), vec2(1.0 - PAD), uv01)) * 0.25;
}

void main() {
  float t = uFxTime - a0.w;
  float life = a1.w;
  if (t < 0.0 || t >= life) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  float age = t / life;
  int k = int(a3.w + 0.5);
  vec3 p = fxMotion(a0.xyz, a1.xyz, a3.x, a3.y, t);
  float sexp = a5.z > 0.0 ? a5.z : 1.0;
  float size = mix(a2.x, a2.y, 1.0 - pow(1.0 - age, sexp));

  vec4 vp = viewMatrix * vec4(p, 1.0);
  float depth = -vp.z;
  if (depth < 0.05) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
  vec3 toCam = normalize(cameraPosition - p);
  float pxPerM = projectionMatrix[1][1] * 0.5 * uViewport.y / depth;
  float energy = 1.0;
  // fade particles the camera flies into (and never let them fill the screen).
  // Smoke starts fading while it is still well short of the screen-size cap, so
  // flying through a fresh kill never blacks the view out.
  float nr = depth / max(size, 1e-3);
#ifdef FX_ADDITIVE
  float nearFade = smoothstep(0.35, 1.4, nr);
#else
  float nearFade = smoothstep(0.9, 2.8, nr);
#endif
  float rpx = size * pxPerM;
#ifdef FX_ADDITIVE
  if (rpx < uMinPx) {
    // conserve energy: streaks only widen (linear), sprites grow in 2D (squared)
    float f = rpx / uMinPx;
    energy = (k == K_SPARK || k == K_MUZZLE) ? f : f * f;
    size = uMinPx / pxPerM;
  }
#else
  if (rpx < 1.0) { energy = rpx; size = 1.0 / pxPerM; }
#endif
  if (rpx > uMaxPx) size = uMaxPx / pxPerM;
  energy *= nearFade;
  if (energy < 0.002) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }

  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec2 uv01 = corner * 0.5 + 0.5;
  vec3 wp;
  vLight = vec4(0.0, 0.0, 1.0, 0.0);

  bool streak = false;
  vec3 axis = up;
  float len = 0.0;
#ifdef FX_ADDITIVE
  if (k == K_SPARK) {
    vec3 v = fxVelocity(a1.xyz, a3.x, a3.y, t);
    float sp = length(v);
    axis = sp > 1e-3 ? v / sp : up;
    len = sp * a5.y;
    streak = true;
  } else if (k == K_MUZZLE) {
    axis = normalize(a4.xyz + vec3(0.0, 1e-5, 0.0));
    len = a5.y;
    streak = true;
  }
#else
  if (k == S_SPRAY && a5.y > 0.0) {
    vec3 v = fxVelocity(a1.xyz, a3.x, a3.y, t);
    float sp = length(v);
    axis = sp > 1e-3 ? v / sp : up;
    len = min(sp * a5.y, size * 1.5);
    streak = len > size * 0.05;
  }
#endif
  if (streak) {
    vec3 side = cross(axis, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : right;
    float along = uv01.y;
#ifdef FX_ADDITIVE
    if (k == K_MUZZLE) wp = p + side * (corner.x * size) + axis * (along * len);
    else wp = p + side * (corner.x * size) + axis * mix(-len, size, along);
#else
    // stretched puff: centre stays, extends both ways along motion
    wp = p + side * (corner.x * size) + axis * (corner.y * (size + len));
    vLight.xyz = vec3(dot(uSunDir, side), dot(uSunDir, axis), dot(uSunDir, toCam));
#endif
  } else {
    float ang = a2.z + a2.w * t;
    float c = cos(ang), s = sin(ang);
    vec3 ax = right * c + up * s;
    vec3 ay = up * c - right * s;
    wp = p + (ax * corner.x + ay * corner.y) * size;
    vLight.xyz = vec3(dot(uSunDir, ax), dot(uSunDir, ay), dot(uSunDir, back));
  }
  vLight.w = pow(max(dot(-toCam, uSunDir), 0.0), 5.0);

  // atlas cells
  float seed = a3.z;
  vUvA = vec2(0.0);
  vUvB = vec2(0.0);
#ifdef FX_ADDITIVE
  if (k == K_FIRE) {
#else
  if (k == S_FIRE) {
#endif
    float v = floor(seed * 4.0);
#ifdef FX_ADDITIVE
    vUvA = atlasUv(vec2(v, 2.0), uv01);
#else
    float vs = floor(fract(seed * 7.13) * 8.0);
    vUvA = atlasUv(vec2(mod(vs, 4.0), floor(vs * 0.25)), uv01);
#endif
    // second, counter-rotating variant for evolving turbulence
    float ang2 = -2.0 * (a2.z + a2.w * t) + seed * 6.28 + t * 0.9;
    float c2 = cos(ang2), s2 = sin(ang2);
    vec2 q = mat2(c2, s2, -s2, c2) * corner * 0.92;
    vUvB = atlasUv(vec2(mod(v + 2.0, 4.0), 2.0), q * 0.5 + 0.5);
  }
#ifndef FX_ADDITIVE
  else if (k == S_SMOKE) {
    float v = floor(seed * 8.0);
    vUvA = atlasUv(vec2(mod(v, 4.0), floor(v * 0.25)), uv01);
  } else if (k == S_DEBRIS) {
    float v = floor(seed * 4.0);
    vUvA = (vec2(0.0, 3.0) + (vec2(mod(v, 2.0), floor(v * 0.5)) + mix(vec2(0.02), vec2(0.98), uv01)) * 0.5) * 0.25;
  } else if (k == S_SPRAY) {
    vUvA = atlasUv(vec2(1.0, 3.0), uv01);
  } else {
    vUvA = atlasUv(vec2(2.0 + step(0.5, seed), 3.0), uv01);
  }
#endif

  vUv = corner;
  vCol = vec4(a4.rgb, a4.w * energy);
  vPrm = a5;
  vInfo = vec4(age, t, a3.w, seed);
  vec3 rd;
  float fa = worldFogAmount(cameraPosition, p, rd);
  vFog = vec4(worldFogColor(rd), fa);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const ADD_FS = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec2 vUvA;
varying vec2 vUvB;
varying vec4 vCol;
varying vec4 vPrm;
varying vec4 vInfo;
varying vec4 vLight;
varying vec4 vFog;
${FX_FIRE_GLSL}

void main() {
  int k = int(vInfo.z + 0.5);
  // varyings can extrapolate slightly outside [0,1] under MSAA: keep pow() bases >= 0
  float age = clamp(vInfo.x, 0.0, 1.0);
  float tsec = max(vInfo.y, 0.0);
  float seed = vInfo.w;
  float r2 = dot(vUv, vUv);
  vec3 col = vec3(0.0);
  if (k == K_FIRE) {
    vec4 s1 = texture2D(uAtlas, vUvA);
    vec4 s2 = texture2D(uAtlas, vUvB);
    float dens = clamp(s1.r * 0.75 + s2.r * 0.45 - 0.1, 0.0, 1.0);
    float detail = s1.g * 0.6 + s2.g * 0.4;
    float ero = s1.a * 0.55 + s2.a * 0.45;
    float th = age * age * 0.85 * vPrm.y;
    float m = smoothstep(th, th + 0.3, dens * (0.55 + 0.9 * ero));
    float heat = (1.0 - pow(age, 0.55)) * (0.5 + 0.75 * detail) * vPrm.x + dens * 0.3 - 0.12;
    col = fxFireRamp(clamp(heat, 0.0, 1.0)) * m * dens * smoothstep(0.0, 0.04, age);
  } else if (k == K_FLASH || k == K_GLOW) {
    float fall = (exp(-r2 * 4.5) * 0.7 + 0.3 / (1.0 + r2 * 22.0)) * (1.0 - smoothstep(0.5, 1.0, r2));
    float env = k == K_FLASH ? (1.0 - age) * (1.0 - age) : pow(1.0 - age, vPrm.x > 0.0 ? vPrm.x : 1.5) * (vPrm.w > 0.0 ? 1.0 : smoothstep(0.0, 0.08, age));
    col = vCol.rgb * fall * env;
  } else if (k == K_SPARK) {
    float across = exp(-vUv.x * vUv.x * 5.0);
    float along = vUv.y * 0.5 + 0.5;
    float head = smoothstep(0.0, 0.85, along);
    float env = (1.0 - age) * (1.0 - age * 0.5);
    vec3 c = mix(vec3(1.0, 0.22, 0.04), vCol.rgb, 1.0 - age * 0.8);
    col = c * across * head * env;
  } else if (k == K_FLARE) {
    float fl = 0.72 + 0.28 * sin(tsec * 57.0 + seed * 40.0) * sin(tsec * 23.0 + seed * 13.0);
    float core = exp(-r2 * 22.0);
    float halo = exp(-r2 * 5.0) * 0.3 + 0.05 / (1.0 + r2 * 50.0);
    float spikes = exp(-abs(vUv.x) * 30.0) * exp(-abs(vUv.y) * 3.0) + exp(-abs(vUv.y) * 30.0) * exp(-abs(vUv.x) * 3.0);
    float env = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.82, 1.0, age));
    col = (vec3(1.0, 0.97, 0.92) * core * 90.0 + vCol.rgb * (halo * 12.0 + spikes * 5.0)) * fl * env * (1.0 - smoothstep(0.55, 1.0, r2));
  } else if (k == K_RING) {
    float r = sqrt(r2);
    float w = 0.09 + 0.16 * age;
    float q = (r - 0.8) / w; // signed: square it (pow() of a negative base is NaN)
    float ang = r > 1e-4 ? atan(vUv.y, vUv.x) : 0.0;
    float ringv = exp(-q * q) * (0.8 + 0.2 * sin(ang * 7.0 + seed * 20.0)) + 0.08 * (1.0 - smoothstep(0.2, 0.85, r));
    float env = (1.0 - age) * (1.0 - age);
    col = vCol.rgb * ringv * env * (1.0 - smoothstep(0.92, 1.0, r));
  } else if (k == K_EMBER) {
    float fl = 0.6 + 0.4 * sin(tsec * 31.0 + seed * 50.0);
    float g = exp(-r2 * 9.0) + 0.1 / (1.0 + r2 * 30.0);
    col = mix(vec3(1.0, 0.18, 0.03), vCol.rgb, 1.0 - age) * g * fl * (1.0 - age) * (1.0 - smoothstep(0.6, 1.0, r2));
  } else if (k == K_MUZZLE) {
    float along = vUv.y * 0.5 + 0.5;
    float w = (1.0 - along) * 0.85 + 0.15;
    float petal = pow(max(0.0, 1.0 - abs(vUv.x) / w), 2.0);
    float core = exp(-vUv.x * vUv.x * 18.0) * exp(-along * 3.0);
    float lobes = 0.7 + 0.3 * sin(along * 18.0 + seed * 30.0);
    float env = 1.0 - age;
    col = (vec3(1.0, 0.42, 0.1) * petal * lobes * 2.6 + vec3(1.0, 0.75, 0.4) * core * 7.0) * env * (1.0 - smoothstep(0.7, 1.0, along));
  }
  col *= vCol.w * (1.0 - vFog.w);
  // additive HDR: never subtract light, never emit NaN/Inf into the bloom chain
  gl_FragColor = vec4(clamp(col, 0.0, 6.0e4), 0.0);
}`;

const SMOKE_FS = /* glsl */ `
uniform sampler2D uAtlas;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFxSun;
uniform float uFxAmbient;
uniform vec3 uFxSkyTint;
varying vec2 vUv;
varying vec2 vUvA;
varying vec2 vUvB;
varying vec4 vCol;
varying vec4 vPrm;
varying vec4 vInfo;
varying vec4 vLight;
varying vec4 vFog;
${FX_FIRE_GLSL}

void main() {
  int k = int(vInfo.z + 0.5);
  float age = clamp(vInfo.x, 0.0, 1.0);
  float tsec = max(vInfo.y, 0.0);
  vec4 s = texture2D(uAtlas, vUvA);
  float dens = s.r;
  vec3 n = vec3(s.g * 2.0 - 1.0, s.b * 2.0 - 1.0, 0.0);
  n.z = sqrt(max(0.05, 1.0 - dot(n.xy, n.xy)));
  vec3 L = vLight.xyz;
  vec3 sun = uSunColor * uFxSun;
  vec3 amb = uFogColor * uFxSkyTint * uFxAmbient;
  vec3 albedo = vCol.rgb;
  float alpha;
  vec3 lit;
  vec3 emis = vec3(0.0);
  if (k == S_FIRE) {
    // billowy fireball: hot billow centres, darker sooty crevices, turbulent detail
    vec4 f = texture2D(uAtlas, vUvB);
    float dens = s.r;
    float turb = f.g * 0.65 + f.r * 0.35;
    float th = age * age * 0.75 * vPrm.y;
    float m = smoothstep(th, th + 0.22, dens * (0.45 + 0.8 * s.a) + turb * 0.25);
    float h0 = pow(1.0 - age, 1.6) * vPrm.x; // stays hot for most of its life (arcade fireball)
    float billow = n.z * n.z;
    float heat = clamp(h0 * (0.02 + 0.9 * billow + 0.8 * turb) + dens * 0.12 - 0.13, 0.0, 1.0);
    alpha = clamp(dens * 2.4 - 0.1, 0.0, 1.0) * m * vCol.w * smoothstep(0.0, 0.03, age) * (1.0 - smoothstep(0.6, 1.0, age));
    float diff = clamp(dot(n, L) * 0.55 + 0.45, 0.0, 1.0);
    lit = vec3(0.05, 0.045, 0.04) * (sun * diff * diff + amb);
    emis = fxFireRamp(heat);
  } else if (k == S_DEBRIS) {
    alpha = dens * vCol.w * (1.0 - smoothstep(0.85, 1.0, age));
    float ndl = max(dot(n, L), 0.0);
    float glint = pow(max(n.z * L.z + ndl * 0.3, 0.0), 24.0) * step(0.55, s.a) * 3.0;
    lit = albedo * (sun * (ndl * 0.8 + 0.1) + amb * 0.6) + sun * glint;
    float heat = vPrm.x * exp(-tsec * 1.6);
    emis = vec3(3.0, 0.7, 0.12) * heat * dens;
  } else {
    float th = smoothstep(0.2, 1.0, age) * 0.7;
    float m = smoothstep(th, th + 0.32, dens * (0.5 + 0.95 * s.a));
    float fin = smoothstep(0.0, max(vPrm.w, 0.001), age);
    float fout = 1.0 - smoothstep(0.6, 1.0, age);
    alpha = m * clamp(dens * 2.2 - 0.12, 0.0, 1.0) * (0.72 + 0.28 * s.a) * vCol.w * fin * fout;
    float ndl = dot(n, L);
    float diff = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
    diff *= diff;
    float thin = 1.0 - dens;
    lit = albedo * (sun * diff + amb) + sun * vLight.w * thin * thin * thin * (0.08 + albedo) * 0.7; // silver lining (dark soot scatters little)
    if (k == S_SPRAY || k == S_MIST) {
      // bright water: wrap lighting + a bit of sky
      lit = albedo * (sun * (0.45 + 0.55 * clamp(ndl * 0.5 + 0.5, 0.0, 1.0)) + amb * 1.3) + sun * (0.25 + vLight.w * 2.5) * (0.3 + thin) * albedo;
    }
    if (vPrm.x > 0.0) {
      // smoke lit from inside by the dying fireball (deep orange, fades fast)
      float g = vPrm.x * exp(-tsec * 3.4);
      emis = vec3(1.3, 0.28, 0.04) * g * dens * dens * m;
    }
  }
  // premultiplied: alpha > 1 would make the (1 - alpha) destination factor negative
  // (dark streaks on the HalfFloat target), so clamp it and keep colour finite
  alpha = clamp(alpha, 0.0, 1.0);
  vec3 c = mix(lit, vFog.rgb, vFog.w) * alpha + emis * (1.0 - vFog.w) * alpha;
  gl_FragColor = vec4(clamp(c, 0.0, 6.0e4), alpha);
}`;

function defineMap() {
  const d = {};
  for (const [k, v] of Object.entries(FX_DEFINES)) d[k] = String(v);
  return d;
}

/**
 * One particle layer (one draw call). CPU side is a ring buffer of
 * `capacity` particles; spawning writes one slot and marks it dirty.
 */
export class ParticleLayer {
  constructor({ capacity, additive, uniforms, name = 'fxParticles' }) {
    this.capacity = capacity;
    this.additive = !!additive;
    const S = PARTICLE_STRIDE;
    this.data = new Float32Array(capacity * S);
    this.expiry = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.data[i * S + 3] = -1e9; // t0: long dead
      this.data[i * S + 7] = 0; // life
      this.expiry[i] = -1e9;
    }
    this.ring = new RingAllocator(capacity);
    this.dirty = new DirtyRanges(8, 0);
    this._rangePool = [];
    this._frameStart = 0;
    this._frameCount = 0;

    const g = new InstancedBufferGeometry();
    g.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    // three needs a position attribute for draw-range bookkeeping
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const ib = new InstancedInterleavedBuffer(this.data, S, 1);
    ib.setUsage(DynamicDrawUsage);
    this.ib = ib;
    for (let a = 0; a < 6; a++) g.setAttribute('a' + a, new InterleavedBufferAttribute(ib, 4, a * 4));
    g.instanceCount = 0;
    this.geometry = g;

    const defines = defineMap();
    defines[this.additive ? 'FX_ADDITIVE' : 'FX_SMOKE'] = '';
    this.material = new ShaderMaterial({
      name,
      vertexShader: PARTICLE_VS,
      fragmentShader: this.additive ? ADD_FS : SMOKE_FS,
      uniforms,
      defines,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      toneMapped: false,
      fog: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: this.additive ? OneFactor : OneMinusSrcAlphaFactor,
      blendSrcAlpha: this.additive ? ZeroFactor : OneFactor,
      blendDstAlpha: this.additive ? OneFactor : OneMinusSrcAlphaFactor
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = this.additive ? 20 : 10;
    this.mesh.matrixAutoUpdate = false;
  }

  /** Writes particle template P into the next ring slot. */
  push(P) {
    const i = this.ring.alloc();
    const d = this.data;
    const o = i * PARTICLE_STRIDE;
    d[o] = P.x; d[o + 1] = P.y; d[o + 2] = P.z; d[o + 3] = P.t0;
    d[o + 4] = P.vx; d[o + 5] = P.vy; d[o + 6] = P.vz; d[o + 7] = P.life;
    d[o + 8] = P.s0; d[o + 9] = P.s1; d[o + 10] = P.rot; d[o + 11] = P.spin;
    d[o + 12] = P.drag; d[o + 13] = P.ay; d[o + 14] = P.seed; d[o + 15] = P.kind;
    d[o + 16] = P.r; d[o + 17] = P.g; d[o + 18] = P.b; d[o + 19] = P.i;
    d[o + 20] = P.p0; d[o + 21] = P.p1; d[o + 22] = P.p2; d[o + 23] = P.p3;
    this.expiry[i] = P.t0 + P.life;
    this.dirty.add(i, 1);
    this._frameCount++;
    return i;
  }

  /**
   * Shift spawn times of everything emitted since the last frame by `dt`
   * (effects triggered during sim steps start at the rendered frame's time,
   * so a 0.1 s flash is never half-consumed before it is first drawn).
   */
  shiftPending(dt) {
    if (dt === 0 || this._frameCount === 0) return;
    const n = Math.min(this._frameCount, this.capacity);
    const d = this.data;
    let i = this._frameStart;
    for (let j = 0; j < n; j++) {
      d[i * PARTICLE_STRIDE + 3] += dt;
      this.expiry[i] += dt;
      i = i + 1 === this.capacity ? 0 : i + 1;
    }
  }

  /** Uploads dirty slots; call once per frame. Returns ranges uploaded. */
  flush() {
    const n = flushRanges(this.dirty, this.ib, PARTICLE_STRIDE, this._rangePool);
    this.geometry.instanceCount = this.ring.used;
    this._frameStart = this.ring.head;
    this._frameCount = 0;
    return n;
  }

  /** Mark pending spawns as belonging to the current frame (no shift). */
  beginFrame() {
    this._frameStart = this.ring.head;
    this._frameCount = 0;
  }

  /** Kills every particle (one full upload). Used when world time is reset. */
  killAll() {
    const S = PARTICLE_STRIDE, d = this.data;
    for (let i = 0; i < this.capacity; i++) {
      d[i * S + 3] = -1e9;
      d[i * S + 7] = 0;
      this.expiry[i] = -1e9;
    }
    this.dirty.clear();
    this.dirty.add(0, this.capacity);
    this.ring.reset();
    this._frameStart = 0;
    this._frameCount = 0;
  }

  alive(time) {
    let n = 0;
    const e = this.expiry;
    for (let i = 0, l = this.ring.used; i < l; i++) if (e[i] > time) n++;
    return n;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
