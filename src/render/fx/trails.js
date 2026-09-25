// Ribbon trails: every trail lives in ONE shared dynamic geometry (one draw
// call). A trail owns P consecutive "points" (2 vertices each) used as a ring:
//
//   ... committed points ... | c (last committed) | n (live head) | b (break)
//
// The live head moves with every push; a point is committed every
// life/(P-3) seconds. The break slot duplicates the head and is marked dead,
// so the segment that wraps from the newest to the oldest point collapses to
// zero area. The vertex shader expands each point toward the camera
// (cross(tangent, viewDir)), grows the width and fades alpha with age.
import {
  BufferAttribute, BufferGeometry, CustomBlending, DynamicDrawUsage, InterleavedBuffer, InterleavedBufferAttribute,
  Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, AddEquation, DoubleSide
} from 'three';
import { WORLD_FOG_PARS } from '../worldUniforms.js';
import { DirtyRanges, flushRanges } from './ring.js';

export const TRAIL_STRIDE = 16; // floats per vertex
const DEAD = -1e9;

/** CPU side of the trail ring buffers (pure: no WebGL, unit-testable). */
export class TrailBuffer {
  constructor(maxTrails = 48, points = 96) {
    if (points < 8) throw new Error('TrailBuffer: need at least 8 points per trail');
    this.maxTrails = maxTrails;
    this.P = points;
    const nv = maxTrails * points * 2;
    this.vertexCount = nv;
    this.data = new Float32Array(nv * TRAIL_STRIDE);
    for (let v = 0; v < nv; v++) this.data[v * TRAIL_STRIDE + 3] = DEAD;
    this.dirty = new DirtyRanges(32, 8);
    this.state = new Uint8Array(maxTrails); // 0 free, 1 emitting, 2 stopped/fading
    this.gen = new Uint32Array(maxTrails);
    this.cur = new Int32Array(maxTrails); // live head slot
    this.last = new Int32Array(maxTrails); // last committed slot
    this.count = new Int32Array(maxTrails); // committed points
    this.lastCommit = new Float64Array(maxTrails);
    this.lastPush = new Float64Array(maxTrails);
    this.startTime = new Float64Array(maxTrails);
    this.interval = new Float32Array(maxTrails);
    this.prm = new Float32Array(maxTrails * 8); // w0,w1,life,kind,r,g,b,opacity
    this.headPos = new Float32Array(maxTrails * 3);
    this.headVel = new Float32Array(maxTrails * 3);
    this.dist = new Float64Array(maxTrails); // distance at last committed point
    this.hi = -1; // highest active trail index (draw range)
  }

  /** Returns a free trail index or -1. Steals the oldest fading trail when full. */
  alloc() {
    for (let j = 0; j < this.maxTrails; j++) if (this.state[j] === 0) return j;
    let best = -1, bt = Infinity;
    for (let j = 0; j < this.maxTrails; j++) {
      if (this.state[j] === 2 && this.lastPush[j] < bt) {
        bt = this.lastPush[j];
        best = j;
      }
    }
    return best;
  }

  begin(j, time, w0, w1, life, kind, r, g, b, opacity) {
    this.state[j] = 1;
    this.gen[j]++;
    this.count[j] = 0;
    this.cur[j] = 0;
    this.last[j] = 0;
    this.lastCommit[j] = time;
    this.lastPush[j] = time;
    this.startTime[j] = time;
    this.dist[j] = 0;
    this.interval[j] = Math.max(1 / 120, life / (this.P - 3));
    const q = j * 8, pr = this.prm;
    pr[q] = w0; pr[q + 1] = w1; pr[q + 2] = life; pr[q + 3] = kind;
    pr[q + 4] = r; pr[q + 5] = g; pr[q + 6] = b; pr[q + 7] = opacity;
    this.headVel[j * 3] = this.headVel[j * 3 + 1] = this.headVel[j * 3 + 2] = 0;
    // clear the whole region
    const v0 = j * this.P * 2;
    const d = this.data;
    for (let v = v0, e = v0 + this.P * 2; v < e; v++) {
      const o = v * TRAIL_STRIDE;
      d[o + 3] = DEAD;
      d[o + 4] = d[o + 5] = d[o + 6] = 0;
      d[o + 8] = d[o + 9] = 0;
      d[o + 10] = life;
    }
    this.dirty.add(v0, this.P * 2);
    if (j > this.hi) this.hi = j;
    return this.gen[j];
  }

  _write(j, slot, x, y, z, birth, tx, ty, tz, dist) {
    const v = (j * this.P + slot) * 2;
    const d = this.data;
    const q = j * 8, pr = this.prm;
    for (let k = 0; k < 2; k++) {
      const o = (v + k) * TRAIL_STRIDE;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = birth;
      d[o + 4] = tx; d[o + 5] = ty; d[o + 6] = tz; d[o + 7] = dist;
      d[o + 8] = pr[q]; d[o + 9] = pr[q + 1]; d[o + 10] = pr[q + 2]; d[o + 11] = pr[q + 3];
      d[o + 12] = pr[q + 4]; d[o + 13] = pr[q + 5]; d[o + 14] = pr[q + 6]; d[o + 15] = pr[q + 7];
    }
    this.dirty.add(v, 2);
  }

  _get(j, slot, out) {
    const o = (j * this.P + slot) * 2 * TRAIL_STRIDE;
    out[0] = this.data[o];
    out[1] = this.data[o + 1];
    out[2] = this.data[o + 2];
    out[3] = this.data[o + 7];
    return out;
  }

  push(j, x, y, z, time) {
    if (this.state[j] !== 1) return;
    const P = this.P;
    const hp = this.headPos;
    const dtp = time - this.lastPush[j];
    if (this.count[j] > 0 && dtp > 1e-5) {
      const k = Math.min(1, dtp * 20);
      this.headVel[j * 3] += ((x - hp[j * 3]) / dtp - this.headVel[j * 3]) * k;
      this.headVel[j * 3 + 1] += ((y - hp[j * 3 + 1]) / dtp - this.headVel[j * 3 + 1]) * k;
      this.headVel[j * 3 + 2] += ((z - hp[j * 3 + 2]) / dtp - this.headVel[j * 3 + 2]) * k;
    }
    hp[j * 3] = x; hp[j * 3 + 1] = y; hp[j * 3 + 2] = z;
    this.lastPush[j] = time;
    if (this.count[j] === 0) {
      // first point: park every (dead) slot on it so no segment reaches stale
      // positions, then committed at slot 0, live head at 1, break at 2
      for (let k = 3; k < P; k++) this._write(j, k, x, y, z, DEAD, 0, 0, 0, 0);
      this._write(j, 0, x, y, z, time, 0, 0, 0, 0);
      this._write(j, 1, x, y, z, time, 0, 0, 0, 0);
      this._write(j, 2, x, y, z, DEAD, 0, 0, 0, 0);
      this.count[j] = 1;
      this.last[j] = 0;
      this.cur[j] = 1;
      this.lastCommit[j] = time;
      return;
    }
    const c = this.last[j];
    const n = this.cur[j];
    const cp = this._get(j, c, _a);
    const tx = x - cp[0], ty = y - cp[1], tz = z - cp[2];
    const dl = Math.hypot(tx, ty, tz);
    const dist = this.dist[j] + dl;
    // live head + break duplicate
    this._write(j, n, x, y, z, time, tx, ty, tz, dist);
    const b = n + 1 === P ? 0 : n + 1;
    this._write(j, b, x, y, z, DEAD, tx, ty, tz, dist);
    if (time - this.lastCommit[j] >= this.interval[j] && dl > 0.05) {
      // commit head: refresh tangent of the previous committed point (central difference)
      {
        const pc = this.count[j] > 1 ? (c === 0 ? P - 1 : c - 1) : c;
        const pp = this._get(j, pc, _b);
        const cc = this._get(j, c, _c);
        const o = (j * P + c) * 2 * TRAIL_STRIDE;
        this._write(j, c, cc[0], cc[1], cc[2], this.data[o + 3], x - pp[0], y - pp[1], z - pp[2], cc[3]);
      }
      this.last[j] = n;
      this.cur[j] = b;
      this.dist[j] = dist;
      this.count[j]++;
      this.lastCommit[j] = time;
      // new live head starts on top of the committed point (zero-length segment), break after it
      this._write(j, b, x, y, z, time, tx, ty, tz, dist);
      const b2 = b + 1 === P ? 0 : b + 1;
      this._write(j, b2, x, y, z, DEAD, tx, ty, tz, dist);
    }
  }

  /** Immediately frees a trail and hides its points. */
  kill(j) {
    if (this.state[j] === 0) return;
    this.state[j] = 0;
    this.gen[j]++;
    const v0 = j * this.P * 2;
    for (let v = v0, e = v0 + this.P * 2; v < e; v++) this.data[v * TRAIL_STRIDE + 3] = DEAD;
    this.dirty.add(v0, this.P * 2);
  }

  stop(j, time) {
    if (this.state[j] === 1) {
      this.state[j] = 2;
      this.lastPush[j] = Math.max(this.lastPush[j], time - 1e-3);
    }
  }

  /** Recycles faded trails. Returns number of active (emitting + fading) trails. */
  update(time) {
    let n = 0, hi = -1;
    for (let j = 0; j < this.maxTrails; j++) {
      const s = this.state[j];
      if (s === 0) continue;
      if (s === 2 && time - this.lastPush[j] > this.prm[j * 8 + 2] + 0.1) {
        this.state[j] = 0;
        continue;
      }
      n++;
      hi = j;
    }
    this.hi = hi;
    return n;
  }
}
const _a = [0, 0, 0, 0], _b = [0, 0, 0, 0], _c = [0, 0, 0, 0];

const TRAIL_VS = /* glsl */ `
attribute float side;
attribute float tBirth;
attribute vec4 tTan;  // tangent xyz, distance along trail
attribute vec4 tPrm;  // width0, width1, life, kind
attribute vec4 tCol;  // albedo rgb, opacity
uniform float uFxTime;
uniform vec2 uViewport;
${WORLD_FOG_PARS}
varying vec4 vT;  // side, dist, age01, kind
varying vec4 vC;  // albedo, alpha
varying vec4 vL;  // sun.side, sun.view, forward phase, age seconds
varying vec4 vFog;
varying float vW;

void main() {
  float age = uFxTime - tBirth;
  float life = max(tPrm.z, 1e-3);
  float a = age / life;
  float alive = (age > -0.05 && a < 1.0) ? 1.0 : 0.0;
  age = max(age, 0.0);
  a = clamp(a, 0.0, 1.0);
  int kind = int(tPrm.w + 0.5);
  float w = mix(tPrm.x, tPrm.y, sqrt(a));
  vec3 p = position;
  if (kind != 1) p.y += min(age, life) * 0.45 * alive; // warm smoke drifts up (never for dead/cleared points)
  vec3 toCam = cameraPosition - p;
  toCam /= max(length(toCam), 1e-3);
  vec3 tn = tTan.xyz;
  float tl = length(tn);
  tn = tl > 1e-6 ? tn / tl : vec3(0.0, 1.0, 0.0);
  vec3 sd = cross(tn, toCam);
  float sl = length(sd);
  if (sl < 0.03) {
    sd = cross(vec3(0.0, 1.0, 0.0), toCam);
    float l2 = length(sd);
    sd = l2 > 1e-3 ? sd / l2 : vec3(1.0, 0.0, 0.0);
  } else sd /= sl;
  float depth = max(-(viewMatrix * vec4(p, 1.0)).z, 0.1);
  float pxPerM = projectionMatrix[1][1] * 0.5 * uViewport.y / depth;
  float amul = 1.0;
  float wpx = w * pxPerM;
  if (wpx < 1.5) { amul = wpx / 1.5; w = 1.5 / pxPerM; }
  // fade ribbons the camera flies through (thick missile smoke must not white/black out the view)
  amul *= smoothstep(0.9, 3.2, depth / max(w, 0.1));
  // looking down the trail axis: the flat ribbon under-represents the tube
  // (may push the opacity above 1: the fragment shader clamps the final alpha)
  amul *= 1.0 + (1.0 - clamp(sl * 2.5, 0.0, 1.0)) * 0.6;
  vW = max(w, 0.05);
  w *= alive;
  vec3 wp = p + sd * (side * 0.5 * w);
  vT = vec4(side, tTan.w, a, tPrm.w);
  vC = vec4(tCol.rgb, tCol.a * amul * alive);
  vL = vec4(dot(uSunDir, sd), dot(uSunDir, toCam), pow(max(dot(-toCam, uSunDir), 0.0), 5.0), age);
  vec3 rd;
  float fa = worldFogAmount(cameraPosition, p, rd);
  vFog = vec4(worldFogColor(rd), fa);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const TRAIL_FS = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uFxSun;
uniform float uFxAmbient;
uniform vec3 uFxSkyTint;
varying vec4 vT;
varying vec4 vC;
varying vec4 vL;
varying vec4 vFog;

varying float vW;

void main() {
  float s = clamp(vT.x, -1.0, 1.0);
  float ac = max(1.0 - s * s, 0.0);
  int kind = int(vT.w + 0.5);
  float a = clamp(vT.z, 0.0, 1.0);
  float ageSec = max(vL.w, 0.0);
  // billows scale with the local width and stay anchored to the air (distance along the trail)
  vec2 nuv = vec2(vT.y / (vW * 2.2 + 0.5), s * 0.32);
  float n1 = texture2D(uNoise, nuv + vec2(0.0, ageSec * 0.03)).r;
  float n2 = texture2D(uNoise, nuv * 2.3 + vec2(0.37, -ageSec * 0.06)).g;
  float n = n1 * 0.7 + n2 * 0.45;
  float th = mix(0.12, 0.62, a);
  float body = smoothstep(th, th + 0.22, ac * (0.2 + 1.05 * n));
  float fout = 1.0 - smoothstep(0.45, 1.0, a);
  float alpha = body * vC.a * fout * (0.7 + 0.45 * n1);
  float ndl = s * vL.x + sqrt(ac) * vL.y;
  float diff = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
  diff *= diff;
  vec3 sun = uSunColor * uFxSun;
  vec3 amb = uFogColor * uFxSkyTint * uFxAmbient;
  // self-shadowing hint from the noise + forward scattering through bright smoke (backlit glow)
  vec3 lit = vC.rgb * (sun * diff + amb) * (0.6 + 0.7 * n1 * n1 + 0.2 * n2);
  lit += sun * vL.z * vC.rgb * (0.45 + 0.9 * (1.0 - body));
  vec3 emis = vec3(0.0);
  if (kind == 0) {
    // missile: rocket plume right behind the head, then smoke
    float h = exp(-ageSec / 0.06);
    emis = vec3(10.0, 4.2, 1.2) * h * ac * ac * vC.a;
    alpha *= smoothstep(0.015, 0.14, ageSec);
  } else if (kind == 4) {
    float h = exp(-ageSec / 0.16);
    emis = vec3(2.2, 0.5, 0.05) * h * body * vC.a;
    lit *= 1.0 - h * 0.7;
  } else if (kind == 1) {
    alpha = vC.a * pow(ac, 1.5) * fout * (0.65 + 0.35 * n);
    lit = vC.rgb * (sun * 0.55 + amb * 1.1);
  }
  // premultiplied over a HalfFloat target: alpha > 1 turns the (1 - alpha) destination
  // factor negative (black streaks against a bright sky), so clamp it
  alpha = clamp(alpha, 0.0, 1.0);
  vec3 c = mix(lit, vFog.rgb, vFog.w) * alpha + emis * (1.0 - vFog.w);
  gl_FragColor = vec4(clamp(c, 0.0, 6.0e4), alpha);
}`;

/** GPU side: one mesh drawing every trail. */
export class TrailSystem {
  constructor({ maxTrails, points, uniforms }) {
    this.buf = new TrailBuffer(maxTrails, points);
    const b = this.buf;
    const g = new BufferGeometry();
    const ib = new InterleavedBuffer(b.data, TRAIL_STRIDE);
    ib.setUsage(DynamicDrawUsage);
    this.ib = ib;
    g.setAttribute('position', new InterleavedBufferAttribute(ib, 3, 0));
    g.setAttribute('tBirth', new InterleavedBufferAttribute(ib, 1, 3));
    g.setAttribute('tTan', new InterleavedBufferAttribute(ib, 4, 4));
    g.setAttribute('tPrm', new InterleavedBufferAttribute(ib, 4, 8));
    g.setAttribute('tCol', new InterleavedBufferAttribute(ib, 4, 12));
    const side = new Float32Array(b.vertexCount);
    for (let v = 0; v < b.vertexCount; v++) side[v] = v & 1 ? 1 : -1;
    g.setAttribute('side', new BufferAttribute(side, 1));
    const P = points;
    const idx = new (b.vertexCount > 65535 ? Uint32Array : Uint16Array)(maxTrails * P * 6);
    let k = 0;
    for (let j = 0; j < maxTrails; j++) {
      for (let i = 0; i < P; i++) {
        const a = (j * P + i) * 2;
        const c = (j * P + ((i + 1) % P)) * 2;
        idx[k++] = a; idx[k++] = a + 1; idx[k++] = c;
        idx[k++] = a + 1; idx[k++] = c + 1; idx[k++] = c;
      }
    }
    g.setIndex(new BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new ShaderMaterial({
      name: 'fxTrails',
      vertexShader: TRAIL_VS,
      fragmentShader: TRAIL_FS,
      uniforms,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'fxTrails';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.matrixAutoUpdate = false;
    this._rangePool = [];
    this.active = 0;
  }

  update(time) {
    this.active = this.buf.update(time);
    this.geometry.setDrawRange(0, (this.buf.hi + 1) * this.buf.P * 6);
    this.mesh.visible = this.buf.hi >= 0;
    return flushRanges(this.buf.dirty, this.ib, TRAIL_STRIDE, this._rangePool);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
