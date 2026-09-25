// Physically based single-scattering atmosphere (Rayleigh + Mie + ozone) with a
// cheap multiple-scattering term. The same model exists in GLSL (for the sky
// cubemap) and in JS (for sun/fog colours), so fog blends seamlessly into the
// horizon.
//
// On top of it an "arcade" stylisation (also in GLSL + JS, applied to the
// cubemap bake so IBL inherits it, and to the fog / cloud ambient colours):
// a soft knee tames the blown-out horizon, the hazy horizon takes the zenith's
// hue (light cyan-white instead of greenish grey), saturation goes up and the
// upper sky is brightened. See SKY_STYLE_DEFAULTS and `env.sky`.
import { Color, Vector3 } from 'three';

export const ATMOS_DEFAULTS = {
  rayleigh: 1.0, // multiplier on Rayleigh scattering
  mie: 1.0, // multiplier on Mie (haze)
  mieG: 0.8,
  ozone: 1.0,
  sunIntensity: 22,
  groundAlbedo: [0.03, 0.06, 0.09],
  multiScatter: 0.35,
  exposure: 1.0
};

/**
 * `env.sky` defaults.
 *   zenithBoost    brightness gain toward the zenith (negative = deeper upper sky)
 *   saturation     chroma gain around luma (1 = physical)
 *   horizonBright  brightness gain of the thin horizon band (can be negative)
 *   hue            optional sky hue as RGB (e.g. royal blue [0.08, 0.3, 1]); default:
 *                  the physical zenith hue
 *   skyHue         0..1: how much the upper sky takes that hue (keeps its brightness)
 *   horizonHue     0..1: how much the hazy horizon takes a pale version of it
 *                  (light cyan-white instead of greenish grey)
 *   knee           soft-knee luminance compression (blown horizons, sunsets)
 *   sunDisc        sun disc angular radius in degrees (the real sun is 0.27)
 *   sunGlow        strength of the hot glow around the disc
 *   iblSaturation  optional: saturation of the IBL bake (default: 40% of the dome's boost)
 * The area right around the sun keeps its physical colour (glow, sunsets).
 */
export const SKY_STYLE_DEFAULTS = {
  zenithBoost: -0.3,
  saturation: 1.35,
  horizonBright: 0.1,
  hue: null,
  skyHue: 0.85,
  horizonHue: 0.7,
  knee: 0.25,
  sunDisc: 1.6,
  sunGlow: 1
};

export const SKY_STYLE_GLSL = /* glsl */ `
uniform vec4 uSkyA;   // x zenithBoost, y saturation, z horizonBright, w knee
uniform vec4 uSkyB;   // rgb sky hue (colour / luma), w horizon hue lock
uniform float uSkyLock; // upper-sky hue lock
vec3 stylizeSky(vec3 col, vec3 rd, vec3 sunDir) {
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float lk = l / (1.0 + uSkyA.w * l);
  col *= lk / max(l, 1e-6);
  l = lk;
  float hz = exp(-abs(rd.y) * 7.0);
  float up = smoothstep(0.02, 0.35, rd.y);
  float nearSun = pow(max(dot(rd, sunDir), 0.0), 40.0);
  vec3 target = l * mix(vec3(1.0), uSkyB.rgb, 0.3 + 0.7 * up);
  col = mix(col, target, max(hz * uSkyB.w, up * uSkyLock) * (1.0 - nearSun));
  col = max(mix(vec3(l), col, uSkyA.y), 0.0);
  col *= (1.0 + uSkyA.x * smoothstep(0.0, 0.7, max(rd.y, 0.0))) * (1.0 + uSkyA.z * exp(-abs(rd.y) * 12.0));
  return col;
}
`;

const smooth01 = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Sky hue (colour / luma) for the hue locks: from `style.hue` (RGB) when set,
 * otherwise from the physical zenith radiance `zenith` (a Color).
 */
export function skyZenithHue(zenith, out = [1, 1, 1], hue = null) {
  const r = hue ? hue[0] : zenith.r, g = hue ? hue[1] : zenith.g, b = hue ? hue[2] : zenith.b;
  const l = Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 1e-6);
  out[0] = r / l;
  out[1] = g / l;
  out[2] = b / l;
  return out;
}

/** JS port of stylizeSky() (in place on a linear Color). */
export function stylizeSkyJS(col, rd, sunDir, style, zenithHue) {
  const s = { ...SKY_STYLE_DEFAULTS, ...style };
  let l = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
  const lk = l / (1 + s.knee * l);
  const k0 = lk / Math.max(l, 1e-6);
  let r = col.r * k0, g = col.g * k0, b = col.b * k0;
  l = lk;
  const hz = Math.exp(-Math.abs(rd.y) * 7);
  const up = smooth01(0.02, 0.35, rd.y);
  const mu = Math.max(rd.x * sunDir.x + rd.y * sunDir.y + rd.z * sunDir.z, 0);
  const lock = Math.max(hz * s.horizonHue, up * s.skyHue) * (1 - Math.pow(mu, 40));
  const zh = zenithHue || [1, 1, 1];
  const f0 = 0.3 + 0.7 * up;
  r += (l * (1 + (zh[0] - 1) * f0) - r) * lock;
  g += (l * (1 + (zh[1] - 1) * f0) - g) * lock;
  b += (l * (1 + (zh[2] - 1) * f0) - b) * lock;
  r = Math.max(0, l + (r - l) * s.saturation);
  g = Math.max(0, l + (g - l) * s.saturation);
  b = Math.max(0, l + (b - l) * s.saturation);
  const f = (1 + s.zenithBoost * smooth01(0, 0.7, Math.max(rd.y, 0))) * (1 + s.horizonBright * Math.exp(-Math.abs(rd.y) * 12));
  return col.setRGB(r * f, g * f, b * f);
}

export const ATMOSPHERE_GLSL = /* glsl */ `
#define PI 3.141592653589793
const float Rg = 6360e3;
const float Rt = 6460e3;
const vec3 BETA_R = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const float BETA_M = 3.996e-6;
const float BETA_M_EXT = 4.40e-6;
const vec3 BETA_O = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float HR = 8000.0;
const float HM = 1200.0;

uniform float uRayleigh;
uniform float uMie;
uniform float uMieG;
uniform float uOzone;
uniform float uSunIntensity;
uniform vec3 uGroundAlbedo;
uniform float uMultiScatter;
uniform vec3 uAtmosSunDir;
uniform float uViewHeight;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

vec3 extinctionAt(float h) {
  float dR = exp(-h / HR);
  float dM = exp(-h / HM);
  float dO = max(0.0, 1.0 - abs(h - 25000.0) / 15000.0);
  return BETA_R * uRayleigh * dR + vec3(BETA_M_EXT * uMie * dM) + BETA_O * uOzone * dO;
}

vec3 sunTransmittance(vec3 p, vec3 sunDir) {
  vec2 tg = raySphere(p, sunDir, Rg);
  if (tg.x > 0.0) return vec3(0.0);
  float tt = raySphere(p, sunDir, Rt).y;
  const int N = 6;
  float dt = tt / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = p + sunDir * (dt * (float(i) + 0.5));
    od += extinctionAt(length(q) - Rg) * dt;
  }
  return exp(-od);
}

float phaseR(float mu) { return 3.0 / (16.0 * PI) * (1.0 + mu * mu); }
float phaseM(float mu, float g) {
  float g2 = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

// Returns in-scattered radiance along rd (and ground radiance when hitting it).
vec3 atmosphere(vec3 rd, vec3 sunDir) {
  vec3 ro = vec3(0.0, Rg + uViewHeight, 0.0);
  vec2 ta = raySphere(ro, rd, Rt);
  vec2 tg = raySphere(ro, rd, Rg);
  float tMax = ta.y;
  bool hitGround = tg.x > 0.0;
  if (hitGround) tMax = tg.x;
  const int N = 20;
  float dt = tMax / float(N);
  float mu = dot(rd, sunDir);
  float pr = phaseR(mu);
  float pm = phaseM(mu, uMieG);
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  for (int i = 0; i < N; i++) {
    vec3 p = ro + rd * (dt * (float(i) + 0.5));
    float h = length(p) - Rg;
    vec3 ext = extinctionAt(h);
    vec3 sT = sunTransmittance(p, sunDir);
    vec3 scR = BETA_R * uRayleigh * exp(-h / HR);
    vec3 scM = vec3(BETA_M * uMie * exp(-h / HM));
    vec3 S = (scR * pr + scM * pm) * sT;
    // cheap isotropic multiple scattering approximation
    S += (scR + scM) * uMultiScatter * (0.08 + 0.92 * max(sunDir.y + 0.08, 0.0)) * (1.0 / (4.0 * PI)) * vec3(1.0, 0.98, 0.95);
    vec3 sampleT = exp(-ext * dt);
    vec3 Sint = (S - S * sampleT) / max(ext, vec3(1e-12));
    L += T * Sint;
    T *= sampleT;
  }
  if (hitGround) {
    vec3 p = ro + rd * tMax;
    vec3 n = normalize(p);
    float ndl = max(dot(n, sunDir), 0.0);
    vec3 sT = sunTransmittance(p, sunDir);
    vec3 ambient = vec3(0.35, 0.45, 0.6) * (0.05 + 0.3 * max(sunDir.y + 0.1, 0.0));
    L += T * uGroundAlbedo * (sT * ndl / PI + ambient);
  }
  return L * uSunIntensity;
}
`;

// ---------------------------------------------------------------- JS port
const Rg = 6360e3, Rt = 6460e3;
const BR = [5.802e-6, 13.558e-6, 33.1e-6];
const BM = 3.996e-6, BME = 4.4e-6;
const BO = [0.65e-6, 1.881e-6, 0.085e-6];
const HR = 8000, HM = 1200;

function raySphere(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const d = b * b - c;
  if (d < 0) return null;
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

function extinction(h, p, out) {
  const dR = Math.exp(-h / HR), dM = Math.exp(-h / HM);
  const dO = Math.max(0, 1 - Math.abs(h - 25000) / 15000);
  for (let i = 0; i < 3; i++) out[i] = BR[i] * p.rayleigh * dR + BME * p.mie * dM + BO[i] * p.ozone * dO;
  return out;
}

const _e = [0, 0, 0];
function sunTransmittance(px, py, pz, s, p, out) {
  const g = raySphere(px, py, pz, s.x, s.y, s.z, Rg);
  if (g && g[0] > 0) {
    out[0] = out[1] = out[2] = 0;
    return out;
  }
  const t = raySphere(px, py, pz, s.x, s.y, s.z, Rt)[1];
  const N = 8, dt = t / N;
  let o0 = 0, o1 = 0, o2 = 0;
  for (let i = 0; i < N; i++) {
    const k = dt * (i + 0.5);
    const qx = px + s.x * k, qy = py + s.y * k, qz = pz + s.z * k;
    extinction(Math.hypot(qx, qy, qz) - Rg, p, _e);
    o0 += _e[0] * dt; o1 += _e[1] * dt; o2 += _e[2] * dt;
  }
  out[0] = Math.exp(-o0); out[1] = Math.exp(-o1); out[2] = Math.exp(-o2);
  return out;
}

function phaseR(mu) {
  return (3 / (16 * Math.PI)) * (1 + mu * mu);
}
function phaseM(mu, g) {
  const g2 = g * g;
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * Math.pow(Math.max(1 + g2 - 2 * g * mu, 1e-4), 1.5));
}

/** Sky radiance along direction `rd` (Vector3, normalized). Returns Color (linear). */
export function atmosphereJS(rd, sunDir, params, viewHeight = 200, out = new Color()) {
  const p = { ...ATMOS_DEFAULTS, ...params };
  const ox = 0, oy = Rg + viewHeight, oz = 0;
  const ta = raySphere(ox, oy, oz, rd.x, rd.y, rd.z, Rt);
  const tg = raySphere(ox, oy, oz, rd.x, rd.y, rd.z, Rg);
  let tMax = ta[1];
  const hitGround = tg && tg[0] > 0;
  if (hitGround) tMax = tg[0];
  const N = 24, dt = tMax / N;
  const mu = rd.x * sunDir.x + rd.y * sunDir.y + rd.z * sunDir.z;
  const pr = phaseR(mu), pm = phaseM(mu, p.mieG);
  const L = [0, 0, 0], T = [1, 1, 1], ext = [0, 0, 0], sT = [0, 0, 0];
  const ms = p.multiScatter * (0.08 + 0.92 * Math.max(sunDir.y + 0.08, 0)) / (4 * Math.PI);
  const msTint = [1, 0.98, 0.95];
  for (let i = 0; i < N; i++) {
    const k = dt * (i + 0.5);
    const px = ox + rd.x * k, py = oy + rd.y * k, pz = oz + rd.z * k;
    const h = Math.hypot(px, py, pz) - Rg;
    extinction(h, p, ext);
    sunTransmittance(px, py, pz, sunDir, p, sT);
    const dR = Math.exp(-h / HR), dM = Math.exp(-h / HM);
    for (let c = 0; c < 3; c++) {
      const scR = BR[c] * p.rayleigh * dR;
      const scM = BM * p.mie * dM;
      const S = (scR * pr + scM * pm) * sT[c] + (scR + scM) * ms * msTint[c];
      const st = Math.exp(-ext[c] * dt);
      const Sint = (S - S * st) / Math.max(ext[c], 1e-12);
      L[c] += T[c] * Sint;
      T[c] *= st;
    }
  }
  if (hitGround) {
    const px = ox + rd.x * tMax, py = oy + rd.y * tMax, pz = oz + rd.z * tMax;
    const len = Math.hypot(px, py, pz);
    const ndl = Math.max((px * sunDir.x + py * sunDir.y + pz * sunDir.z) / len, 0);
    sunTransmittance(px, py, pz, sunDir, p, sT);
    const amb = [0.35, 0.45, 0.6];
    const ak = 0.05 + 0.3 * Math.max(sunDir.y + 0.1, 0);
    for (let c = 0; c < 3; c++) L[c] += T[c] * p.groundAlbedo[c] * ((sT[c] * ndl) / Math.PI + amb[c] * ak);
  }
  const I = p.sunIntensity * p.exposure;
  return out.setRGB(L[0] * I, L[1] * I, L[2] * I);
}

/** Direct sun colour at the given altitude (transmittance * intensity scale). */
export function sunColorJS(sunDir, params, height = 200, out = new Color()) {
  const p = { ...ATMOS_DEFAULTS, ...params };
  const sT = [0, 0, 0];
  sunTransmittance(0, Rg + height, 0, sunDir, p, sT);
  return out.setRGB(sT[0], sT[1], sT[2]);
}

export function sunDirFromAngles(elevationDeg, azimuthDeg, out = new Vector3()) {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  // azimuth 0 = toward -Z (default flight direction), positive = toward +X
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
