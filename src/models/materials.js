// Materials for procedural vehicles. All shader patches go through
// addShaderHook (chains with CSM + world fog). Standard chunk markers are kept.

import { MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Color, Vector2 } from 'three';
import { addShaderHook, injectAfter } from '../render/shaderHooks.js';
import { WorldUniforms } from '../render/worldUniforms.js';
import { liveryUniforms, getDecalAtlas, MAX_DECALS, ZONE_COUNT } from './livery.js';

// ---------------------------------------------------------------- GLSL ------
const NOISE_GLSL = /* glsl */ `
float livH3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float livNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(livH3(i), livH3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(livH3(i + vec3(0.0, 1.0, 0.0)), livH3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(livH3(i + vec3(0.0, 0.0, 1.0)), livH3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(livH3(i + vec3(0.0, 1.0, 1.0)), livH3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
#ifdef LIV_LITE
#define LIV_OCTAVES 3
#else
#define LIV_OCTAVES 4
#endif
float livFbm(vec3 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < LIV_OCTAVES; i++) {
    s += a * livNoise(p);
    p = p * 2.03 + vec3(17.1, 5.3, 11.7);
    a *= 0.5;
  }
  return s / (1.0 - pow(0.5, float(LIV_OCTAVES)));
}
`;

const BODY_VERT_PARS = /* glsl */ `
attribute float aZone;
varying vec3 vLivPos;
varying vec3 vLivNrm;
varying float vLivZone;
`;
const BODY_VERT_MAIN = /* glsl */ `
vLivPos = position;
vLivNrm = normal;
vLivZone = aZone;
`;

const BODY_FRAG_PARS = /* glsl */ `
varying vec3 vLivPos;
varying vec3 vLivNrm;
varying float vLivZone;
uniform vec3 uLivTop;
uniform vec3 uLivBottom;
uniform vec4 uLivCounter;
uniform vec3 uLivCamoA;
uniform vec3 uLivCamoB;
uniform vec4 uLivCamo;
uniform vec3 uLivStripeA;
uniform vec3 uLivStripeB;
uniform vec4 uLivStripe;
uniform vec4 uLivStripe2;
uniform vec4 uLivStripe3;
uniform vec3 uLivTail;
uniform vec4 uLivTailP;
uniform vec4 uLivPanel;
uniform vec4 uLivWear;
uniform vec4 uLivMisc;
uniform vec4 uLivRadome;
uniform vec3 uLivRadomeCol;
uniform vec4 uLivGlare;
uniform vec3 uLivGlareCol;
uniform vec4 uLivWater;
uniform vec4 uLivMat;
uniform vec4 uLivZones[${ZONE_COUNT}];
uniform vec3 uLivInk;
uniform sampler2D uLivDecalTex;
uniform vec4 uLivDecC[LIV_MAX_DECALS];
uniform vec4 uLivDecU[LIV_MAX_DECALS];
uniform vec4 uLivDecV[LIV_MAX_DECALS];
uniform vec4 uLivDecN[LIV_MAX_DECALS];
uniform vec4 uLivDecR[LIV_MAX_DECALS];
uniform vec4 uLivDecTint;
${NOISE_GLSL}

// distance (m) to the nearest panel seam in a 2D projection, panel id, rivet mask
vec3 livPanel(vec2 p, vec2 cell, float px) {
  float ry = p.y / cell.y;
  float row = floor(ry);
  float fy = fract(ry);
  float dy = min(fy, 1.0 - fy) * cell.y;
  float rx = p.x / cell.x + livH3(vec3(row, 7.1, 1.3)) * 3.7;
  float col = floor(rx);
  float fx = fract(rx);
  float dx = min(fx, 1.0 - fx) * cell.x;
  float id = livH3(vec3(row, col, 5.7));
  if (id > 0.62) {
    dx = min(dx, abs(fx - 0.5) * cell.x);
    id = fract(id * 13.7 + step(0.5, fx) * 0.41);
  }
  float rv = 0.0;
#ifndef LIV_LITE
  if (px < 0.004) {
    float off = 0.026;
    float sp = 0.07;
    float rr = 0.0042;
    float r1 = length(vec2(dy - off, (fract(p.x / sp) - 0.5) * sp));
    float r2 = length(vec2(dx - off, (fract(p.y / sp) - 0.5) * sp));
    rv = max(1.0 - smoothstep(rr, rr + px, r1), 1.0 - smoothstep(rr, rr + px, r2));
    rv *= 1.0 - smoothstep(0.0022, 0.004, px);
  }
#endif
  return vec3(min(dx, dy), id, rv);
}

vec3 livSplinter(float c) {
  float h = livH3(vec3(c, 3.3, 9.1));
  return h < uLivCamo.z ? uLivTop : (h < uLivCamo.w ? uLivCamoA : uLivCamoB);
}

vec3 livPerturbNormal(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const BODY_FRAG_MAIN = /* glsl */ `
vec3 livP = vLivPos;
vec3 livN = normalize(vLivNrm);
vec3 livDx = dFdx(livP);
vec3 livDy = dFdy(livP);
float livPx = max(max(length(livDx), length(livDy)), 1e-5);
float livZoneId = floor(vLivZone + 0.5);
float livPaint = 1.0 - step(0.5, livZoneId);
float livRough = uLivMat.x;
float livMetal = uLivMat.y;
float livH = 0.0;

// --- base paint + countershading
float livUp = smoothstep(uLivCounter.x - uLivCounter.y, uLivCounter.x + uLivCounter.y, livN.y);
vec3 livCol = mix(uLivBottom, uLivTop, livUp);

// --- camouflage (upper surfaces and sides)
if (uLivCamo.x > 0.5) {
  vec3 cp = livP * uLivCamo.y;
  vec3 camo;
  if (uLivCamo.x < 1.5) {
    float n1 = livFbm(cp + vec3(3.1, 7.7, 1.3));
    float n2 = livFbm(cp * 1.37 + vec3(11.0, 2.0, 5.0));
    // crisp (lightly sprayed) edges, anti-aliased with screen derivatives
    float e1 = fwidth(n1) * 0.75 + 0.0025;
    float e2 = fwidth(n2) * 0.75 + 0.0025;
    camo = mix(uLivTop, uLivCamoA, smoothstep(uLivCamo.z - e1, uLivCamo.z + e1, n1));
    camo = mix(camo, uLivCamoB, smoothstep(uLivCamo.w - e2, uLivCamo.w + e2, n2));
  } else {
    vec4 S = vec4(
      sin(dot(cp, vec3(0.83, 0.21, 0.52)) * 2.1 + 0.3),
      sin(dot(cp, vec3(-0.44, 0.35, 0.83)) * 2.7 + 1.9),
      sin(dot(cp, vec3(0.61, -0.52, -0.6)) * 1.7 + 4.2),
      sin(dot(cp, vec3(0.2, 0.9, -0.38)) * 2.3 + 2.6));
    vec4 W = fwidth(S) + 1e-4;
    vec4 bits = step(0.0, S);
    vec4 dist = abs(S) / W;
    float m = min(min(dist.x, dist.y), min(dist.z, dist.w));
    vec4 isMin = step(dist, vec4(m + 1e-4));
    vec4 flipped = abs(bits - isMin);
    vec3 cA = livSplinter(dot(bits, vec4(1.0, 2.0, 4.0, 8.0)));
    vec3 cB = livSplinter(dot(flipped, vec4(1.0, 2.0, 4.0, 8.0)));
    camo = mix(cB, cA, clamp(m * 0.5 + 0.5, 0.5, 1.0));
  }
  livCol = mix(livCol, camo, livUp);
}

// --- special-scheme stripes
if (uLivStripe.x > 0.5) {
  float e = livPx;
  float side = smoothstep(uLivStripe2.w, uLivStripe2.w + 0.15, abs(livN.x));
  float inZ = step(uLivStripe2.x, livP.z) * step(livP.z, uLivStripe2.y);
  float tri = abs(fract(livP.z / uLivStripe2.z) - 0.5) * 4.0 - 1.0;
  float d = abs(livP.y - (uLivStripe.y + uLivStripe.z * tri));
  float inner = 1.0 - smoothstep(uLivStripe.w - e, uLivStripe.w + e, d);
  float outer = 1.0 - smoothstep(uLivStripe.w * 1.7 - e, uLivStripe.w * 1.7 + e, d);
  float fm = side * inZ * step(abs(livP.x), uLivStripe3.w);
  livCol = mix(livCol, uLivStripeB, outer * fm);
  livCol = mix(livCol, uLivStripeA, inner * fm);
  float top = smoothstep(0.45, 0.8, livN.y);
  float dw = abs(livP.z - (uLivStripe3.x + uLivStripe3.y * abs(livP.x)));
  float wi = 1.0 - smoothstep(uLivStripe3.z - e, uLivStripe3.z + e, dw);
  float wo = 1.0 - smoothstep(uLivStripe3.z * 1.8 - e, uLivStripe3.z * 1.8 + e, dw);
  float wm = top * step(uLivStripe3.w, abs(livP.x));
  livCol = mix(livCol, uLivStripeB, wo * wm);
  livCol = mix(livCol, uLivStripeA, wi * wm);
}

// --- coloured tail tips
if (uLivTailP.x > 0.5) {
  float t = smoothstep(uLivTailP.y - livPx, uLivTailP.y + livPx, livP.y) * step(uLivTailP.z, livP.z);
  livCol = mix(livCol, uLivTail, t);
}

// --- radome / anti-glare / waterline
if (uLivRadome.y > 0.5) {
  float r = 1.0 - smoothstep(uLivRadome.x - 0.01, uLivRadome.x + 0.01, livP.z);
  livCol = mix(livCol, uLivRadomeCol, r);
  livRough = mix(livRough, 0.38, r);
}
if (uLivGlare.w > 0.5) {
  float g = step(uLivGlare.x, livP.z) * step(livP.z, uLivGlare.y) * smoothstep(0.3, 0.55, livN.y)
    * (1.0 - smoothstep(uLivGlare.z - 0.03, uLivGlare.z, abs(livP.x)));
  livCol = mix(livCol, uLivGlareCol, g);
  livRough = mix(livRough, 0.85, g);
}
if (uLivWater.z > 0.5) {
  float boot = 1.0 - smoothstep(uLivWater.y - 0.03, uLivWater.y + 0.03, livP.y);
  float red = 1.0 - smoothstep(uLivWater.x - 0.03, uLivWater.x + 0.03, livP.y);
  livCol = mix(livCol, vec3(0.018), boot);
  livCol = mix(livCol, vec3(0.2, 0.025, 0.02), red);
}

// --- decals (object-space planar projection)
for (int i = 0; i < LIV_MAX_DECALS; i++) {
  if (float(i) >= uLivDecTint.w) break;
  vec3 dd = livP - uLivDecC[i].xyz;
  vec3 dn = uLivDecN[i].xyz;
  if (abs(dot(dd, dn)) > uLivDecN[i].w) continue;
  float facing = dot(livN, dn);
  float flags = uLivDecC[i].w;
  float ink = step(2.5, flags);
  float side = flags - ink * 4.0;
  if (abs(facing) < 0.3) continue;
  if (side > 0.5 && facing < 0.0) continue;
  if (side < -0.5 && facing > 0.0) continue;
  float fs = facing < 0.0 ? -1.0 : 1.0;
  vec2 duv = vec2(dot(dd, uLivDecU[i].xyz) * uLivDecU[i].w * fs, dot(dd, uLivDecV[i].xyz) * uLivDecV[i].w);
  vec2 uv = duv + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
  vec4 rect = uLivDecR[i];
  vec2 gx = vec2(dot(livDx, uLivDecU[i].xyz) * uLivDecU[i].w * fs, dot(livDx, uLivDecV[i].xyz) * uLivDecV[i].w) * rect.zw;
  vec2 gy = vec2(dot(livDy, uLivDecU[i].xyz) * uLivDecU[i].w * fs, dot(livDy, uLivDecV[i].xyz) * uLivDecV[i].w) * rect.zw;
  vec4 tx = textureGrad(uLivDecalTex, rect.xy + uv * rect.zw, gx, gy);
  vec3 rgb = tx.rgb;
  float a = tx.a;
  if (ink > 0.5) rgb = uLivInk * dot(rgb, vec3(0.3333));
  float lum = dot(rgb, vec3(0.3, 0.59, 0.11));
  rgb = mix(vec3(lum), rgb, uLivDecTint.x) * uLivDecTint.y;
  a *= uLivDecTint.z;
  rgb *= uLivDecTint.z;
  livCol = livCol * (1.0 - a * livPaint) + rgb * livPaint;
}

// --- fixed-colour zones (intakes, radomes, tyres, bands...)
if (livZoneId > 0.5) {
  vec4 zc = uLivZones[int(min(livZoneId, ${ZONE_COUNT - 1}.0))];
  livCol = zc.rgb;
  livRough = zc.w;
}

// --- panel lines, rivets, per-panel tone (triplanar on object axes)
{
  vec3 w3 = pow(abs(livN), vec3(4.0));
  w3 /= (w3.x + w3.y + w3.z);
  vec2 cell = uLivPanel.xy;
  float hw = uLivPanel.z;
  float fade = 1.0 - smoothstep(0.012, 0.05, livPx / cell.y);
  float line = 0.0;
  float pid = 0.5;
  float rivet = 0.0;
  float groove = 0.0;
  if (fade > 0.0) {
    pid = 0.0;
    float lw = max(hw, livPx * 0.75);
    if (w3.x > 0.02) {
      vec3 r = livPanel(livP.zy, cell, livPx);
      line += w3.x * (1.0 - smoothstep(lw - livPx * 0.5, lw + livPx * 0.5, r.x)) * (hw / lw);
      groove += w3.x * (1.0 - smoothstep(0.0, hw * 2.2, r.x));
      pid += w3.x * r.y;
      rivet += w3.x * r.z;
    }
    if (w3.y > 0.02) {
      vec3 r = livPanel(livP.zx + vec2(0.0, 0.37), vec2(cell.x, cell.y * 1.3), livPx);
      line += w3.y * (1.0 - smoothstep(lw - livPx * 0.5, lw + livPx * 0.5, r.x)) * (hw / lw);
      groove += w3.y * (1.0 - smoothstep(0.0, hw * 2.2, r.x));
      pid += w3.y * r.y;
      rivet += w3.y * r.z;
    }
    if (w3.z > 0.02) {
      vec3 r = livPanel(livP.xy + vec2(0.21, 0.0), cell.yy, livPx);
      line += w3.z * (1.0 - smoothstep(lw - livPx * 0.5, lw + livPx * 0.5, r.x)) * (hw / lw);
      groove += w3.z * (1.0 - smoothstep(0.0, hw * 2.2, r.x));
      pid += w3.z * r.y;
      rivet += w3.z * r.z;
    }
    pid = mix(0.5, pid, fade);
  }
  float strength = uLivPanel.w * fade;
  livCol *= 1.0 + (pid - 0.5) * uLivMisc.y * 2.0;
  livRough += (pid - 0.5) * uLivMisc.z * 2.0;
  livCol *= 1.0 - line * 0.5 * strength;
  livCol *= 1.0 - rivet * 0.1 * strength;
  livH = (-groove * 0.0011 + rivet * 0.00025) * strength;
}

// --- mottling, grime streaks (stretched along +z airflow), exhaust soot
{
  livCol *= 0.965 + 0.07 * livNoise(livP * 2.7);
  float g = livFbm(vec3(livP.x * 2.2, livP.y * 2.2, livP.z * 0.28) + vec3(5.0));
  float grime = smoothstep(0.42, 0.82, g) * uLivWear.x * (0.55 + 0.45 * (1.0 - livUp));
  livCol *= 1.0 - grime * 0.32;
  livRough += grime * 0.14;
  float soot = smoothstep(uLivWear.z, uLivWear.w, livP.z) * step(abs(livP.x), uLivMisc.x) * uLivWear.y;
  soot *= 0.5 + 0.5 * livFbm(vec3(livP.x * 5.0, livP.y * 5.0, livP.z * 0.5));
  soot = clamp(soot, 0.0, 0.9);
  livCol = mix(livCol, vec3(0.022, 0.02, 0.018), soot);
  livRough = mix(livRough, 0.82, soot);
}

diffuseColor.rgb *= livCol;
`;

const BODY_ROUGH = /* glsl */ `
roughnessFactor = clamp(livRough, 0.04, 1.0);
`;
const BODY_METAL = /* glsl */ `
metalnessFactor = clamp(livMetal, 0.0, 1.0);
`;
const BODY_NORMAL = /* glsl */ `
#ifndef LIV_LITE
{
  vec2 livDH = vec2(dFdx(livH), dFdy(livH)) * uLivMisc.w;
  normal = livPerturbNormal(-vViewPosition, normal, livDH, faceDirection);
}
#endif
`;

function patchVertexCommon(shader, pars, main) {
  shader.vertexShader = injectAfter(shader.vertexShader, '#include <common>', pars);
  shader.vertexShader = injectAfter(shader.vertexShader, '#include <begin_vertex>', main);
}

// ------------------------------------------------------------ factories -----

/** Livery body material (MeshStandard, or MeshPhysical with clearcoat for glossy schemes). */
export function createBodyMaterial(liv, decals, { instanced = false } = {}) {
  const atlas = getDecalAtlas();
  const physical = !instanced && liv.clearcoat > 0;
  const mat = physical
    ? new MeshPhysicalMaterial({ clearcoat: liv.clearcoat, clearcoatRoughness: 0.12 })
    : new MeshStandardMaterial();
  mat.name = 'livery';
  mat.color.set(0xffffff);
  mat.roughness = liv.rough;
  mat.metalness = liv.metal;
  mat.envMapIntensity = 1.0;
  mat.defines = { ...(mat.defines || {}), LIV_MAX_DECALS: MAX_DECALS };
  if (instanced) mat.defines.LIV_LITE = '';
  const U = liveryUniforms(liv, decals, atlas);
  mat.userData.uniforms = U;
  mat.userData.livery = liv;
  addShaderHook(mat, 'livery', (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertexCommon(shader, BODY_VERT_PARS, BODY_VERT_MAIN);
    let fs = shader.fragmentShader;
    fs = injectAfter(fs, '#include <common>', BODY_FRAG_PARS);
    fs = injectAfter(fs, '#include <color_fragment>', BODY_FRAG_MAIN);
    fs = injectAfter(fs, '#include <roughnessmap_fragment>', BODY_ROUGH);
    fs = injectAfter(fs, '#include <metalnessmap_fragment>', BODY_METAL);
    fs = injectAfter(fs, '#include <normal_fragment_maps>', BODY_NORMAL);
    shader.fragmentShader = fs;
  });
  return mat;
}

/** Dark amber canopy glass: opaque, glossy, strong reflections. */
export function createGlassMaterial({ instanced = false, tint = '#3b2a12' } = {}) {
  const mat = new MeshPhysicalMaterial({
    color: new Color(tint),
    metalness: 0.28,
    roughness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 2.4,
    specularIntensity: 1.0
  });
  if (!instanced) {
    mat.iridescence = 0.35;
    mat.iridescenceIOR = 1.32;
    mat.iridescenceThicknessRange = [140, 420];
  }
  mat.name = 'canopy';
  return mat;
}

const GLOW_VERT_PARS = /* glsl */ `
attribute float aGlow;
varying float vGlow;
varying vec3 vGlowPos;
`;
const GLOW_VERT_MAIN = /* glsl */ `
vGlow = aGlow;
vGlowPos = position;
`;
const GLOW_FRAG_PARS = /* glsl */ `
varying float vGlow;
varying vec3 vGlowPos;
uniform float uAfterburner;
uniform float uLightIntensity;
uniform float uGlowTime;
`;
const GLOW_FRAG_MAIN = /* glsl */ `
{
  float k = uLightIntensity;
  if (vGlow > 0.5 && vGlow < 1.5) {
    float ab = clamp(uAfterburner, 0.0, 1.0);
    k = mix(0.3, 7.0, ab * ab);
    float mx = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.72, 0.42) * mx, ab * 0.35);
  } else if (vGlow > 1.5 && vGlow < 2.5) {
    float ph = fract(uGlowTime * 0.8 + vGlowPos.y * 0.37 + vGlowPos.z * 0.05);
    k = uLightIntensity * (3.0 * step(ph, 0.06) + 0.04);
  } else if (vGlow > 2.5) {
    k = uLightIntensity * 0.035;
  }
  diffuseColor.rgb *= k;
}
`;

/** Emissive parts: nozzle glow (uAfterburner 0..1), nav/strobe/formation lights. */
export function createEmissiveMaterial() {
  const mat = new MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  mat.name = 'emissive';
  const U = {
    uAfterburner: { value: 0 },
    uLightIntensity: { value: 5 },
    uGlowTime: WorldUniforms.uTime
  };
  mat.userData.uniforms = U;
  addShaderHook(mat, 'glow', (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertexCommon(shader, GLOW_VERT_PARS, GLOW_VERT_MAIN);
    shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <common>', GLOW_FRAG_PARS);
    shader.fragmentShader = injectAfter(shader.fragmentShader, '#include <color_fragment>', GLOW_FRAG_MAIN);
  });
  return mat;
}

const METAL_VERT_PARS = /* glsl */ `
attribute float aZone;
varying vec3 vMetPos;
varying float vMetZone;
`;
const METAL_VERT_MAIN = /* glsl */ `
vMetPos = position;
vMetZone = aZone;
`;
const METAL_FRAG_PARS = /* glsl */ `
varying vec3 vMetPos;
varying float vMetZone;
uniform vec2 uMetHeat;
uniform vec3 uMetTint;
${NOISE_GLSL}
`;
const METAL_FRAG_MAIN = /* glsl */ `
float metRough;
{
  vec3 mp = vMetPos;
  float heat = smoothstep(uMetHeat.x, uMetHeat.y, mp.z);
  vec3 c = uMetTint;
  c = mix(c, vec3(0.58, 0.44, 0.26), smoothstep(0.2, 0.6, heat) * 0.8);
  c = mix(c, vec3(0.26, 0.27, 0.42), smoothstep(0.6, 1.0, heat) * 0.7);
  float streak = livNoise(vec3(mp.x * 30.0, mp.y * 30.0, mp.z * 1.4));
  float fine = livNoise(vec3(mp.x * 90.0, mp.y * 90.0, mp.z * 3.0));
  c *= 0.72 + 0.42 * streak + 0.1 * fine;
  metRough = 0.26 + 0.22 * streak;
  if (vMetZone > 0.5) {
    c *= 0.22;
    metRough = 0.75;
  }
  diffuseColor.rgb *= c;
}
`;

/** Bare metal: nozzle petals (heat-tinted titanium), pitots, gun barrels. */
export function createMetalMaterial({ heat = [1e5, 1e5 + 1], tint = '#8a8680' } = {}) {
  const mat = new MeshStandardMaterial({ color: 0xffffff, metalness: 1.0, roughness: 0.35 });
  mat.name = 'metal';
  mat.envMapIntensity = 1.2;
  const U = {
    uMetHeat: { value: new Vector2(heat[0], heat[1]) },
    uMetTint: { value: new Color(tint) }
  };
  mat.userData.uniforms = U;
  addShaderHook(mat, 'metal', (shader) => {
    Object.assign(shader.uniforms, U);
    patchVertexCommon(shader, METAL_VERT_PARS, METAL_VERT_MAIN);
    let fs = shader.fragmentShader;
    fs = injectAfter(fs, '#include <common>', METAL_FRAG_PARS);
    fs = injectAfter(fs, '#include <color_fragment>', METAL_FRAG_MAIN);
    fs = injectAfter(fs, '#include <roughnessmap_fragment>', 'roughnessFactor = metRough;');
    shader.fragmentShader = fs;
  });
  return mat;
}
