// Afterburner / engine exhaust: a raymarched emissive volume per nozzle.
// Each nozzle gets a closed cylinder proxy (front faces rasterised) (all nozzles of one jet merged into
// one mesh = one draw call). The fragment shader intersects the view ray with
// the analytic cylinder in nozzle space and integrates emission:
//   idle     faint heat glow at the exit plane
//   dry      short translucent blue core (throttle)
//   AB       hot white-yellow inner cone, orange plume, blue sheath at the
//            exit and a train of Mach diamonds (shock knots + conical shells)
// Works from any angle, including end-on from the chase camera.
import {
  AddEquation, BufferAttribute, BufferGeometry, Color, CustomBlending, FrontSide, Group, Matrix4, Mesh, OneFactor,
  ShaderMaterial, Vector3, ZeroFactor
} from 'three';
import { WORLD_FOG_PARS } from '../worldUniforms.js';
import { FX_FIRE_GLSL, FX_NOISE_GLSL } from './glsl.js';

const PROXY_R = 1.8; // proxy radius in nozzle radii
const Z_MIN = -0.45; // proxy start (radii, behind exit plane)
const L_MAX = 16.0; // proxy length (radii)
const SEG = 12;

const VS = /* glsl */ `
attribute vec4 aNoz;  // origin (object space), radius
attribute vec4 aAxis; // exhaust direction, seed
varying vec3 vPos;
varying vec4 vNoz;
varying vec4 vAxis;
varying float vFogT;
${WORLD_FOG_PARS}
void main() {
  vPos = position;
  vNoz = aNoz;
  vAxis = aAxis;
  vec3 wo = (modelMatrix * vec4(aNoz.xyz, 1.0)).xyz;
  vec3 rd;
  vFogT = 1.0 - worldFogAmount(cameraPosition, wo, rd);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FS = /* glsl */ `
uniform vec3 uLocalCam;
uniform float uFxTime;
uniform float uThrottle;
uniform float uAB;
uniform float uLenDry;
uniform float uLenAB;
uniform float uFlick;
uniform vec3 uTint;
uniform sampler2D uNoise;
varying vec3 vPos;
varying vec4 vNoz;
varying vec4 vAxis;
varying float vFogT;
${FX_NOISE_GLSL}
${FX_FIRE_GLSL}

// Gaussian-ish falloff of a SIGNED distance: square it instead of pow(x, 2.0),
// which is NaN for x < 0 on most GPUs (NaN pixels blow up into black blocks in bloom).
float g2(float x) { return exp(-x * x); }

// returns (fire energy, blue energy) per unit length (nozzle radii)
vec2 abEmit(float z, float r, float ang, float seed) {
  float T = uThrottle, AB = uAB;
  float ef = 0.0, eb = 0.0;
  // exit-plane heat glow (visible at idle)
  float disc = exp(-z * z * 26.0) * (1.0 - smoothstep(0.55, 1.05, r));
  ef += disc * (0.5 + 0.8 * T + 1.4 * AB);
  if (z < 0.0) return vec2(ef, eb);
  float fl = uFxTime * (6.0 + 10.0 * AB);
  float n1 = texture2D(uNoise, vec2(z * 0.06 - fl * 0.09 + seed, ang * 0.159155 + 0.5)).r;
  float n2 = texture2D(uNoise, vec2(z * 0.17 - fl * 0.21 + seed * 1.7, ang * 0.31831 + r * 0.12)).g;
  float turb = n1 * 0.62 + n2 * 0.55 - 0.585;
  // dry thrust: short translucent blue core
  float Ld = max(uLenDry, 0.2);
  float dryR = 0.72 - 0.3 * clamp(z / Ld, 0.0, 1.0);
  float dry = g2(r / dryR) * exp(-z / (Ld * 0.45)) * (1.0 + turb * 0.8) * T * (1.0 - 0.85 * AB);
  eb += dry * 0.8;
  ef += dry * 0.1;
  if (AB > 0.002) {
    float L = max(uLenAB, 0.5);
    float zt = z / L;
    float fade = 1.0 - smoothstep(0.35, 1.0, zt + turb * 0.3);
    // far down the proxy zt grows large and negative turbulence could flip env's sign
    float env = max(0.8 + 0.04 * z + turb * 0.12 * zt, 0.05);
    float body = exp(-pow(r / env, 2.2)) * fade * (0.35 + 1.3 * (turb + 0.5));
    // inner hot cone
    float coneLen = 0.34 * L;
    float coneR = 0.62 * (1.0 - z / coneLen);
    float rc = r / max(coneR, 0.02);
    float cone = coneR > 0.02 ? exp(-rc * rc * rc * rc) : 0.0;
    // Mach diamonds: knots on the axis + conical shock shells between them
    const float LAM = 1.55;
    float u = (z - 1.0) / LAM + 0.5;
    float f = fract(u) - 0.5;
    float kIdx = floor(u);
    float dk = abs(f) * 2.0;
    float kFade = exp(-max(kIdx, 0.0) * 0.38) * step(0.0, kIdx) * fade;
    float knot = g2(f * LAM / 0.2) * exp(-r * r * 5.0);
    float shell = g2((r - 0.7 * dk) / 0.1);
    // blue sheath hugging the exit
    float sheathR = 0.95 + 0.06 * z;
    float sheath = g2((r - sheathR) / 0.14) * exp(-z / 1.3);
    ef += AB * (body * 0.4 + cone * 3.0 + (knot * 5.5 + shell * 0.8) * kFade * (0.8 + 0.4 * turb));
    eb += AB * sheath * 0.7;
  }
  return vec2(ef, eb);
}

void main() {
  float R = vNoz.w;
  vec3 axis = normalize(vAxis.xyz);
  vec3 ro = (uLocalCam - vNoz.xyz) / R;
  vec3 rd = normalize(vPos - uLocalCam);
  float roz = dot(ro, axis), rdz = dot(rd, axis);
  vec3 ror = ro - roz * axis, rdr = rd - rdz * axis;
  float a = dot(rdr, rdr), b = dot(ror, rdr), c = dot(ror, ror) - ${PROXY_R * PROXY_R};
  float t0 = -1e9, t1 = 1e9;
  if (a > 1e-8) {
    float disc = b * b - a * c;
    if (disc <= 0.0) discard;
    float sq = sqrt(disc);
    t0 = (-b - sq) / a;
    t1 = (-b + sq) / a;
  } else if (c > 0.0) discard;
  if (abs(rdz) > 1e-6) {
    float ta = (${Z_MIN.toFixed(3)} - roz) / rdz, tb = (${L_MAX.toFixed(3)} - roz) / rdz;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (roz < ${Z_MIN.toFixed(3)} || roz > ${L_MAX.toFixed(3)}) discard;
  t0 = max(t0, 0.0);
  if (t1 <= t0) discard;
  // only march the part of the chord where the flame can be
  float zEnd = max(uLenAB, uLenDry) * 1.15 + 0.6;
  if (abs(rdz) > 1e-6) {
    float te = (zEnd - roz) / rdz;
    if (rdz > 0.0) t1 = min(t1, te); else t0 = max(t0, te);
    if (t1 <= t0) discard;
  }
  vec3 u = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 v = cross(axis, u);
  float dt = (t1 - t0) / float(AB_STEPS);
  float jit = fxIGN(gl_FragCoord.xy);
  vec2 acc = vec2(0.0);
  for (int i = 0; i < AB_STEPS; i++) {
    float t = t0 + (float(i) + jit) * dt;
    vec3 p = ro + rd * t;
    float z = dot(p, axis);
    vec3 pr = p - z * axis;
    float r = length(pr);
    float ang = r > 1e-5 ? atan(dot(pr, v), dot(pr, u)) : 0.0; // atan(0, 0) is undefined
    acc += abEmit(z, r, ang, vAxis.w);
  }
  acc *= dt;
  // nozzle glow from the closest approach of the ray to the exit centre
  float tc = max(-dot(ro, rd), 0.0);
  vec3 q = ro + rd * tc;
  acc.x += exp(-dot(q, q) * 1.3) * (0.2 + 0.3 * uThrottle + 1.0 * uAB);
  acc *= uFlick;
  // colourise the integrated energy through the AgX-calibrated fire ramp:
  // thin plume = saturated orange/red, dense core / knots / end-on = yellow-white
  // hue floor at orange (thin plume stays orange but dim), dense = yellow-white
  float h = mix(0.44, 1.0, 1.0 - exp(-acc.x * 0.42));
  vec3 col = fxFireRamp(h) * uTint * clamp(acc.x / 0.9, 0.0, 1.0);
  col += vec3(0.08, 0.28, 1.0) * max(acc.y, 0.0);
  col = max(col, 0.0);
  float m = max(col.r, max(col.g, col.b));
  col *= 1.0 / (1.0 + m / 40.0);
  gl_FragColor = vec4(clamp(col * vFogT, 0.0, 6.0e4), 0.0);
}`;

const _inv = new Matrix4();
const _cam = new Vector3();
const _a = new Vector3(), _u = new Vector3(), _w = new Vector3(), _p = new Vector3();

function buildProxy(nozzles) {
  const pos = [], noz = [], ax = [], idx = [];
  let base = 0;
  const rv = PROXY_R / Math.cos(Math.PI / SEG); // circumscribe the analytic cylinder
  nozzles.forEach((n, ni) => {
    const R = n.radius || 0.5;
    _a.copy(n.direction || _w.set(0, 0, 1)).normalize();
    _u.set(0, 1, 0);
    if (Math.abs(_a.y) > 0.9) _u.set(1, 0, 0);
    _u.crossVectors(_a, _u).normalize();
    _w.crossVectors(_a, _u).normalize();
    const o = n.position;
    const seed = ni * 0.37 + 0.13;
    const zs = [Z_MIN * R, L_MAX * R];
    // rings
    for (let r = 0; r < 2; r++) {
      for (let s = 0; s < SEG; s++) {
        const ang = (s / SEG) * Math.PI * 2;
        _p.copy(o).addScaledVector(_a, zs[r])
          .addScaledVector(_u, Math.cos(ang) * rv * R)
          .addScaledVector(_w, Math.sin(ang) * rv * R);
        pos.push(_p.x, _p.y, _p.z);
      }
    }
    // cap centres
    for (let r = 0; r < 2; r++) {
      _p.copy(o).addScaledVector(_a, zs[r]);
      pos.push(_p.x, _p.y, _p.z);
    }
    const nv = SEG * 2 + 2;
    for (let k = 0; k < nv; k++) {
      noz.push(o.x, o.y, o.z, R);
      ax.push(_a.x, _a.y, _a.z, seed);
    }
    const c0 = base + SEG * 2, c1 = c0 + 1;
    for (let s = 0; s < SEG; s++) {
      const s1 = (s + 1) % SEG;
      const a0 = base + s, a1 = base + s1, b0 = base + SEG + s, b1 = base + SEG + s1;
      idx.push(a0, a1, b0, a1, b1, b0); // side (outward)
      idx.push(c0, a1, a0); // start cap
      idx.push(c1, b0, b1); // end cap
    }
    base += nv;
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aNoz', new BufferAttribute(new Float32Array(noz), 4));
  g.setAttribute('aAxis', new BufferAttribute(new Float32Array(ax), 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Afterburner {
  constructor(nozzles, { color, steps = 12, uniforms, noise } = {}) {
    this.geometry = buildProxy(nozzles);
    this.uniforms = {
      uLocalCam: { value: new Vector3() },
      uFxTime: uniforms.uFxTime,
      uThrottle: { value: 0 },
      uAB: { value: 0 },
      uLenDry: { value: 1.5 },
      uLenAB: { value: 0.5 },
      uFlick: { value: 1 },
      uTint: { value: new Color(1, 1, 1) },
      uNoise: { value: noise },
      ...uniforms.fog
    };
    if (color) this.uniforms.uTint.value.set(color);
    this.material = new ShaderMaterial({
      name: 'fxAfterburner',
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: this.uniforms,
      defines: { AB_STEPS: String(steps | 0) },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: FrontSide,
      toneMapped: false,
      fog: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor
    });
    const mesh = new Mesh(this.geometry, this.material);
    mesh.name = 'fxAfterburnerFlame';
    mesh.renderOrder = 22;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const U = this.uniforms;
    const mat = this.material;
    mesh.onBeforeRender = function (renderer, scene, camera) {
      _inv.copy(this.matrixWorld).invert();
      _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
      U.uLocalCam.value.copy(_cam);
      mat.uniformsNeedUpdate = true;
    };
    this.mesh = mesh;
    this.object = new Group();
    this.object.name = 'fxAfterburner';
    this.object.add(mesh);
    this.throttle = 0;
    this.ab = 0;
    this._t = 0;
    this._ab = 0;
    this._seed = Math.random() * 10;
    this.disposed = false;
  }

  /** throttle01: dry thrust, afterburner01: reheat (0..1). */
  set(throttle01, afterburner01) {
    this.throttle = throttle01 < 0 ? 0 : throttle01 > 1 ? 1 : throttle01;
    this.ab = afterburner01 < 0 ? 0 : afterburner01 > 1 ? 1 : afterburner01;
  }

  update(dt, time) {
    // afterburner lights quickly, dies a bit slower; dry thrust spools
    const kA = 1 - Math.exp(-dt * (this.ab > this._ab ? 14 : 7));
    const kT = 1 - Math.exp(-dt * 5);
    this._ab += (this.ab - this._ab) * kA;
    this._t += (this.throttle - this._t) * kT;
    const U = this.uniforms;
    U.uThrottle.value = this._t;
    U.uAB.value = this._ab;
    U.uLenDry.value = 0.8 + 2.6 * this._t;
    U.uLenAB.value = 0.5 + 12.5 * this._ab;
    const s = this._seed;
    U.uFlick.value = 0.93 + 0.05 * Math.sin(time * 61 + s) + 0.03 * Math.sin(time * 97.3 + s * 2.1);
  }

  dispose() {
    this.disposed = true;
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
