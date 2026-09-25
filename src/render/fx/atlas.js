// Procedural FX textures rendered once on the GPU at startup (no image files):
//
//  atlas (4x4 cells, RGBA8, mipmapped)
//    rows 0-1  smoke puffs (8 variants): R density, GB baked normal, A erosion noise
//    row 2     fireballs (4 variants):   R density, G heat detail, B -, A erosion noise
//    row 3     [0] 2x2 debris shards (R alpha, GB facet normal, A glint mask)
//              [1] water spray / droplets, [2] soft mist, [3] spare soft puff
//  noise (tileable, RGBA8, repeat): R/G fbm, B ridged, A fine noise
import {
  LinearFilter, LinearMipmapLinearFilter, Mesh, OrthographicCamera, PlaneGeometry, RepeatWrapping,
  RGBAFormat, Scene, ShaderMaterial, UnsignedByteType, WebGLRenderTarget, ClampToEdgeWrapping
} from 'three';
import { FX_NOISE_GLSL } from './glsl.js';

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const ATLAS_FS = /* glsl */ `
varying vec2 vUv;
uniform float uTexel;
${FX_NOISE_GLSL}

float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { s += a * fxNoise(p); p = m * p + 17.3; a *= 0.5; }
  return s / 0.984;
}

// -------- smoke: union of hemispherical billows, domain warped
float smokeHeight(vec2 p, float seed) {
  vec2 w = vec2(fbm(p * 2.1 + seed * 7.13), fbm(p * 2.1 + seed * 3.71 + 11.0)) - 0.5;
  vec2 q = p + w * 0.26;
  float h = 0.0;
  for (int i = 0; i < 9; i++) {
    float fi = float(i);
    vec2 c = (fxHash22(vec2(seed * 13.7 + fi, fi * 3.1 + seed)) - 0.5) * 0.78;
    float r = 0.2 + 0.2 * fxHash12(vec2(fi * 1.7, seed * 5.3 + 2.0));
    if (i == 0) { c = vec2(0.0); r = 0.46; }
    vec2 d = q - c;
    float k = r * r - dot(d, d);
    if (k > 0.0) h = max(h, sqrt(k));
  }
  // small cauliflower detail riding on the billows
  h += (fbm(q * 7.0 + seed * 19.0) - 0.5) * 0.09 * smoothstep(0.0, 0.08, h);
  return h;
}

vec4 smokeCell(vec2 p, float seed) {
  p *= 0.88;
  float e = uTexel * 2.5;
  float h = smokeHeight(p, seed);
  float hx = smokeHeight(p + vec2(e, 0.0), seed);
  float hy = smokeHeight(p + vec2(0.0, e), seed);
  vec3 n = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.4));
  float dens = smoothstep(0.0, 0.26, h) * (0.62 + 0.55 * fbm(p * 3.3 + seed * 5.0));
  dens *= 1.0 - smoothstep(0.8, 0.87, length(p));
  float ero = fbm(p * 4.5 + seed * 31.0);
  n.xy *= smoothstep(0.0, 0.02, h);
  return vec4(clamp(dens, 0.0, 1.0), n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, ero);
}

// -------- fire: warped radial blob with ridged flame filaments
vec4 fireCell(vec2 p, float seed) {
  p *= 0.85;
  vec2 w = vec2(fbm(p * 1.7 + seed * 5.3), fbm(p * 1.7 + seed * 9.1 + 3.0)) - 0.5;
  vec2 q = p + w * 0.7;
  float r = length(q);
  float base = 1.0 - smoothstep(0.12, 0.85, r);
  float t1 = fbm(q * 3.6 + seed * 2.0);
  float ridged = 1.0 - abs(fbm(q * 2.6 + seed * 4.0) * 2.0 - 1.0);
  ridged = ridged * ridged;
  float dens = clamp(base * (0.25 + 1.25 * t1 * (0.4 + 0.8 * ridged)), 0.0, 1.0);
  dens *= 1.0 - smoothstep(0.8, 0.97, length(p));
  float heat = clamp(base * 0.75 + (t1 - 0.5) * 0.9 + ridged * 0.3 - 0.12, 0.0, 1.0);
  float ero = fbm(p * 6.0 + seed * 11.0);
  return vec4(dens, heat, 0.5, ero);
}

// -------- debris: 2x2 jagged shards with faceted normals
vec4 debrisCell(vec2 p01) {
  vec2 sub = floor(p01 * 2.0);
  vec2 p = fract(p01 * 2.0) * 2.0 - 1.0;
  float seed = sub.x + sub.y * 2.0 + 1.0;
  float a = atan(p.y, p.x);
  float N = 5.0 + floor(fxHash12(vec2(seed, 3.0)) * 3.0);
  float sec = (a + 3.14159265) / 6.2831853 * N;
  float i0 = floor(sec);
  float f = fract(sec);
  float i1 = mod(i0 + 1.0, N);
  float r0 = 0.35 + 0.5 * fxHash12(vec2(i0, seed * 7.0));
  float r1 = 0.35 + 0.5 * fxHash12(vec2(i1, seed * 7.0));
  float rr = mix(r0, r1, f) * (0.9 + 0.1 * sin(sec * 9.0));
  float d = length(p);
  float alpha = 1.0 - smoothstep(rr - 0.06, rr, d); // (smoothstep with edge0 > edge1 is undefined)
  vec2 fn = fxHash22(vec2(i0, seed * 3.0)) - 0.5;
  float bevel = smoothstep(rr - 0.15, rr, d);
  vec3 n = normalize(vec3(fn * 1.2 + normalize(p + 1e-4) * bevel * 0.8, 1.0));
  float glint = fxHash12(vec2(i0 * 1.3, seed));
  return vec4(alpha, n.x * 0.5 + 0.5, n.y * 0.5 + 0.5, glint);
}

// -------- water spray: droplet clusters in a soft cloud
vec4 sprayCell(vec2 p) {
  float r = length(p);
  float cloud = exp(-r * r * 3.2) * (0.35 + 0.9 * fbm(p * 3.0 + 4.0));
  float drops = 0.0;
  for (int i = 0; i < 36; i++) {
    float fi = float(i);
    vec2 c = (fxHash22(vec2(fi, 7.7)) - 0.5) * 1.35;
    float rad = 0.025 + 0.06 * fxHash12(vec2(fi, 1.3));
    drops = max(drops, (1.0 - smoothstep(rad * 0.25, rad, length(p - c))) * (1.0 - smoothstep(0.55, 0.9, length(c))));
  }
  float dens = clamp(cloud + drops * 0.8, 0.0, 1.0) * (1.0 - smoothstep(0.8, 0.98, r));
  vec2 g = p * 0.6;
  return vec4(dens, g.x * 0.5 + 0.5, g.y * 0.5 + 0.5, fbm(p * 5.0 + 2.0));
}

vec4 mistCell(vec2 p, float seed) {
  float r = length(p);
  float dens = exp(-r * r * 2.6) * (0.55 + 0.7 * fbm(p * 2.6 + seed));
  dens *= 1.0 - smoothstep(0.75, 0.98, r);
  vec2 g = p * 0.45;
  return vec4(clamp(dens, 0.0, 1.0), g.x * 0.5 + 0.5, g.y * 0.5 + 0.5, fbm(p * 4.0 + seed * 3.0));
}

void main() {
  vec2 cellF = vUv * 4.0;
  vec2 cell = floor(cellF);
  vec2 l01 = fract(cellF);
  vec2 p = l01 * 2.0 - 1.0;
  float idx = cell.x + cell.y * 4.0;
  vec4 o;
  if (cell.y < 2.0) o = smokeCell(p, idx + 1.0);
  else if (cell.y < 3.0) o = fireCell(p, cell.x + 21.0);
  else if (cell.x < 1.0) o = debrisCell(l01);
  else if (cell.x < 2.0) o = sprayCell(p);
  else o = mistCell(p, cell.x * 3.7);
  gl_FragColor = o;
}`;

const NOISE_FS = /* glsl */ `
varying vec2 vUv;
${FX_NOISE_GLSL}
float hashP(vec2 i, float per, float seed) { i = mod(i, per); return fxHash12(i + seed * 17.0); }
float noiseP(vec2 p, float per, float seed) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashP(i, per, seed), hashP(i + vec2(1.0, 0.0), per, seed), u.x),
             mix(hashP(i + vec2(0.0, 1.0), per, seed), hashP(i + vec2(1.0, 1.0), per, seed), u.x), u.y);
}
float fbmP(vec2 uv, float per, float seed) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noiseP(uv * per, per, seed + float(i)); per *= 2.0; a *= 0.5; }
  return s / 0.96875;
}
void main() {
  float r = fbmP(vUv, 4.0, 1.0);
  float g = fbmP(vUv, 8.0, 5.0);
  float b = 1.0 - abs(fbmP(vUv, 4.0, 9.0) * 2.0 - 1.0);
  float a = noiseP(vUv * 32.0, 32.0, 3.0);
  gl_FragColor = vec4(r, g, b * b, a);
}`;

function renderToTarget(renderer, rt, material) {
  const scene = new Scene();
  const geo = new PlaneGeometry(2, 2);
  const mesh = new Mesh(geo, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevXr = renderer.xr ? renderer.xr.enabled : false;
  if (renderer.xr) renderer.xr.enabled = false;
  renderer.autoClear = true;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  if (renderer.xr) renderer.xr.enabled = prevXr;
  geo.dispose();
  material.dispose();
}

/** Renders the FX atlas + tileable noise. Returns { atlas, noise, dispose() }. */
export function createFxTextures(renderer, { atlasSize = 1024, noiseSize = 256 } = {}) {
  const atlasRT = new WebGLRenderTarget(atlasSize, atlasSize, {
    type: UnsignedByteType,
    format: RGBAFormat,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    stencilBuffer: false
  });
  atlasRT.texture.wrapS = atlasRT.texture.wrapT = ClampToEdgeWrapping;
  atlasRT.texture.name = 'fxAtlas';
  const noiseRT = new WebGLRenderTarget(noiseSize, noiseSize, {
    type: UnsignedByteType,
    format: RGBAFormat,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    stencilBuffer: false
  });
  noiseRT.texture.wrapS = noiseRT.texture.wrapT = RepeatWrapping;
  noiseRT.texture.name = 'fxNoise';

  if (renderer) {
    renderToTarget(renderer, atlasRT, new ShaderMaterial({
      vertexShader: VS, fragmentShader: ATLAS_FS, uniforms: { uTexel: { value: 8 / atlasSize } },
      depthTest: false, depthWrite: false, toneMapped: false
    }));
    renderToTarget(renderer, noiseRT, new ShaderMaterial({
      vertexShader: VS, fragmentShader: NOISE_FS, depthTest: false, depthWrite: false, toneMapped: false
    }));
  }
  return {
    atlas: atlasRT.texture,
    noise: noiseRT.texture,
    atlasRT,
    noiseRT,
    dispose() {
      atlasRT.dispose();
      noiseRT.dispose();
    }
  };
}
