import { Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three';
import { addShaderHook } from '../../render/shaderHooks.js';
import { applyWorldFog } from '../../render/worldUniforms.js';

const loader = new TextureLoader();
const cache = new Map();

function tex(path, srgb, aniso) {
  const key = path;
  if (cache.has(key)) return cache.get(key);
  let done;
  const ready = new Promise((r) => (done = r));
  const t = loader.load(path, () => done(), undefined, () => done());
  t.userData.ready = ready;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// Textures shipped in 1k only (see scripts/fetch-textures.mjs) and their mean luma
// (used to turn them into colour-neutral detail so palettes can be vivid).
const ONLY_1K = new Set(['aerial_grass_rock', 'snow_field_aerial', 'aerial_sand']);
const LUMA = { rock: 0.43, gravelly_sand: 0.46, aerial_grass_rock: 0.4, snow_field_aerial: 0.53, aerial_sand: 0.56 };

const c = (hex) => new Color(hex);

/**
 * Terrain palettes (CONTRACTS §6 `palette`). Colours are sRGB hex (converted
 * to linear); textures provide colour-neutral detail on top.
 *   desertRed  red/orange strata cliffs, orange sand (canyon)
 *   emerald    vivid grass on flats/gentle slopes, grey rock cliffs, snow above the snow line
 *   glacier    blue-grey rock, snow on everything flat, ice on the low flats
 *   dunes      bright yellow sand with ripples, golden sandstone on steep rock
 *   volcanic   black basalt with glowing red strata, dark ash flats (shares the canyon shader branch)
 *   moonsand   pale silver sand with ripples for moonlit dunes (shares the dunes shader branch)
 */
export const PALETTES = {
  desertRed: {
    id: 0,
    groundTex: 'gravelly_sand',
    auxTex: 'gravelly_sand',
    groundScale: 6,
    strata: ['#ee8a50', '#c0502a', '#f7bd84', '#963f26'],
    rock: '#c86a3c',
    rock2: '#a8482a',
    ground: '#f4a466',
    ground2: '#e5834a',
    snow: '#ffffff',
    ice: '#ffffff',
    bank: '#b08060'
  },
  emerald: {
    id: 1,
    groundTex: 'aerial_grass_rock',
    auxTex: 'snow_field_aerial',
    groundScale: 22,
    strata: ['#9a9a92', '#8a8c84', '#a8a8a0', '#76786e'],
    rock: '#a3a39b',
    rock2: '#7e8c78',
    ground: '#72c83c',
    ground2: '#2f8030',
    snow: '#f6f9ff',
    ice: '#cfeeff',
    bank: '#c2b294'
  },
  glacier: {
    id: 2,
    groundTex: 'snow_field_aerial',
    auxTex: 'gravelly_sand',
    groundScale: 40,
    strata: ['#8c9aaa', '#7a8898', '#9aa8b8', '#6a7888'],
    rock: '#8f9aa6',
    rock2: '#72876f',
    ground: '#f4f8ff',
    ground2: '#dce8f6',
    snow: '#f4f8ff',
    ice: '#9fe0f2',
    bank: '#98a2a4',
    moss: '#5f8c46'
  },
  dunes: {
    id: 3,
    groundTex: 'aerial_sand',
    auxTex: 'aerial_sand',
    groundScale: 28,
    strata: ['#e8a860', '#d08848', '#f2c080', '#b87040'],
    rock: '#dea060',
    rock2: '#c07c48',
    ground: '#ffc430',
    ground2: '#f08a1e',
    snow: '#ffffff',
    ice: '#ffffff',
    bank: '#e0b060'
  },
  volcanic: {
    id: 0, // strata branch of the canyon shader, dark palette
    groundTex: 'gravelly_sand',
    auxTex: 'gravelly_sand',
    groundScale: 6,
    strata: ['#4a3a36', '#8a2a14', '#2e2624', '#c8481c'],
    rock: '#4c3e3a',
    rock2: '#6a2c1c',
    ground: '#5a4a44',
    ground2: '#3e3230',
    snow: '#ffffff',
    ice: '#ffffff',
    bank: '#4a3a34'
  },
  moonsand: {
    id: 3, // ripples branch of the dunes shader, pale palette
    groundTex: 'aerial_sand',
    auxTex: 'aerial_sand',
    groundScale: 28,
    strata: ['#b8b4ac', '#9c9890', '#cfcac0', '#86827c'],
    rock: '#aaa49a',
    rock2: '#8e887e',
    ground: '#e8e2d4',
    ground2: '#c4bca8',
    snow: '#ffffff',
    ice: '#ffffff',
    bank: '#b8b0a0'
  }
};
const ALIASES = { volcano: 'volcanic', canyon: 'desertRed', red: 'desertRed', snow: 'glacier', ice: 'glacier', valley: 'emerald', desert: 'dunes' };

export function resolvePalette(name) {
  const n = ALIASES[name] || name;
  return PALETTES[n] ? n : 'desertRed';
}

/**
 * Terrain material: triplanar Poly Haven rock on slopes (colour-neutral detail
 * × palette colours; painted strata bands in the red canyon), palette ground
 * on flats (sand / grass / snow / dunes with ripples), snow above the snow
 * line (height above the local floor from the `aRel` attribute), ice and wet
 * banks near the water line, cavity darkening, world-space triplanar normal
 * mapping and macro variation. Works on the streamed chunks and on instanced
 * obstacle meshes (USE_INSTANCING path).
 *
 * @param {{res?: string, anisotropy?: number, palette?: string, snowLine?: number, waterLevel?: number|null}} opts
 */
export function createTerrainMaterial({ res = '1k', anisotropy = 8, palette = 'desertRed', snowLine = 260, waterLevel = null } = {}) {
  const name = resolvePalette(palette);
  const P = PALETTES[name];
  const base = `${import.meta.env?.BASE_URL ?? './'}textures/`;
  const url = (id, map) => `${base}${id}/${ONLY_1K.has(id) ? '1k' : res}/${map}.webp`;
  const rockD = tex(url('rock_face', 'diff'), true, anisotropy);
  const rockN = tex(url('rock_face', 'nor'), false, anisotropy);
  const rock2D = tex(url('worn_rock_natural_01', 'diff'), true, anisotropy);
  const groundD = tex(url(P.groundTex, 'diff'), true, anisotropy);
  const groundN = tex(url(P.groundTex, 'nor'), false, anisotropy);
  const auxD = tex(url(P.auxTex, 'diff'), true, anisotropy);

  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.defines = { ...(mat.defines || {}), TERRAIN_PALETTE: P.id };
  const uniforms = {
    tRockD: { value: rockD },
    tRockN: { value: rockN },
    tRock2D: { value: rock2D },
    tGroundD: { value: groundD },
    tGroundN: { value: groundN },
    tAuxD: { value: auxD },
    uStrataA: { value: c(P.strata[0]) },
    uStrataB: { value: c(P.strata[1]) },
    uStrataC: { value: c(P.strata[2]) },
    uStrataD: { value: c(P.strata[3]) },
    uRockCol: { value: c(P.rock) },
    uRockCol2: { value: c(P.rock2) },
    uGroundCol: { value: c(P.ground) },
    uGroundCol2: { value: c(P.ground2) },
    uSnowCol: { value: c(P.snow) },
    uIceCol: { value: c(P.ice) },
    uBankCol: { value: c(P.bank) },
    uMossCol: { value: c(P.moss || P.ground2) },
    uLumaMean: { value: new Vector3(LUMA.rock, LUMA[P.groundTex] ?? 0.5, LUMA[P.auxTex] ?? 0.5) },
    uGroundScale: { value: P.groundScale },
    uSnowLine: { value: snowLine },
    uWater: { value: waterLevel == null ? -1e5 : waterLevel },
    uNormalStrength: { value: 1.0 }
  };
  applyWorldFog(mat);
  addShaderHook(mat, `terrain-${P.id}`, (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aCavity;
        attribute float aRel;
        varying vec3 vTWorld;
        varying vec3 vTNormal;
        varying float vCavity;
        varying float vRel;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vTWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          {
            mat3 im = mat3(instanceMatrix);
            vec3 tn = objectNormal / vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2]));
            vTNormal = normalize(mat3(modelMatrix) * (im * tn));
            vRel = aRel * length(im[1]);
          }
        #else
          vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTNormal = normalize(mat3(modelMatrix) * objectNormal);
          vRel = aRel;
        #endif
        vCavity = aCavity;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tRockD;
        uniform sampler2D tRockN;
        uniform sampler2D tRock2D;
        uniform sampler2D tGroundD;
        uniform sampler2D tGroundN;
        uniform sampler2D tAuxD;
        uniform vec3 uStrataA;
        uniform vec3 uStrataB;
        uniform vec3 uStrataC;
        uniform vec3 uStrataD;
        uniform vec3 uRockCol;
        uniform vec3 uRockCol2;
        uniform vec3 uGroundCol;
        uniform vec3 uGroundCol2;
        uniform vec3 uSnowCol;
        uniform vec3 uIceCol;
        uniform vec3 uBankCol;
        uniform vec3 uMossCol;
        uniform vec3 uLumaMean;
        uniform float uGroundScale;
        uniform float uSnowLine;
        uniform float uWater;
        uniform float uNormalStrength;
        varying vec3 vTWorld;
        varying vec3 vTNormal;
        varying float vCavity;
        varying float vRel;
        float tRockW;
        float tSnowW;
        float tRough;
        vec3 tBlend;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
        }
        float tLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
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
          float micro = tNoise(vTWorld.xz * 0.035);
          vec3 rA = triSample(tRockD, vTWorld / 13.0, bw);
          vec3 rB = triSample(tRock2D, vTWorld / 37.0, bw);
          float rockL = tLuma(mix(rA, rB, 0.35 + 0.3 * macro)) / uLumaMean.x;
          // large-scale weathering streaks running down the cliffs
          float streak = tNoise(vec2(dot(vTWorld.xz, vec2(0.71, 0.71)) * 0.045, vTWorld.y * 0.011)) * 0.6 + tNoise(vec2(dot(vTWorld.xz, vec2(-0.6, 0.8)) * 0.11, vTWorld.y * 0.03)) * 0.4;
          rockL *= 0.72 + 0.5 * streak;
          vec3 gA = texture2D(tGroundD, vTWorld.xz / uGroundScale).rgb;
          vec3 gB = texture2D(tGroundD, vTWorld.xz / (uGroundScale * 6.3)).rgb;
          float gL = tLuma(mix(gA, gB, 0.4)) / uLumaMean.y;
          float wet = 1.0 - smoothstep(uWater + 0.6, uWater + 3.5, vTWorld.y);
          vec3 albedo;
          tSnowW = 0.0;
          #if TERRAIN_PALETTE == 0
            // red canyon: strata cliffs, orange sand
            tRockW = smoothstep(0.2 - macro * 0.08, 0.42, slope);
            vec3 rock = strataColor(vTWorld.y, vTWorld.xz) * pow(rockL, 1.15);
            vec3 sand = mix(uGroundCol, uGroundCol2, macro) * mix(0.8, 1.1, micro) * pow(gL, 0.9);
            albedo = mix(sand, rock, tRockW);
            albedo = mix(albedo, uBankCol * gL * 0.7, wet);
            tRough = mix(mix(0.95, 0.82, tRockW), 0.45, wet);
          #elif TERRAIN_PALETTE == 1
            // emerald: grass on flats and gentle slopes, grey rock cliffs, snow above the snow line
            tRockW = smoothstep(0.34 - macro * 0.12, 0.6, slope);
            vec3 rock = mix(uRockCol, uRockCol2, smoothstep(0.3, 0.7, macro)) * pow(rockL, 1.25);
            float forest = smoothstep(0.06, 0.24, slope) * (1.0 - smoothstep(uSnowLine * 0.55, uSnowLine * 0.85, vRel));
            vec3 grass = mix(uGroundCol, uGroundCol2, clamp(forest * 0.85 + (macro - 0.5) * 0.7, 0.0, 1.0)) * pow(gL, 1.1);
            albedo = mix(grass, rock, tRockW);
            albedo = mix(albedo, uBankCol * mix(0.6, 1.0, gL), wet * (1.0 - tRockW * 0.5));
            float sn = vRel - uSnowLine + (macro - 0.5) * 110.0 + (micro - 0.5) * 24.0;
            tSnowW = smoothstep(-12.0, 12.0, sn) * smoothstep(0.34, 0.6, wn.y + smoothstep(0.0, 200.0, sn) * 0.3);
            vec3 snow = uSnowCol * (0.84 + 0.16 * tLuma(texture2D(tAuxD, vTWorld.xz / 53.0).rgb) / uLumaMean.z);
            albedo = mix(albedo, snow, tSnowW);
            tRough = mix(mix(mix(0.96, 0.84, tRockW), 0.5, wet), 0.62, tSnowW);
          #elif TERRAIN_PALETTE == 2
            // glacier: blue-grey rock, snow on everything flat, ice sheets on the low flats
            tRockW = smoothstep(0.26 - macro * 0.1, 0.5, slope);
            vec3 rock = mix(uRockCol, uRockCol2, smoothstep(0.35, 0.75, macro)) * pow(rockL, 1.3);
            float sn = vRel - uSnowLine + (macro - 0.5) * 120.0 + (micro - 0.5) * 30.0;
            // mossy / grassy tint on the gentle low slopes, snow patches on ledges, snow caps above the snow line
            float moss = (1.0 - smoothstep(uSnowLine * 0.35, uSnowLine * 0.9, vRel + (macro - 0.5) * 60.0)) * (1.0 - smoothstep(0.2, 0.42, slope));
            rock = mix(rock, uMossCol * (0.8 + 0.4 * gL), moss * 0.8);
            tSnowW = smoothstep(0.7, 0.86, wn.y + smoothstep(-80.0, 90.0, sn) * 0.34 + (micro - 0.5) * 0.2 + (macro - 0.5) * 0.14);
            vec3 snow = mix(uGroundCol2, uGroundCol, micro) * (0.86 + 0.14 * gL);
            float ice = (1.0 - smoothstep(8.0, 34.0, vRel + macro * 26.0)) * smoothstep(0.82, 0.95, wn.y);
            vec3 moraine = uBankCol * tLuma(texture2D(tAuxD, vTWorld.xz / 9.0).rgb) / uLumaMean.z;
            albedo = mix(rock, snow, tSnowW);
            albedo = mix(albedo, uIceCol * (0.9 + 0.2 * micro), ice);
            // blue glacial ice in the low cliffs
            albedo = mix(albedo, uIceCol * 0.75 * pow(rockL, 0.6), tRockW * (1.0 - smoothstep(10.0, 70.0, vRel)) * 0.55);
            albedo = mix(albedo, moraine, wet * (1.0 - ice));
            tSnowW = max(tSnowW, ice);
            tRough = mix(mix(mix(0.88, 0.62, tSnowW), 0.28, ice), 0.45, wet);
          #else
            // dunes: bright yellow sand, orange slip faces, golden sandstone
            tRockW = smoothstep(0.6, 0.78, slope);
            vec3 rock = mix(uRockCol, uRockCol2, macro) * pow(rockL, 1.2);
            vec3 sand = mix(uGroundCol, uGroundCol2, clamp(smoothstep(0.1, 0.4, slope) * 0.85 + (macro - 0.5) * 0.5, 0.0, 1.0));
            sand *= 0.88 + 0.16 * gL + 0.06 * micro;
            albedo = mix(sand, rock, tRockW);
            tRough = mix(0.93, 0.85, tRockW);
          #endif
          albedo *= 1.0 - clamp(vCavity, 0.0, 1.0) * 0.55;
          albedo *= 1.0 + clamp(-vCavity, 0.0, 1.0) * 0.15;
          diffuseColor.rgb *= albedo;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = tRough;`
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
          vec3 ts = texture2D(tGroundN, vTWorld.xz / uGroundScale).xyz * 2.0 - 1.0;
          vec3 nGround = vec3(ts.x * 0.8 + wn.x, wn.y, ts.y * 0.8 + wn.z);
          #if TERRAIN_PALETTE == 3
          {
            // wind ripples, faded with distance to avoid shimmering
            vec2 rp = vTWorld.xz;
            float fade = 1.0 - smoothstep(40.0, 220.0, distance(cameraPosition, vTWorld));
            float ph = dot(rp, vec2(0.83, 0.56)) * 1.9 + tNoise(rp * 0.045) * 6.0 + tNoise(rp * 0.2) * 1.2;
            float amt = 0.22 * fade * smoothstep(0.25, 0.65, tNoise(rp * 0.012));
            nGround.xz += vec2(0.83, 0.56) * cos(ph) * amt;
          }
          #endif
          vec3 nW = normalize(mix(normalize(nGround), nRock, tRockW));
          nW = normalize(mix(nW, normalize(wn + (nW - wn) * 0.35), tSnowW));
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }`
      );
  });
  mat.userData.terrainUniforms = uniforms;
  mat.userData.palette = name;
  mat.userData.ready = Promise.all([rockD, rockN, rock2D, groundD, groundN, auxD].map((t) => t.userData.ready));
  return mat;
}

export { Vector3 };
