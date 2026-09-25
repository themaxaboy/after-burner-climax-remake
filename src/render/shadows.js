import { ShaderChunk } from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { CSMShader } from 'three/addons/csm/CSMShader.js';
import { adoptOnBeforeCompile } from './shaderHooks.js';

// three r186's CSMShader.lights_fragment_begin lags behind the core chunk
// (outdated iridescence fields, missing DFG multi-scattering setup). Rebuild
// it from the pristine core chunk, swapping in only CSM's directional-light
// cascade blocks.
(function patchCSMShader() {
  const core = ShaderChunk.lights_fragment_begin;
  const csm = CSMShader.lights_fragment_begin;
  const csmStart = csm.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM )');
  const rect = '#if ( NUM_RECT_AREA_LIGHTS > 0 )';
  const csmEnd = csm.indexOf(rect);
  const coreStart = core.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const coreEnd = core.indexOf(rect);
  if (csmStart < 0 || csmEnd < 0 || coreStart < 0 || coreEnd < 0) {
    console.warn('CSM shader patch skipped: markers not found');
    return;
  }
  CSMShader.lights_fragment_begin = core.slice(0, coreStart) + csm.slice(csmStart, csmEnd) + core.slice(coreEnd);
})();

/**
 * Cascaded shadow maps wrapper. Keeps the list of patched materials so the
 * setup can be rebuilt when quality changes, re-derives cascade frusta when
 * the chase camera's FOV changes, and chains CSM's onBeforeCompile into our
 * shader-hook system (CSM would otherwise overwrite other patches).
 */
export class Shadows {
  constructor({ scene, camera, preset, sunDir, sunColor, intensity }) {
    this.scene = scene;
    this.camera = camera;
    this.materials = new Set();
    this.enabled = preset.shadows > 0;
    this.csm = null;
    this._fov = camera.fov;
    this._aspect = camera.aspect;
    if (this.enabled) this._create(preset, sunDir, sunColor, intensity);
  }

  _create(preset, sunDir, sunColor, intensity) {
    this.csm = new CSM({
      maxFar: preset.shadowFar,
      cascades: preset.shadows,
      mode: 'practical',
      parent: this.scene,
      shadowMapSize: preset.shadowSize,
      lightDirection: sunDir.clone().negate(),
      camera: this.camera,
      lightIntensity: intensity,
      lightNear: 1,
      lightFar: 6000,
      lightMargin: 400,
      shadowBias: -0.00012
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) {
      l.color.copy(sunColor);
      l.shadow.normalBias = 0.06;
      l.shadow.radius = 2;
    }
    this.csm.updateFrustums();
  }

  setupMaterial(mat) {
    if (!this.csm || !mat || this.materials.has(mat)) return mat;
    if (!('onBeforeCompile' in mat) || mat.isShaderMaterial) return mat;
    this.materials.add(mat);
    this.csm.setupMaterial(mat);
    adoptOnBeforeCompile(mat, 'csm');
    return mat;
  }

  setSun(sunDir, color, intensity) {
    if (!this.csm) return;
    this.csm.lightDirection.copy(sunDir).negate();
    for (const l of this.csm.lights) {
      l.color.copy(color);
      l.intensity = intensity;
    }
  }

  update() {
    if (!this.csm) return;
    const cam = this.camera;
    if (Math.abs(cam.fov - this._fov) > 0.75 || cam.aspect !== this._aspect) {
      this._fov = cam.fov;
      this._aspect = cam.aspect;
      this.csm.updateFrustums();
    }
    this.csm.update();
  }

  dispose() {
    if (!this.csm) return;
    this.csm.remove();
    this.csm.dispose();
    this.csm = null;
  }
}
