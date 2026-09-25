import {
  BloomEffect, BlendFunction, EffectComposer, EffectPass, FXAAEffect, GodRaysEffect, KernelSize,
  NoiseEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode
} from 'postprocessing';
import { HalfFloatType, Mesh, MeshBasicMaterial, SphereGeometry, Color } from 'three';
import { CameraFXEffect } from './effects/CameraFXEffect.js';
import { LensFlareEffect } from './effects/LensFlareEffect.js';
import { GForceEffect } from './effects/GForceEffect.js';
import { GradeEffect } from './effects/GradeEffect.js';
import { SafeColorEffect, guardLuminanceMaterial } from './effects/SafeColorEffect.js';

/** Default post look (used when an env doesn't specify one). */
// Bloom only catches genuinely hot pixels (sun, explosions, afterburners):
// sunlit clouds and skies sit around 1–3 in linear HDR, so a low threshold
// turned a bright cloud sea into a milky full-screen haze. The wide smoothing
// ramp avoids a visible edge where the sky around the sun crosses the threshold.
export const LOOK_DEFAULTS = { toneExposure: 1.0, grade: 'neutral', bloom: { threshold: 3.0, smoothing: 2.5, intensity: 0.85 }, flare: 1, sunDisc: 1.6 };

// God rays read the flare's smoothed sun-visibility texel so they fade (not pop)
// when something crosses the sun.
const GOD_RAYS_FRAG = /* glsl */ `
#ifdef FRAMEBUFFER_PRECISION_HIGH
uniform mediump sampler2D map;
#else
uniform lowp sampler2D map;
#endif
uniform sampler2D uGodVis;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = texture2D(map, uv) * texture2D(uGodVis, vec2(0.5)).r;
}`;

/**
 * Post-processing chain (pmndrs). Only one CONVOLUTION effect is allowed per
 * EffectPass, so the chain is:
 *   RenderPass (MSAA on high/ultra)
 *   [N8AO]                                   ultra
 *   EffectPass A: CameraFX (motion blur, radial blur, CA, heat haze; sanitises NaN)   medium+
 *   EffectPass B: [SafeColor on low] + GodRays? + Bloom + LensFlare + ToneMapping(Neutral) + Grade + GForce + Noise
 *   EffectPass C: SMAA | FXAA
 * Neutral tone mapping keeps hue and saturation (AgX desaturated the bright
 * arcade skies toward grey); the grade adds saturation/vibrance per stage.
 */
export class PostFX {
  constructor(renderer, scene, camera, preset) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.preset = preset;
    this.sunMesh = new Mesh(
      new SphereGeometry(1, 16, 8),
      new MeshBasicMaterial({ color: new Color(1.0, 0.85, 0.6), fog: false, depthWrite: false })
    );
    this.sunMesh.frustumCulled = false;
    this.sunMesh.scale.setScalar(260);
    this.sunMesh.name = 'godRaySun';
    this.aoPass = null;
    this.look = { ...LOOK_DEFAULTS };
    this.toneMode = ToneMappingMode.NEUTRAL;
    this.build(preset);
  }

  async _maybeAO() {
    return null;
  }

  build(preset) {
    // carry the current look (grade, bloom, screen effects) over a rebuild
    const carry = this.gforce
      ? {
          grade: this.grade._last,
          threshold: this.bloom.luminanceMaterial.threshold,
          smoothing: this.bloom.luminanceMaterial.smoothing,
          intensity: this.bloom.intensity,
          gforce: [...this.gforce.uniforms].map(([k, u]) => [k, u.value && u.value.clone ? u.value.clone() : u.value]),
          flareTint: this.flare.uniforms.get('uTint').value.clone()
        }
      : null;
    this.dispose();
    this.preset = preset;
    const { renderer, scene, camera } = this;
    const composer = new EffectComposer(renderer, {
      frameBufferType: HalfFloatType,
      multisampling: preset.msaa || 0
    });
    this.composer = composer;
    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);

    if (preset.ao && this.N8AOPostPass) {
      const ao = new this.N8AOPostPass(scene, camera, 1, 1);
      ao.configuration.aoRadius = 6;
      ao.configuration.distanceFalloff = 2;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = true;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode('Medium');
      this.aoPass = ao;
      composer.addPass(ao);
    }

    this.cameraFX = new CameraFXEffect();
    this.cameraFX.motionEnabled = !!preset.motionBlur;
    if (preset.name !== 'low') {
      this.passA = new EffectPass(camera, this.cameraFX);
      composer.addPass(this.passA);
    } else {
      this.passA = null;
    }

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: LOOK_DEFAULTS.bloom.threshold,
      luminanceSmoothing: LOOK_DEFAULTS.bloom.smoothing,
      intensity: LOOK_DEFAULTS.bloom.intensity,
      radius: 0.72,
      levels: preset.bloomHalfRes ? 6 : 8
    });
    if (preset.bloomHalfRes) this.bloom.resolution.scale = 0.5;
    guardLuminanceMaterial(this.bloom.luminanceMaterial);
    this.flare = new LensFlareEffect();
    this.tone = new ToneMappingEffect({ mode: this.toneMode });
    this.grade = new GradeEffect();
    this.gforce = new GForceEffect();
    this.noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.ADD });
    this.noise.blendMode.opacity.value = 0.12;

    const effects = [];
    // pass A sanitises the colour on medium+; on low the guard runs here instead
    if (!this.passA) effects.push(new SafeColorEffect());
    if (preset.godRays) {
      this.godRays = new GodRaysEffect(camera, this.sunMesh, {
        density: 0.92,
        decay: 0.93,
        weight: 0.35,
        exposure: 0.45,
        samples: 48,
        clampMax: 1,
        kernelSize: KernelSize.SMALL,
        blur: true,
        resolutionScale: 0.5
      });
      this.godRays.fragmentShader = GOD_RAYS_FRAG;
      this.godRays.uniforms.set('uGodVis', this.flare.visUniform);
      this.godRays.blendMode.opacity.value = 0.55;
      effects.push(this.godRays);
    } else this.godRays = null;
    effects.push(this.bloom, this.flare, this.tone, this.grade, this.gforce, this.noise);
    this.passB = new EffectPass(camera, ...effects);
    composer.addPass(this.passB);

    if (preset.aa === 'smaa' || preset.aa === 'msaa+smaa') {
      this.aa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    } else if (preset.aa === 'fxaa') {
      this.aa = new FXAAEffect();
    } else this.aa = null;
    if (this.aa) {
      this.passC = new EffectPass(camera, this.aa);
      composer.addPass(this.passC);
    } else this.passC = null;
    this.passes = [this.renderPass, this.passA, this.passB, this.passC].filter(Boolean);
    if (carry) {
      if (carry.grade) this.grade.setGrade(carry.grade);
      this.bloom.luminanceMaterial.threshold = carry.threshold;
      this.bloom.luminanceMaterial.smoothing = carry.smoothing;
      this.bloom.intensity = carry.intensity;
      for (const [k, v] of carry.gforce) {
        const u = this.gforce.uniforms.get(k);
        if (u) u.value = v;
      }
      this.flare.uniforms.get('uTint').value.copy(carry.flareTint);
    }
    return composer;
  }

  /**
   * Apply a stage/look env to the post chain: exposure (renderer), grade,
   * bloom, flare strength and tint. Persists across build() via carry.
   */
  applyLook(env = {}, renderer = this.renderer) {
    const look = this.look;
    look.toneExposure = env.toneExposure ?? LOOK_DEFAULTS.toneExposure;
    look.grade = env.grade || LOOK_DEFAULTS.grade;
    look.flare = env.flare ?? LOOK_DEFAULTS.flare;
    look.sunDisc = env.sky?.sunDisc ?? LOOK_DEFAULTS.sunDisc;
    renderer.toneMappingExposure = look.toneExposure;
    this.grade.setGrade(look.grade);
    const bl = env.bloom || {};
    this.bloom.luminanceMaterial.threshold = bl.threshold ?? LOOK_DEFAULTS.bloom.threshold;
    this.bloom.luminanceMaterial.smoothing = bl.smoothing ?? LOOK_DEFAULTS.bloom.smoothing;
    this.bloom.intensity = bl.intensity ?? LOOK_DEFAULTS.bloom.intensity;
    if (env.flareTint) this.flare.uniforms.get('uTint').value.fromArray(env.flareTint);
    else this.flare.uniforms.get('uTint').value.setRGB(1, 0.93, 0.82);
  }

  setCamera(camera) {
    this.camera = camera;
    for (const p of this.composer.passes) if (p.mainCamera !== undefined) p.mainCamera = camera;
    if (this.aoPass) this.aoPass.camera = camera;
  }

  setScene(scene) {
    this.scene = scene;
    this.renderPass.mainScene = scene;
  }

  setSize(w, h) {
    this.composer.setSize(w, h, false);
  }

  /**
   * Forget temporal history: motion blur (after resizes and cuts) and, with
   * `sun`, the smoothed sun visibility (on scene changes only; it doesn't
   * depend on the resolution, and resetting it can pop the flare).
   */
  resetHistory({ sun = false } = {}) {
    this.cameraFX.resetHistory();
    if (sun) this.flare.resetVisibility();
  }

  /** Per-frame uniforms. */
  update(camera, sunDir, dt, { flareIntensity = 1 } = {}) {
    this.cameraFX.updateCamera(camera, dt);
    this.flare.updateSun(camera, sunDir, flareIntensity, this.look.sunDisc);
    this.gforce.uniforms.get('uTimeG').value += dt;
    if (this.godRays) {
      this.sunMesh.position.copy(sunDir).multiplyScalar(camera.far * 0.8).add(camera.position);
      this.sunMesh.updateMatrixWorld();
    }
  }

  render(dt) {
    this.composer.render(dt);
    this.cameraFX.endFrame();
  }

  dispose() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }
}
