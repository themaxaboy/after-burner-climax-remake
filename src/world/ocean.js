import {
  BufferAttribute, BufferGeometry, Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, Mesh,
  MeshPhysicalMaterial, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector4
} from 'three';
import { addShaderHook } from '../render/shaderHooks.js';
import { WorldUniforms, applyWorldFog } from '../render/worldUniforms.js';
import { Rng } from '../core/rng.js';

export const OCEAN_PRESETS = {
  // Calm dawn swell for low-level flying (stage 1)
  goldSwell: {
    color: [0.004, 0.028, 0.045],
    scatter: [0.01, 0.07, 0.08],
    roughness: 0.05,
    amp: 1.0,
    waves: [
      [1.0, 0.25, 0.30, 140],
      [0.8, 0.55, 0.28, 67],
      [0.3, -0.9, 0.24, 38],
      [-0.6, 0.8, 0.22, 21],
      [0.9, -0.2, 0.20, 12],
      [-0.2, 1.0, 0.18, 7.3]
    ],
    detail: 0.28,
    foam: 0.7
  },
  // Choppier, darker sea for dusk
  twilight: {
    color: [0.003, 0.018, 0.035],
    scatter: [0.03, 0.10, 0.12],
    roughness: 0.08,
    amp: 1.3,
    waves: [
      [1.0, 0.1, 0.34, 160],
      [0.7, 0.7, 0.30, 80],
      [0.2, -1.0, 0.26, 41],
      [-0.7, 0.7, 0.24, 23],
      [0.9, -0.4, 0.22, 13],
      [-0.1, 1.0, 0.2, 8]
    ],
    detail: 0.7,
    foam: 1.0
  }
};

/** Tileable ocean detail normal map from integer-frequency sine waves. */
function makeDetailNormalTexture(size = 256, seed = 7) {
  const rng = new Rng(seed);
  const waves = [];
  for (let i = 0; i < 28; i++) {
    const kx = rng.int(-12, 12), ky = rng.int(-12, 12);
    if (kx === 0 && ky === 0) continue;
    const kmag = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: 1 / Math.pow(kmag, 1.2), ph: rng.range(0, Math.PI * 2) });
  }
  const data = new Uint8Array(size * size * 4);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      const u = x / size, v = y / size;
      for (const w of waves) {
        const ph = TAU * (w.kx * u + w.ky * v) + w.ph;
        const c = Math.cos(ph) * w.a;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const s = 0.06;
      let nx = -dx * s, ny = -dy * s, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (y * size + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Concentric polar grid, dense near the centre, reaching `radius`. */
function makePolarGrid(rings, segments, radius, inner = 1.5) {
  const verts = [];
  const idx = [];
  verts.push(0, 0, 0);
  const ringR = [];
  for (let r = 0; r < rings; r++) {
    const t = (r + 1) / rings;
    ringR.push(inner * Math.pow(radius / inner, t));
  }
  // prepend a few linear rings near the centre
  for (let r = 0; r < rings; r++) {
    const R = ringR[r];
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      verts.push(Math.cos(a) * R, 0, Math.sin(a) * R);
    }
  }
  for (let s = 0; s < segments; s++) {
    const a = 1 + s, b = 1 + ((s + 1) % segments);
    idx.push(0, b, a);
  }
  for (let r = 0; r < rings - 1; r++) {
    const base0 = 1 + r * segments, base1 = 1 + (r + 1) * segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      const a = base0 + s, b = base0 + s1, c = base1 + s, d = base1 + s1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new BufferGeometry();
  const pos = new Float32Array(verts);
  g.setAttribute('position', new BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius = radius * 2;
  return g;
}

export class Ocean {
  constructor({ rings = 110, segments = 160, radius = 26000, preset = 'goldSwell' } = {}) {
    this.detailTex = makeDetailNormalTexture();
    this.uniforms = {
      uWaves: { value: Array.from({ length: 6 }, () => new Vector4()) },
      uWaveAmp: { value: 1 },
      uDetailTex: { value: this.detailTex },
      uDetailStrength: { value: 0.5 },
      uScatterColor: { value: new Color() },
      uFoamAmount: { value: 1 },
      uTime: WorldUniforms.uTime,
      uWakes: { value: Array.from({ length: 8 }, () => new Vector4(0, 0, 0, 0)) } // x,z,radius,strength
    };
    const mat = new MeshPhysicalMaterial({
      color: new Color(0.004, 0.03, 0.045),
      roughness: 0.06,
      metalness: 0,
      ior: 1.333,
      specularIntensity: 1,
      envMapIntensity: 1.0
    });
    this.material = mat;
    const U = this.uniforms;
    applyWorldFog(mat); // declares uSunDir/uSunColor used below
    addShaderHook(mat, 'ocean', (shader) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec4 uWaves[6];
          uniform float uWaveAmp;
          uniform float uTime;
          varying vec3 vOceanWP;
          varying float vFoam;
          varying float vCrest;
          `
        )
        .replace(
          '#include <beginnormal_vertex>',
          `
          vec3 gDisp = vec3(0.0);
          vec3 objectNormal;
          {
            vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
            vec2 p = wp0.xz;
            float camDist = length(wp0.xz - cameraPosition.xz);
            float nx = 0.0, nz = 0.0, ny = 0.0, crest = 0.0;
            for (int i = 0; i < 6; i++) {
              vec4 w = uWaves[i];
              float lambda = w.w;
              // fade short waves with distance to avoid aliasing
              float fade = 1.0 - smoothstep(lambda * 20.0, lambda * 70.0, camDist);
              if (fade <= 0.0) continue;
              vec2 D = normalize(w.xy);
              float k = 6.2831853 / lambda;
              float c = sqrt(9.81 / k);
              float Q = w.z;
              float A = (Q / k) * 0.55 * uWaveAmp * fade;
              float f = k * (dot(D, p) - c * uTime);
              float S = sin(f), C = cos(f);
              gDisp.x += Q * A * D.x * C;
              gDisp.z += Q * A * D.y * C;
              gDisp.y += A * S;
              float WA = k * A;
              nx -= D.x * WA * C;
              nz -= D.y * WA * C;
              ny += Q * WA * S;
              crest += S * A;
            }
            objectNormal = normalize(vec3(nx, 1.0 - ny, nz));
            vFoam = clamp(ny * 1.6 - 0.35, 0.0, 1.0);
            vCrest = crest;
          }
          `
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position) + gDisp;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vOceanWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uDetailTex;
          uniform float uDetailStrength;
          uniform vec3 uScatterColor;
          uniform float uFoamAmount;
          uniform float uTime;
          uniform vec4 uWakes[8];
          varying vec3 vOceanWP;
          varying float vFoam;
          varying float vCrest;
          float oceanFoam;
          float oceanDist;
          float oHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
          `
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          oceanDist = length(vOceanWP - cameraPosition);
          {
            float wake = 0.0;
            for (int i = 0; i < 8; i++) {
              vec4 w = uWakes[i];
              if (w.w <= 0.0) continue;
              float d = length(vOceanWP.xz - w.xy);
              wake = max(wake, w.w * (1.0 - smoothstep(w.z * 0.4, w.z, d)));
            }
            vec2 fuv = vOceanWP.xz * 0.08 + vec2(uTime * 0.02, 0.0);
            float fn = texture2D(uDetailTex, fuv).r * 0.6 + texture2D(uDetailTex, fuv * 2.7).g * 0.4;
            float foamMask = smoothstep(0.45, 0.8, fn + vFoam * 0.8) * vFoam;
            oceanFoam = clamp((foamMask * 1.4 + wake * smoothstep(0.35, 0.7, fn)) * uFoamAmount, 0.0, 1.0);
            oceanFoam *= 1.0 - smoothstep(600.0, 2500.0, oceanDist);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.8, 0.82), oceanFoam);
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.55, oceanFoam);
          roughnessFactor = max(roughnessFactor, smoothstep(200.0, 9000.0, oceanDist) * 0.22);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            float fadeD = 1.0 - smoothstep(300.0, 4000.0, oceanDist);
            vec2 uv1 = vOceanWP.xz * 0.021 + vec2(uTime * 0.009, uTime * 0.004);
            vec2 uv2 = vOceanWP.xz * 0.057 + vec2(-uTime * 0.012, uTime * 0.015);
            vec2 uv3 = vOceanWP.xz * 0.0037 + vec2(uTime * 0.002, -uTime * 0.0015);
            vec3 d1 = texture2D(uDetailTex, uv1).xyz * 2.0 - 1.0;
            vec3 d2 = texture2D(uDetailTex, uv2).xyz * 2.0 - 1.0;
            vec3 d3 = texture2D(uDetailTex, uv3).xyz * 2.0 - 1.0;
            vec2 slope = (d1.xy + d2.xy * 0.5) * fadeD + d3.xy * 0.9;
            vec3 dw = vec3(slope.x, 0.0, slope.y) * uDetailStrength;
            normal = normalize(normal + (viewMatrix * vec4(dw, 0.0)).xyz);
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          {
            vec3 vd = normalize(vOceanWP - cameraPosition);
            float towardSun = pow(clamp(dot(vd, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0, 1.0), 3.0);
            float crest = clamp(vCrest * 0.35 + 0.5, 0.0, 1.0);
            float grazing = 1.0 - abs(vd.y);
            totalEmissiveRadiance += uScatterColor * uSunColor * (0.25 + towardSun * 1.5) * crest * crest * grazing * (1.0 - oceanFoam);
          }`
        );
    });
    this.geometry = makePolarGrid(rings, segments, radius, 1.2);
    this.mesh = new Mesh(this.geometry, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'ocean';
    this.mesh.renderOrder = -10;
    this.setPreset(preset);
  }

  setPreset(name) {
    const p = typeof name === 'string' ? OCEAN_PRESETS[name] : name;
    this.preset = p;
    this.material.color.setRGB(p.color[0], p.color[1], p.color[2]);
    this.material.roughness = p.roughness;
    this.uniforms.uScatterColor.value.setRGB(p.scatter[0], p.scatter[1], p.scatter[2]);
    this.uniforms.uWaveAmp.value = p.amp;
    this.uniforms.uDetailStrength.value = p.detail;
    this.uniforms.uFoamAmount.value = p.foam;
    for (let i = 0; i < 6; i++) {
      const w = p.waves[i];
      this.uniforms.uWaves.value[i].set(w[0], w[1], w[2], w[3]);
    }
  }

  /** Height of the ocean surface (approx, ignoring horizontal displacement). */
  heightAt(x, z, t) {
    const p = this.preset;
    let h = 0;
    for (let i = 0; i < 6; i++) {
      const w = p.waves[i];
      const len = Math.hypot(w[0], w[1]);
      const dx = w[0] / len, dz = w[1] / len;
      const k = (Math.PI * 2) / w[3];
      const c = Math.sqrt(9.81 / k);
      const A = (w[2] / k) * 0.55 * p.amp;
      h += A * Math.sin(k * (dx * x + dz * z - c * t));
    }
    return h;
  }

  setWake(i, x, z, radius, strength) {
    this.uniforms.uWakes.value[i].set(x, z, radius, strength);
  }

  update(camera) {
    // snap to 4 m to keep near vertices from swimming
    const snap = 4;
    this.mesh.position.set(Math.round(camera.position.x / snap) * snap, 0, Math.round(camera.position.z / snap) * snap);
  }
}
