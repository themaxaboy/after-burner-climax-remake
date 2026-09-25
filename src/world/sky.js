import {
  BackSide, BoxGeometry, Color, CubeCamera, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Mesh,
  PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, Vector3, Vector4, WebGLCubeRenderTarget, RGBAFormat
} from 'three';
import {
  ATMOSPHERE_GLSL, ATMOS_DEFAULTS, SKY_STYLE_DEFAULTS, SKY_STYLE_GLSL, atmosphereJS, skyZenithHue, stylizeSkyJS,
  sunColorJS, sunDirFromAngles
} from './atmosphere.js';
import { WorldUniforms } from '../render/worldUniforms.js';

const CUBE_SIZE = 256;

const cubeVS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The stylisation is baked into the cubemap, so the dome, the IBL (PMREM) and
// every reflection share the same vivid sky.
const cubeFS = /* glsl */ `
varying vec3 vDir;
${ATMOSPHERE_GLSL}
${SKY_STYLE_GLSL}
void main() {
  vec3 rd = normalize(vDir);
  vec3 col = stylizeSky(atmosphere(rd, uAtmosSunDir), rd, uAtmosSunDir);
  gl_FragColor = vec4(col, 1.0);
}`;

// Background dome: cubemap + analytic sun disc and glow + procedural cloud
// layers + stars + (night) aurora band.
const domeVS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = (modelMatrix * vec4(position, 0.0)).xyz;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // at far plane
}`;

const domeFS = /* glsl */ `
varying vec3 vDir;
uniform samplerCube tSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunDisc;
uniform float uSunCos;       // cos(disc angular radius)
uniform vec3 uSunGlow;       // glow colour * strength
uniform vec3 uCloudSun;      // sun light on the dome cloud layer
uniform float uTime;
uniform float uCloudCover;
uniform float uCloudDensity;
uniform float uCloudHeight;
uniform vec3 uCloudDrift;
uniform float uCirrus;
uniform float uStars;
uniform float uAurora;
uniform vec3 uFogColor;
uniform float uHorizonFog;
uniform float uCamHeight;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 col = textureCube(tSky, rd).rgb;
  float mu = dot(rd, uSunDir);

  // stars (dusk / night)
  if (uStars > 0.0 && rd.y > 0.0) {
    vec3 c = floor(rd * 420.0);
    vec3 h = hash33(c);
    float star = step(0.9965, h.x) * pow(h.y, 6.0) * 6.0;
    col += vec3(star) * uStars * smoothstep(0.0, 0.2, rd.y);
  }

  // aurora: slow green/teal curtains with a violet fringe (night looks)
  if (uAurora > 0.0 && rd.y > 0.02) {
    float az = atan(rd.x, -rd.z);
    float t = uTime * 0.025;
    float fold = fbm(vec2(az * 2.2 + t, t * 0.6)) * 2.4;
    float bandY = 0.2 + 0.08 * sin(az * 1.3 + fold);
    float band = exp(-pow((rd.y - bandY) / 0.085, 2.0)) * smoothstep(0.25, 0.75, fbm(vec2(az * 3.0 - t, 1.7)));
    float rays = fbm(vec2(az * 26.0 + fold * 3.0, t * 2.0));
    float curtain = band * smoothstep(0.35, 0.9, rays) * smoothstep(0.02, 0.12, rd.y);
    vec3 green = vec3(0.12, 1.0, 0.55);
    vec3 violet = vec3(0.55, 0.2, 1.0);
    float top = smoothstep(bandY, bandY + 0.15, rd.y);
    col += mix(green, violet, top) * curtain * uAurora * 0.9;
  }

  // sun disc (hot, larger than life) with limb darkening, plus a glow halo
  float cosR = uSunCos;
  if (mu > cosR - 0.0006) {
    float r = clamp((1.0 - mu) / (1.0 - cosR), 0.0, 1.0);
    float limb = 1.0 - 0.35 * (1.0 - sqrt(max(1.0 - r * r, 0.0)));
    float disc = smoothstep(1.0, 0.8, r);
    col += uSunColor * disc * limb * uSunDisc * step(-0.02, rd.y);
  }
  float theta = sqrt(max(2.0 * (1.0 - mu), 0.0));
  col += uSunGlow * (exp(-theta * 60.0) * 1.0 + exp(-theta * 14.0) * 0.1) * step(-0.05, rd.y);

  // cloud layers (projected onto a plane)
  if (rd.y > 0.0) {
    float horizon = smoothstep(0.0, 0.12, rd.y);
    vec2 uv = rd.xz / (rd.y + 0.035) * (1.0 / max(uCloudHeight, 0.1));
    vec2 w = uv * 1.3 + uCloudDrift.xy * uTime;
    // cumulus / altocumulus
    float n = fbm(w * 1.2 + fbm(w * 0.6) * 0.8);
    float cov = uCloudCover;
    float d = smoothstep(1.0 - cov, 1.0 - cov + 0.35, n) * uCloudDensity * horizon;
    // cheap lighting: sample density toward the sun
    vec2 sunOff = normalize(uSunDir.xz + 1e-4) * 0.08;
    float n2 = fbm((w + sunOff) * 1.2 + fbm((w + sunOff) * 0.6) * 0.8);
    float shade = clamp(1.0 - (n2 - n) * 3.5, 0.45, 1.3);
    float silver = pow(max(mu, 0.0), 8.0) * 1.6;
    vec3 ambient = textureCube(tSky, normalize(vec3(rd.x, 0.6, rd.z))).rgb;
    // bright white tops, soft blue-lifted undersides (never grey)
    vec3 lit = uCloudSun * (shade + silver) + ambient * 0.9;
    col = mix(col, lit, clamp(d, 0.0, 1.0));
    // cirrus
    float ci = fbm(vec2(uv.x * 0.35, uv.y * 3.5) + uCloudDrift.xy * uTime * 0.5);
    float cd = smoothstep(0.55, 0.95, ci) * uCirrus * horizon * (1.0 - d);
    col = mix(col, uCloudSun * 0.8 * (1.0 + silver) + ambient * 1.1, cd * 0.55);
  }

  // haze blend toward fog colour near horizon so geometry fog meets the sky
  float hz = exp(-max(rd.y + 0.02, 0.0) * 18.0) * uHorizonFog;
  col = mix(col, uFogColor, clamp(hz, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const _d = new Vector3();
const _away = new Vector3();
const _toward = new Vector3();
const _side = new Vector3();
const _c1 = new Color(), _c2 = new Color(), _c3 = new Color();

/**
 * Sky system: bakes a small HDR cubemap of the (stylised) atmosphere on sun
 * change, derives PMREM for IBL, sun colour and fog colours, and draws the dome.
 */
export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.params = { ...ATMOS_DEFAULTS };
    this.style = { ...SKY_STYLE_DEFAULTS };
    this.zenithHue = [1, 1, 1];
    this.sunDir = new Vector3(0, 0.2, -1).normalize();
    this.sunColor = new Color();
    this.sunTint = new Color(1, 1, 1);
    this.cubeRT = new WebGLCubeRenderTarget(CUBE_SIZE, {
      type: HalfFloatType,
      format: RGBAFormat,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter
    });
    this.cubeCam = new CubeCamera(0.1, 10, this.cubeRT);
    this.cubeScene = new Scene();
    this.cubeMat = new ShaderMaterial({
      vertexShader: cubeVS,
      fragmentShader: cubeFS,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uRayleigh: { value: 1 }, uMie: { value: 1 }, uMieG: { value: 0.8 }, uOzone: { value: 1 },
        uSunIntensity: { value: 22 }, uGroundAlbedo: { value: new Vector3(0.03, 0.06, 0.09) },
        uMultiScatter: { value: 0.35 }, uAtmosSunDir: { value: new Vector3() }, uViewHeight: { value: 200 },
        uSkyA: { value: new Vector4() }, uSkyB: { value: new Vector4() }, uSkyLock: { value: 0 }
      }
    });
    this.cubeScene.add(new Mesh(new BoxGeometry(2, 2, 2), this.cubeMat));

    this.domeMat = new ShaderMaterial({
      vertexShader: domeVS,
      fragmentShader: domeFS,
      side: BackSide,
      depthWrite: false,
      uniforms: {
        tSky: { value: this.cubeRT.texture },
        uSunDir: WorldUniforms.uSunDir,
        uSunColor: { value: new Color() },
        uSunDisc: { value: 1 },
        uSunCos: { value: Math.cos((1.6 * Math.PI) / 180) },
        uSunGlow: { value: new Color() },
        uCloudSun: { value: new Color() },
        uTime: WorldUniforms.uRealTime,
        uCloudCover: { value: 0.35 },
        uCloudDensity: { value: 0.9 },
        uCloudHeight: { value: 1.0 },
        uCloudDrift: { value: new Vector3(0.004, 0.002, 0) },
        uCirrus: { value: 0.5 },
        uStars: { value: 0 },
        uAurora: { value: 0 },
        uFogColor: WorldUniforms.uFogColor,
        uHorizonFog: { value: 0.25 },
        uCamHeight: { value: 100 }
      }
    });
    this.dome = new Mesh(new SphereGeometry(1, 32, 16), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.scale.setScalar(1000);
    this.dome.name = 'skyDome';

    this.pmrem = new PMREMGenerator(renderer);
    this.envRT = null;
  }

  /**
   * @param {object} env  {elev, azim, rayleigh, mie, mieG, ozone, sunIntensity, exposure, cloudCover,
   *                       cloudDensity, cirrus, stars, aurora, fogDensity, fogFalloff, horizonFog,
   *                       sky: {zenithBoost, saturation, horizonBright, horizonHue, knee, sunDisc, sunGlow},
   *                       sunTint: [r, g, b]}
   */
  configure(env) {
    const p = this.params;
    Object.assign(p, ATMOS_DEFAULTS);
    if (env.rayleigh != null) p.rayleigh = env.rayleigh;
    if (env.mie != null) p.mie = env.mie;
    if (env.mieG != null) p.mieG = env.mieG;
    if (env.ozone != null) p.ozone = env.ozone;
    if (env.sunIntensity != null) p.sunIntensity = env.sunIntensity;
    if (env.exposure != null) p.exposure = env.exposure;
    if (env.multiScatter != null) p.multiScatter = env.multiScatter;
    if (env.groundAlbedo) p.groundAlbedo = env.groundAlbedo;
    this.style = { ...SKY_STYLE_DEFAULTS, ...(env.sky || {}) };
    if (env.sunTint) this.sunTint.fromArray(env.sunTint);
    else this.sunTint.setRGB(1, 1, 1);
    sunDirFromAngles(env.elev ?? 10, env.azim ?? 0, this.sunDir);

    const du = this.domeMat.uniforms;
    du.uCloudCover.value = env.cloudCover ?? 0.35;
    du.uCloudDensity.value = env.cloudDensity ?? 0.9;
    du.uCirrus.value = env.cirrus ?? 0.4;
    du.uStars.value = env.stars ?? 0;
    du.uAurora.value = env.aurora ?? 0;
    du.uHorizonFog.value = env.horizonFog ?? 0.2;
    du.uCloudHeight.value = env.cloudHeight ?? 1.0;
    du.uSunCos.value = Math.cos((this.style.sunDisc * Math.PI) / 180);

    WorldUniforms.uFogDensity.value = env.fogDensity ?? 0.00012;
    WorldUniforms.uFogHeightFalloff.value = env.fogFalloff ?? 0.0016;
    WorldUniforms.uFogBaseHeight.value = env.fogBase ?? 0;
    this.bake();
  }

  /** Re-render cubemap + PMREM + derived colours. ~5-15 ms; call on load / sun cues. */
  bake() {
    const r = this.renderer;
    const p = this.params;
    const st = this.style;
    const u = this.cubeMat.uniforms;
    u.uRayleigh.value = p.rayleigh;
    u.uMie.value = p.mie;
    u.uMieG.value = p.mieG;
    u.uOzone.value = p.ozone;
    u.uSunIntensity.value = p.sunIntensity * p.exposure;
    u.uGroundAlbedo.value.set(p.groundAlbedo[0], p.groundAlbedo[1], p.groundAlbedo[2]);
    u.uMultiScatter.value = p.multiScatter;
    u.uAtmosSunDir.value.copy(this.sunDir);
    // stylisation: the horizon takes the (physical) zenith hue
    skyZenithHue(atmosphereJS(_d.set(0, 1, 0), this.sunDir, p, 200, _c1), this.zenithHue, st.hue);
    u.uSkyB.value.set(this.zenithHue[0], this.zenithHue[1], this.zenithHue[2], st.horizonHue);
    u.uSkyLock.value = st.skyHue;
    const prevTarget = r.getRenderTarget();

    // 1) IBL: a softer version of the stylised sky (same hue, less chroma and
    //    zenith gain) so white paint, snow and rock are lit by a blue sky
    //    without turning blue themselves
    const iblSat = st.iblSaturation ?? 1 + (st.saturation - 1) * 0.4;
    u.uSkyA.value.set(st.zenithBoost * 0.5, iblSat, st.horizonBright, st.knee);
    this.cubeCam.update(r, this.cubeScene);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);

    // 2) the dome gets the full stylisation
    u.uSkyA.value.set(st.zenithBoost, st.saturation, st.horizonBright, st.knee);
    this.cubeCam.update(r, this.cubeScene);
    r.setRenderTarget(prevTarget);

    // Sun colour (transmittance-tinted), used by the directional light & dome disc
    sunColorJS(this.sunDir, p, 200, this.sunColor);
    this.sunColor.multiply(this.sunTint);
    const sunI = p.sunIntensity * p.exposure;
    WorldUniforms.uSunDir.value.copy(this.sunDir);
    WorldUniforms.uSunColor.value.copy(this.sunColor);
    const du = this.domeMat.uniforms;
    du.uSunColor.value.copy(this.sunColor).multiplyScalar(sunI * 60);
    // glow: whiter than the disc so the sun reads as a hot white blob
    const sm = Math.max(this.sunColor.r, this.sunColor.g, this.sunColor.b, 1e-4);
    du.uSunGlow.value.copy(this.sunColor).multiplyScalar(1 / sm).lerp(_c1.setRGB(1, 0.9, 0.62), 0.6).multiplyScalar(sunI * 0.1 * st.sunGlow * Math.min(1, sm * 1.5));
    du.uCloudSun.value.copy(this.sunColor).multiplyScalar(sunI * 0.075);

    // Fog colours: stylised horizon radiance away from / toward the sun.
    const away = _away.set(-this.sunDir.x, 0, -this.sunDir.z).normalize();
    const toward = _toward.set(this.sunDir.x, 0, this.sunDir.z).normalize();
    const side = _side.set(-toward.z, 0, toward.x);
    // average a few directions around the horizon for the base fog tint
    this.radiance(_d.copy(away).setY(0.04).normalize(), _c1);
    this.radiance(_d.copy(side).setY(0.04).normalize(), _c2);
    this.radiance(_d.copy(side).negate().setY(0.04).normalize(), _c3);
    const fog = _c1.add(_c2).add(_c3).multiplyScalar(1 / 3);
    WorldUniforms.uFogColor.value.copy(fog);
    this.radiance(_d.copy(toward).setY(0.04).normalize(), _c2);
    WorldUniforms.uFogSunColor.value.copy(_c2);
    return this.envRT.texture;
  }

  /** Sky radiance along a direction (linear, stylised like the dome). */
  radiance(dir, out = new Color()) {
    atmosphereJS(dir, this.sunDir, this.params, 200, out);
    return stylizeSkyJS(out, dir, this.sunDir, this.style, this.zenithHue);
  }

  /** Unstylised physical radiance (reference / tests). */
  physicalRadiance(dir, out = new Color()) {
    return atmosphereJS(dir, this.sunDir, this.params, 200, out);
  }

  get envMap() {
    return this.envRT ? this.envRT.texture : null;
  }

  /** Light intensity for the directional sun light in scene units. */
  sunLightIntensity() {
    return this.params.sunIntensity * this.params.exposure * 0.16;
  }

  update(camera) {
    this.dome.position.copy(camera.position);
    const far = camera.far * 0.9;
    this.dome.scale.setScalar(far);
    this.domeMat.uniforms.uCamHeight.value = camera.position.y;
  }

  dispose() {
    this.cubeRT.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}
