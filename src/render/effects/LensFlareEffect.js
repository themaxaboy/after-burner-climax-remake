import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import {
  BasicDepthPacking, BufferAttribute, BufferGeometry, Color, CustomBlending, DataUtils, HalfFloatType, Mesh,
  OneMinusSrcAlphaFactor, OrthographicCamera, RGBADepthPacking, Scene, ShaderMaterial, SrcAlphaFactor, Uniform,
  Vector2, Vector3, WebGLRenderTarget
} from 'three';

// Cinematic anamorphic lens flare: horizontal streak through the sun, soft
// glare, a halo ring and chromatic ghosts mirrored across the screen centre.
//
// Occlusion: a 1×1 "sun visibility" pass (16 depth taps in a rotating spiral
// over the sun disc) is blended into a persistent texel every frame, i.e. an
// exponential moving average at ~10/s. The flare and the god rays both read
// that texel, so a jet or a missile crossing the sun fades them smoothly
// instead of switching them off for a frame (which read as a dark flicker).
const fragment = /* glsl */ `
uniform vec3 uSun;          // xy = sun uv, z = on-screen factor (0..1)
uniform float uIntensity;
uniform vec3 uTint;
uniform float uStreak;
uniform sampler2D uVisMap;  // 1×1 smoothed sun visibility

float ghost(vec2 uv, vec2 c, float r, float soft) {
  vec2 d = (uv - c) * vec2(aspect, 1.0);
  float l = length(d);
  return smoothstep(r, r * (1.0 - soft), l);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float onScreen = uSun.z;
  if (onScreen <= 0.001 || uIntensity <= 0.0) { outputColor = vec4(0.0); return; }
  float vis = texture2D(uVisMap, vec2(0.5)).r * onScreen;
  if (vis <= 0.001) { outputColor = vec4(0.0); return; }
  vec2 s = uSun.xy;
  vec2 d = (uv - s) * vec2(aspect, 1.0);
  float dist = length(d);

  // anamorphic streak
  float streak = exp(-abs(d.y) * 900.0) * exp(-abs(d.x) * 1.4) * uStreak;
  streak += exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 5.0) * 0.25 * uStreak;
  // glare
  float glare = exp(-dist * 9.0) * 0.35 + exp(-dist * 40.0) * 0.6;
  // halo ring
  float halo = smoothstep(0.34, 0.36, dist) * smoothstep(0.40, 0.36, dist) * 0.025;

  // ghosts along the axis through the centre
  vec2 axis = vec2(0.5) - s;
  vec3 g = vec3(0.0);
  g += vec3(0.30, 0.55, 1.00) * ghost(uv, s + axis * 0.55, 0.035, 0.5) * 0.18;
  g += vec3(1.00, 0.60, 0.25) * ghost(uv, s + axis * 0.85, 0.06, 0.8) * 0.10;
  g += vec3(0.35, 1.00, 0.55) * ghost(uv, s + axis * 1.25, 0.022, 0.4) * 0.16;
  g += vec3(0.80, 0.40, 1.00) * ghost(uv, s + axis * 1.55, 0.09, 0.9) * 0.07;
  g += vec3(1.00, 0.85, 0.50) * ghost(uv, s + axis * 2.05, 0.05, 0.6) * 0.09;
  g += vec3(0.40, 0.70, 1.00) * ghost(uv, s + axis * 1.9, 0.14, 0.95) * 0.05;

  vec3 streakCol = vec3(0.35, 0.6, 1.0);
  vec3 col = streakCol * streak + uTint * (glare + halo) + g * uTint;
  outputColor = vec4(col * uIntensity * vis, 1.0);
}
`;

const visVS = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const visFS = /* glsl */ `
#include <packing>
uniform highp sampler2D tDepth;
uniform vec3 uSun;
uniform vec2 uRadius;
uniform float uRot;
uniform float uK;
float sunDepth(vec2 uv) {
#if DEPTH_PACKING == 3201
  return unpackRGBAToDepth(texture2D(tDepth, uv));
#else
  return texture2D(tDepth, uv).r;
#endif
}
void main() {
  float vis = 0.0;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + uRot;
    vec2 p = uSun.xy + vec2(cos(a), sin(a)) * sqrt((fi + 0.5) / 16.0) * uRadius;
    // off-screen taps can't be tested: count them as visible
    bool inside = p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0;
    vis += inside ? step(0.999999, sunDepth(p)) : 1.0;
  }
  gl_FragColor = vec4(vec3(vis / 16.0), uK);
}`;

export class LensFlareEffect extends Effect {
  constructor() {
    const visTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
    visTarget.texture.name = 'LensFlare.SunVisibility';
    const visUniform = new Uniform(visTarget.texture);
    super('LensFlareEffect', fragment, {
      blendFunction: BlendFunction.ADD,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uSun', new Uniform(new Vector3())],
        ['uIntensity', new Uniform(1)],
        ['uTint', new Uniform(new Color(1, 0.85, 0.65))],
        ['uStreak', new Uniform(1)],
        ['uVisMap', visUniform]
      ])
    });
    this._v = new Vector3();
    /** Shared uniform holding the smoothed sun-visibility texel (also read by the god rays). */
    this.visUniform = visUniform;
    this.visTarget = visTarget;
    this.visRate = 10; // 1/s
    this.maxStep = 0.2; // max blend per frame
    this.visMaterial = new ShaderMaterial({
      name: 'SunVisibility',
      vertexShader: visVS,
      fragmentShader: visFS,
      defines: { DEPTH_PACKING: '0' },
      uniforms: {
        tDepth: { value: null },
        uSun: this.uniforms.get('uSun'),
        uRadius: { value: new Vector2(0.02, 0.02) },
        uRot: { value: 0 },
        uK: { value: 1 }
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: CustomBlending,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: SrcAlphaFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor
    });
    const tri = new BufferGeometry();
    tri.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.visMesh = new Mesh(tri, this.visMaterial);
    this.visMesh.frustumCulled = false;
    this.visScene = new Scene();
    this.visScene.add(this.visMesh);
    this.visCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._reset = true;
    this._frame = 0;
    this._half = new Uint16Array(4);
  }

  setDepthTexture(depthTexture, depthPacking = BasicDepthPacking) {
    this.visMaterial.uniforms.tDepth.value = depthTexture;
    this.visMaterial.defines.DEPTH_PACKING = depthPacking === RGBADepthPacking ? '3201' : '0';
    this.visMaterial.needsUpdate = true;
  }

  /** Forget the visibility history (next frame writes the raw value). */
  resetVisibility() {
    this._reset = true;
  }

  /** Project the sun direction and compute on-screen fade + sampling radius. */
  updateSun(camera, sunDir, intensity = 1, sunRadiusDeg = 1.2) {
    const v = this._v.copy(sunDir).multiplyScalar(10000).add(camera.position).project(camera);
    const u = this.uniforms.get('uSun').value;
    const behind = v.z > 1;
    const sx = v.x * 0.5 + 0.5, sy = v.y * 0.5 + 0.5;
    const margin = 0.15;
    const edge = Math.min(sx + margin, 1 + margin - sx, sy + margin, 1 + margin - sy) / margin;
    u.set(sx, sy, behind ? 0 : Math.max(0, Math.min(1, edge)) * Math.max(0, Math.min(1, sunDir.y * 12 + 0.4)));
    this.uniforms.get('uIntensity').value = intensity;
    // sample over ~1.5× the sun disc so partial occlusion ramps smoothly
    const ry = (Math.tan(((sunRadiusDeg * 1.5) * Math.PI) / 180) / Math.tan(((camera.fov || 60) * Math.PI) / 360)) * 0.5;
    this.visMaterial.uniforms.uRadius.value.set(ry / (camera.aspect || 1), ry);
  }

  /** Runs once per frame before the effect pass (pmndrs Effect hook). */
  update(renderer, inputBuffer, deltaTime) {
    const mu = this.visMaterial.uniforms;
    if (!mu.tDepth.value) return;
    const onScreen = this.uniforms.get('uSun').value.z > 0.001;
    if (!onScreen && !this._reset) return; // keep the last value while the sun is away
    // ~10/s, but never more than 20% of the way per displayed frame (low frame
    // rates would otherwise turn the fade back into a pop)
    mu.uK.value = this._reset ? 1 : Math.min(this.maxStep, 1 - Math.exp(-this.visRate * Math.max(deltaTime || 0, 0)));
    mu.uRot.value = (this._frame++ % 16) * 0.3927;
    this._reset = false;
    const prev = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false; // the target holds the running average
    renderer.setRenderTarget(this.visTarget);
    renderer.render(this.visScene, this.visCamera);
    renderer.setRenderTarget(prev);
    renderer.autoClear = autoClear;
  }

  /** Smoothed sun visibility (GPU readback: debug/probe use only). */
  visibility(renderer) {
    try {
      renderer.readRenderTargetPixels(this.visTarget, 0, 0, 1, 1, this._half);
      return DataUtils.fromHalfFloat(this._half[0]) * this.uniforms.get('uSun').value.z;
    } catch {
      return this.uniforms.get('uSun').value.z;
    }
  }

  dispose() {
    this.visTarget.dispose();
    this.visMaterial.dispose();
    this.visMesh.geometry.dispose();
    super.dispose();
  }
}
