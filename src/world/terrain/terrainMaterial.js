import { Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { addShaderHook } from '../../render/shaderHooks.js';
import { applyWorldFog } from '../../render/worldUniforms.js';

const loader = new TextureLoader();
const cache = new Map();

function tex(path, srgb, aniso) {
  const key = path;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(path);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/**
 * Desert canyon material: triplanar Poly Haven rock on slopes with painted
 * strata bands, gravelly sand on flats, cavity darkening, world-space
 * triplanar normal mapping (whiteout blend) and macro colour variation.
 */
export function createTerrainMaterial({ res = '1k', anisotropy = 8, palette = 'canyon' } = {}) {
  const base = `${import.meta.env?.BASE_URL ?? './'}textures/`;
  const rockD = tex(`${base}rock_face/${res}/diff.webp`, true, anisotropy);
  const rockN = tex(`${base}rock_face/${res}/nor.webp`, false, anisotropy);
  const rock2D = tex(`${base}worn_rock_natural_01/${res}/diff.webp`, true, anisotropy);
  const sandD = tex(`${base}gravelly_sand/${res}/diff.webp`, true, anisotropy);
  const sandN = tex(`${base}gravelly_sand/${res}/nor.webp`, false, anisotropy);

  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  const uniforms = {
    tRockD: { value: rockD },
    tRockN: { value: rockN },
    tRock2D: { value: rock2D },
    tSandD: { value: sandD },
    tSandN: { value: sandN },
    uStrataA: { value: new Color(0.95, 0.62, 0.42) },
    uStrataB: { value: new Color(0.78, 0.36, 0.2) },
    uStrataC: { value: new Color(0.98, 0.85, 0.66) },
    uStrataD: { value: new Color(0.55, 0.3, 0.22) },
    uSandTint: { value: new Color(1.05, 0.82, 0.62) },
    uNormalStrength: { value: 1.0 }
  };
  if (palette === 'snow') {
    uniforms.uSandTint.value.set(1.4, 1.45, 1.5);
  }
  applyWorldFog(mat);
  addShaderHook(mat, 'terrain', (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aCavity;
        varying vec3 vTWorld;
        varying vec3 vTNormal;
        varying float vCavity;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTNormal = normalize(mat3(modelMatrix) * objectNormal);
        vCavity = aCavity;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tRockD;
        uniform sampler2D tRockN;
        uniform sampler2D tRock2D;
        uniform sampler2D tSandD;
        uniform sampler2D tSandN;
        uniform vec3 uStrataA;
        uniform vec3 uStrataB;
        uniform vec3 uStrataC;
        uniform vec3 uStrataD;
        uniform vec3 uSandTint;
        uniform float uNormalStrength;
        varying vec3 vTWorld;
        varying vec3 vTNormal;
        varying float vCavity;
        float tRockW;
        vec3 tBlend;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
        }
        vec3 triSample(sampler2D t, vec3 p, vec3 w) {
          return texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
        }
        vec3 strataColor(float h, vec2 xz) {
          float warp = tNoise(xz * 0.0015) * 22.0 + tNoise(xz * 0.009) * 5.0;
          float b = fract((h + warp) * 0.021);
          float b2 = fract((h + warp * 1.7) * 0.063);
          vec3 c = mix(uStrataA, uStrataB, smoothstep(0.15, 0.35, b));
          c = mix(c, uStrataC, smoothstep(0.55, 0.62, b) * (1.0 - smoothstep(0.7, 0.8, b)));
          c = mix(c, uStrataD, smoothstep(0.85, 0.95, b) * 0.8);
          c *= 0.9 + 0.2 * smoothstep(0.4, 0.6, b2);
          return c;
        }`
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 wn = normalize(vTNormal);
          vec3 bw = pow(abs(wn), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          tBlend = bw;
          float slope = 1.0 - wn.y;
          float macro = tNoise(vTWorld.xz * 0.0009) * 0.6 + tNoise(vTWorld.xz * 0.004) * 0.4;
          tRockW = smoothstep(0.2 - macro * 0.08, 0.42, slope);
          vec3 rockA = triSample(tRockD, vTWorld / 13.0, bw);
          vec3 rockB = triSample(tRock2D, vTWorld / 37.0, bw);
          vec3 rock = mix(rockA, rockB, 0.35 + 0.3 * macro) * strataColor(vTWorld.y, vTWorld.xz) * 1.55;
          vec3 sand = texture2D(tSandD, vTWorld.xz / 6.0).rgb * mix(0.85, 1.1, macro);
          sand = mix(sand, texture2D(tSandD, vTWorld.xz / 41.0).rgb, 0.35) * uSandTint;
          vec3 albedo = mix(sand, rock, tRockW);
          albedo *= 1.0 - clamp(vCavity, 0.0, 1.0) * 0.55;
          albedo *= 1.0 + clamp(-vCavity, 0.0, 1.0) * 0.15;
          diffuseColor.rgb *= albedo;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.95, 0.82, tRockW);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 wn = normalize(vTNormal);
          vec3 bw = tBlend;
          vec3 p = vTWorld / 13.0;
          vec3 tnX = texture2D(tRockN, p.zy).xyz * 2.0 - 1.0;
          vec3 tnY = texture2D(tRockN, p.xz).xyz * 2.0 - 1.0;
          vec3 tnZ = texture2D(tRockN, p.xy).xyz * 2.0 - 1.0;
          tnX = vec3(tnX.xy * uNormalStrength + wn.zy, abs(tnX.z) * wn.x);
          tnY = vec3(tnY.xy * uNormalStrength + wn.xz, abs(tnY.z) * wn.y);
          tnZ = vec3(tnZ.xy * uNormalStrength + wn.xy, abs(tnZ.z) * wn.z);
          vec3 nRock = normalize(tnX.zyx * bw.x + tnY.xzy * bw.y + tnZ.xyz * bw.z);
          vec3 ts = texture2D(tSandN, vTWorld.xz / 6.0).xyz * 2.0 - 1.0;
          vec3 nSand = normalize(vec3(ts.x * 0.8 + wn.x, wn.y, ts.y * 0.8 + wn.z));
          vec3 nW = normalize(mix(nSand, nRock, tRockW));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`
      );
  });
  mat.userData.terrainUniforms = uniforms;
  return mat;
}

export { Vector3 };
