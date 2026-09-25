import {
  BloomEffect, BlendFunction, EffectComposer, EffectPass, FXAAEffect, GodRaysEffect, KernelSize,
  NoiseEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode
} from 'postprocessing';
import { HalfFloatType, Mesh, MeshBasicMaterial, SphereGeometry, Color } from 'three';
import { CameraFXEffect } from './effects/CameraFXEffect.js';
import { LensFlareEffect } from './effects/LensFlareEffect.js';
import { GForceEffect } from './effects/GForceEffect.js';
import { GradeEffect } from './effects/GradeEffect.js';

/**
 * Post-processing chain (pmndrs). Only one CONVOLUTION effect is allowed per
 * EffectPass, so the chain is:
 *   RenderPass (MSAA on high/ultra)
 *   [N8AO]                                   ultra
 *   EffectPass A: CameraFX (motion blur, radial blur, CA, heat haze)   medium+
 *   EffectPass B: GodRays? + Bloom + LensFlare + ToneMapping(AgX) + Grade + GForce + Noise
 *   EffectPass C: SMAA | FXAA
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
          intensity: this.bloom.intensity,
          gforce: [...this.gforce.uniforms].map(([k, u]) => [k, u.value && u.value.clone ? u.value.clone() : u.value])
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
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.35,
      intensity: 0.9,
      radius: 0.72,
      levels: preset.bloomHalfRes ? 6 : 8
    });
    if (preset.bloomHalfRes) this.bloom.resolution.scale = 0.5;
    this.flare = new LensFlareEffect();
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.gforce = new GForceEffect();
    this.noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.ADD });
    this.noise.blendMode.opacity.value = 0.12;

    const effects = [];
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
      this.bloom.intensity = carry.intensity;
      for (const [k, v] of carry.gforce) {
        const u = this.gforce.uniforms.get(k);
        if (u) u.value = v;
      }
    }
    return composer;
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

  /** Per-frame uniforms. */
  update(camera, sunDir, dt, { flareIntensity = 1 } = {}) {
    this.cameraFX.updateCamera(camera, dt);
    this.flare.updateSun(camera, sunDir, flareIntensity);
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
