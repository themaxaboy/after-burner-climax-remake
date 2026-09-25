import {
  BackSide, BoxGeometry, Color, CubeCamera, HalfFloatType, LinearFilter, LinearMipmapLinearFilter, Mesh,
  PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, Vector3, WebGLCubeRenderTarget, RGBAFormat
} from 'three';
import { ATMOSPHERE_GLSL, ATMOS_DEFAULTS, atmosphereJS, sunColorJS, sunDirFromAngles } from './atmosphere.js';
import { WorldUniforms } from '../render/worldUniforms.js';

const CUBE_SIZE = 256;

const cubeVS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const cubeFS = /* glsl */ `
varying vec3 vDir;
${ATMOSPHERE_GLSL}
void main() {
  vec3 rd = normalize(vDir);
  vec3 col = atmosphere(rd, uAtmosSunDir);
  gl_FragColor = vec4(col, 1.0);
}`;

// Background dome: cubemap + analytic sun disc + procedural cloud layers + stars.
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
uniform float uTime;
uniform float uCloudCover;
uniform float uCloudDensity;
uniform float uCloudHeight;
uniform vec3 uCloudDrift;
uniform float uCirrus;
uniform float uStars;
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

  // sun disc with limb darkening
  float sunCos = 0.99996;
  if (mu > sunCos - 0.0004) {
    float r = clamp((1.0 - mu) / (1.0 - sunCos), 0.0, 1.0);
    float limb = 1.0 - 0.6 * (1.0 - sqrt(max(1.0 - r * r, 0.0)));
    float disc = smoothstep(1.0, 0.85, r);
    col += uSunColor * disc * limb * uSunDisc * step(-0.02, rd.y);
  }

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
    float shade = clamp(1.0 - (n2 - n) * 3.5, 0.35, 1.35);
    float silver = pow(max(mu, 0.0), 8.0) * 1.6;
    vec3 ambient = textureCube(tSky, normalize(vec3(rd.x, 0.6, rd.z))).rgb;
    vec3 lit = uSunColor * 0.12 * (shade + silver) + ambient * 0.9;
    col = mix(col, lit, clamp(d, 0.0, 1.0));
    // cirrus
    float ci = fbm(vec2(uv.x * 0.35, uv.y * 3.5) + uCloudDrift.xy * uTime * 0.5);
    float cd = smoothstep(0.55, 0.95, ci) * uCirrus * horizon * (1.0 - d);
    col = mix(col, uSunColor * 0.08 * (1.0 + silver) + ambient * 1.1, cd * 0.6);
  }

  // haze blend toward fog colour near horizon so geometry fog meets the sky
  float hz = exp(-max(rd.y + 0.02, 0.0) * 18.0) * uHorizonFog;
  col = mix(col, uFogColor, clamp(hz, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * Sky system: bakes a small HDR cubemap of the atmosphere (on sun change),
 * derives PMREM for IBL, sun colour and fog colours, and draws the dome.
 */
export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.params = { ...ATMOS_DEFAULTS };
    this.sunDir = new Vector3(0, 0.2, -1).normalize();
    this.sunColor = new Color();
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
        uMultiScatter: { value: 0.35 }, uAtmosSunDir: { value: new Vector3() }, uViewHeight: { value: 200 }
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
        uTime: WorldUniforms.uRealTime,
        uCloudCover: { value: 0.35 },
        uCloudDensity: { value: 0.9 },
        uCloudHeight: { value: 1.0 },
        uCloudDrift: { value: new Vector3(0.004, 0.002, 0) },
        uCirrus: { value: 0.5 },
        uStars: { value: 0 },
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
   * @param {object} env  {elev, azim, rayleigh, mie, mieG, turbidity, sunIntensity, exposure,
   *                       cloudCover, cloudDensity, cirrus, stars, fogDensity, fogFalloff, horizonFog}
   */
  configure(env) {
    const p = this.params;
    Object.assign(p, ATMOS_DEFAULTS);
    if (env.rayleigh != null) p.rayleigh = env.rayleigh;
    if (env.mie != null) p.mie = env.mie;
    if (env.mieG != null) p.mieG = env.mieG;
    if (env.ozone != null) p.ozone = env.ozone;
    if (env.sunIntensity != null) p.sunIntensity = env.sunIntensity;
    if (env.multiScatter != null) p.multiScatter = env.multiScatter;
    if (env.groundAlbedo) p.groundAlbedo = env.groundAlbedo;
    sunDirFromAngles(env.elev ?? 10, env.azim ?? 0, this.sunDir);

    const du = this.domeMat.uniforms;
    du.uCloudCover.value = env.cloudCover ?? 0.35;
    du.uCloudDensity.value = env.cloudDensity ?? 0.9;
    du.uCirrus.value = env.cirrus ?? 0.4;
    du.uStars.value = env.stars ?? 0;
    du.uHorizonFog.value = env.horizonFog ?? 0.2;
    du.uCloudHeight.value = env.cloudHeight ?? 1.0;

    WorldUniforms.uFogDensity.value = env.fogDensity ?? 0.00012;
    WorldUniforms.uFogHeightFalloff.value = env.fogFalloff ?? 0.0016;
    WorldUniforms.uFogBaseHeight.value = env.fogBase ?? 0;
    this.bake();
  }

  /** Re-render cubemap + PMREM + derived colours. ~5-15 ms; call on load / sun cues. */
  bake() {
    const r = this.renderer;
    const p = this.params;
    const u = this.cubeMat.uniforms;
    u.uRayleigh.value = p.rayleigh;
    u.uMie.value = p.mie;
    u.uMieG.value = p.mieG;
    u.uOzone.value = p.ozone;
    u.uSunIntensity.value = p.sunIntensity * p.exposure;
    u.uGroundAlbedo.value.set(p.groundAlbedo[0], p.groundAlbedo[1], p.groundAlbedo[2]);
    u.uMultiScatter.value = p.multiScatter;
    u.uAtmosSunDir.value.copy(this.sunDir);

    const prevTarget = r.getRenderTarget();
    this.cubeCam.update(r, this.cubeScene);
    r.setRenderTarget(prevTarget);

    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);

    // Sun colour (transmittance-tinted), used by the directional light & dome disc
    sunColorJS(this.sunDir, p, 200, this.sunColor);
    const sunI = p.sunIntensity * p.exposure;
    WorldUniforms.uSunDir.value.copy(this.sunDir);
    WorldUniforms.uSunColor.value.copy(this.sunColor);
    this.domeMat.uniforms.uSunColor.value.copy(this.sunColor).multiplyScalar(sunI * 60);

    // Fog colours: horizon radiance away from / toward the sun.
    const d = new Vector3();
    const away = new Vector3(-this.sunDir.x, 0, -this.sunDir.z).normalize();
    const toward = new Vector3(this.sunDir.x, 0, this.sunDir.z).normalize();
    const c1 = new Color(), c2 = new Color(), c3 = new Color();
    const side = new Vector3(-toward.z, 0, toward.x);
    // average a few directions around the horizon for the base fog tint
    atmosphereJS(d.copy(away).setY(0.04).normalize(), this.sunDir, p, 200, c1);
    atmosphereJS(d.copy(side).setY(0.04).normalize(), this.sunDir, p, 200, c2);
    atmosphereJS(d.copy(side).negate().setY(0.04).normalize(), this.sunDir, p, 200, c3);
    const fog = c1.add(c2).add(c3).multiplyScalar(1 / 3);
    WorldUniforms.uFogColor.value.copy(fog);
    atmosphereJS(d.copy(toward).setY(0.04).normalize(), this.sunDir, p, 200, c2);
    WorldUniforms.uFogSunColor.value.copy(c2);
    return this.envRT.texture;
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
