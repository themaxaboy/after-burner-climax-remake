import {
  Color, DataTexture, DoubleSide, LinearFilter, LinearMipmapLinearFilter, Mesh, RedFormat, RepeatWrapping, ShaderMaterial,
  UnsignedByteType, CircleGeometry
} from 'three';
import { WorldUniforms, WORLD_FOG_PARS } from '../render/worldUniforms.js';
import { makeNoise } from './terrain/noise.js';

/** Tileable fbm noise texture (R8), used for cheap cloud density lookups. */
function noiseTexture(size = 256, seed = 7) {
  const n = makeNoise(seed);
  const data = new Uint8Array(size * size);
  const P = 8; // period in lattice cells for tiling
  // tileable value noise by blending 4 shifted copies
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let sum = 0, amp = 0.5, f = P;
      for (let o = 0; o < 5; o++) {
        const a = n.value(u * f, v * f), b = n.value((u - 1) * f, v * f);
        const c = n.value(u * f, (v - 1) * f), d = n.value((u - 1) * f, (v - 1) * f);
        const val = a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
        sum += val * amp;
        amp *= 0.5;
        f *= 2;
      }
      data[y * size + x] = Math.max(0, Math.min(255, (sum * 0.5 + 0.5) * 255));
    }
  }
  const t = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const vertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const fragment = /* glsl */ `
uniform sampler2D tNoise;
uniform float uTimeD;
uniform float uCover;
uniform float uScale;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uAmbient;
uniform float uSunI;
uniform float uOpacity;
varying vec3 vWorld;
${WORLD_FOG_PARS}

float dens(vec2 p) {
  float a = texture2D(tNoise, p).r;
  float b = texture2D(tNoise, p * 3.1 + vec2(0.37, 0.11)).r;
  float c = texture2D(tNoise, p * 9.7 - vec2(uTimeD * 0.002, 0.0)).r;
  return a * 0.62 + b * 0.28 + c * 0.1;
}

void main() {
  vec2 p = vWorld.xz * uScale + vec2(uTimeD * 0.0015, uTimeD * 0.0007);
  float d = dens(p);
  float cov = smoothstep(1.0 - uCover, 1.0 - uCover + 0.22, d);
  if (cov < 0.01) discard;
  // pseudo relief from the density gradient -> normal
  float e = 0.004;
  float dx = dens(p + vec2(e, 0.0)) - d;
  float dz = dens(p + vec2(0.0, e)) - d;
  vec3 n = normalize(vec3(-dx * 55.0, 1.0, -dz * 55.0));
  vec3 vd = normalize(vWorld - cameraPosition);
  float ndl = dot(n, uSunDir);
  float wrap = clamp(ndl * 0.7 + 0.3, 0.0, 1.0);
  // self shadowing toward the sun
  vec2 sp = p + normalize(uSunDir.xz + 1e-4) * 0.012;
  float occ = clamp((dens(sp) - d) * 6.0, 0.0, 1.0);
  float mu = dot(vd, uSunDir);
  float g = 0.6;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5) * 0.06;
  float thin = 1.0 - cov;
  vec3 col = mix(uShade, uLit, wrap * (1.0 - occ * 0.75)) * uSunI + uAmbient * (0.6 + 0.4 * n.y);
  col += uSunColor * uSunI * hg * (0.4 + thin * 2.0);
  col = applyWorldFog(col, vWorld);
  float fadeNear = smoothstep(40.0, 260.0, length(vWorld - cameraPosition));
  gl_FragColor = vec4(col * cov * uOpacity * fadeNear, cov * uOpacity * fadeNear);
}`;

/**
 * "Sea of clouds": a huge cloud-top layer following the camera, lit by the
 * low sun with pseudo relief and self-shadowing (texture fbm, one draw call).
 */
export class CloudDeck {
  constructor({ y = 900, cover = 0.72, scale = 0.00022, radius = 30000 } = {}) {
    this.noise = noiseTexture();
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        tNoise: { value: this.noise },
        uTimeD: WorldUniforms.uTime,
        uCover: { value: cover },
        uScale: { value: scale },
        uLit: { value: new Color(1.0, 0.72, 0.55) },
        uShade: { value: new Color(0.32, 0.26, 0.38) },
        uAmbient: { value: new Color(0.25, 0.3, 0.45) },
        uSunI: { value: 3 },
        uOpacity: { value: 1 },
        uSunDir: WorldUniforms.uSunDir,
        uSunColor: WorldUniforms.uSunColor,
        uFogColor: WorldUniforms.uFogColor,
        uFogSunColor: WorldUniforms.uFogSunColor,
        uFogDensity: WorldUniforms.uFogDensity,
        uFogHeightFalloff: WorldUniforms.uFogHeightFalloff,
        uFogBaseHeight: WorldUniforms.uFogBaseHeight,
        uFogMax: WorldUniforms.uFogMax
      }
    });
    this.material.blending = 5; // premultiplied over
    this.material.blendSrc = 201;
    this.material.blendDst = 205;
    const geo = new CircleGeometry(radius, 96);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new Mesh(geo, this.material);
    this.mesh.position.y = y;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'cloudDeck';
    this.y = y;
  }

  setLighting({ lit, shade, ambient, sunI }) {
    const u = this.material.uniforms;
    if (lit) u.uLit.value.copy(lit);
    if (shade) u.uShade.value.copy(shade);
    if (ambient) u.uAmbient.value.copy(ambient);
    if (sunI != null) u.uSunI.value = sunI;
  }

  update(dt, camera) {
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.noise.dispose();
  }
}
