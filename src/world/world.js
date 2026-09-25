import { DirectionalLight, Group, HemisphereLight, Scene, Color, Vector3 } from 'three';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { LOOKS } from './looks.js';
import { params } from '../core/params.js';
import { WorldUniforms } from '../render/worldUniforms.js';
import { Shadows } from '../render/shadows.js';

const _up = new Vector3(0, 1, 0);
const _c = new Color();

/**
 * Stage environment: scene graph root, sky/IBL, sun light, ocean and the
 * per-stage environment systems (terrain, clouds...) plugged in by stages.
 */
export class World {
  constructor(renderer, quality, camera) {
    this.renderer = renderer;
    this.quality = quality;
    this.camera = camera;
    this.csm = null;
    this.scene = new Scene();
    this.scene.name = 'world';
    this.sky = new Sky(renderer);
    this.scene.add(this.sky.dome);

    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // sky fill from the zenith colour + bounce from the sea / ground (lifts
    // shadows so nothing crushes to black; complements IBL)
    this.hemi = new HemisphereLight(0x8899aa, 0x0a1a24, 0.0);
    this.scene.add(this.hemi);

    this.ocean = null;
    this.dynamic = new Group();
    this.dynamic.name = 'dynamic';
    this.scene.add(this.dynamic);
    this.systems = []; // {update(dt, camera), dispose()}
    this.env = null;
  }

  /**
   * The env actually used: `?look=<name>` (look dev) overrides the stage's
   * look values with LOOKS[name], keeping stage-only fields.
   */
  resolveEnv(env) {
    const look = params.look && LOOKS[params.look];
    return look ? { ...env, ...look, lookName: params.look } : env;
  }

  configure(envIn) {
    const env = this.resolveEnv(envIn);
    this.env = env;
    this.sky.configure(env);
    this.scene.environment = this.sky.envMap;
    this.scene.environmentIntensity = env.envIntensity ?? 1.3;
    this.sun.color.copy(this.sky.sunColor);
    this.sun.intensity = this.sky.sunLightIntensity() * (env.sunLight ?? 1);
    // hemisphere fill: sky = zenith colour (half-way to white, luma 1), ground = albedo bounce
    this.sky.radiance(_up, _c);
    const l = Math.max(0.2126 * _c.r + 0.7152 * _c.g + 0.0722 * _c.b, 1e-4);
    this.hemi.color.setRGB(_c.r / l, _c.g / l, _c.b / l).lerp(new Color(1, 1, 1), 0.5);
    const ga = env.groundAlbedo || [0.05, 0.08, 0.1];
    this.hemi.groundColor.setRGB(ga[0], ga[1], ga[2]).multiplyScalar(2.5);
    this.hemi.intensity = env.hemi ?? 0.35;
    if (!this.csm && this.quality.shadows > 0) {
      this.csm = new Shadows({
        scene: this.scene,
        camera: this.camera,
        preset: this.quality,
        sunDir: WorldUniforms.uSunDir.value,
        sunColor: this.sun.color,
        intensity: this.sun.intensity
      });
    }
    if (this.csm && this.csm.csm) {
      this.csm.setSun(WorldUniforms.uSunDir.value, this.sun.color, this.sun.intensity);
      this.sun.visible = false;
    } else this.sun.visible = true;
    this._shadowIntensity();
    if (env.ocean) {
      const q = this.quality;
      if (!this.ocean) {
        this.ocean = new Ocean({ rings: 60 + q.oceanRings * 10, segments: q.oceanRes + 32, preset: env.ocean });
        this.csm?.setupMaterial(this.ocean.material);
        this.scene.add(this.ocean.mesh);
      } else this.ocean.setPreset(env.ocean);
      this.ocean.mesh.visible = true;
    } else if (this.ocean) this.ocean.mesh.visible = false;
  }

  /** Lighter shadows (arcade look: shade, never black). */
  _shadowIntensity() {
    const k = this.env?.shadowIntensity ?? 0.72;
    this.sun.shadow.intensity = k;
    for (const l of this.csm?.csm?.lights || []) l.shadow.intensity = k;
  }

  addSystem(sys) {
    this.systems.push(sys);
    return sys;
  }

  removeSystem(sys) {
    const i = this.systems.indexOf(sys);
    if (i >= 0) this.systems.splice(i, 1);
    sys.dispose?.();
  }

  update(dt, camera) {
    this.sky.update(camera);
    if (this.ocean && this.ocean.mesh.visible) this.ocean.update(camera);
    // directional light follows the camera so shadow frusta stay centred
    const sd = WorldUniforms.uSunDir.value;
    this.sun.position.copy(camera.position).addScaledVector(sd, 2000);
    this.sun.target.position.copy(camera.position);
    this.sun.target.updateMatrixWorld();
    for (let i = 0; i < this.systems.length; i++) this.systems[i].update(dt, camera);
    this.csm?.update();
  }

  /** Rebuild quality-dependent parts (shadows) after a preset change. */
  setQuality(q) {
    this.quality = q;
    const mats = this.csm ? [...this.csm.materials] : [];
    this.csm?.dispose();
    this.csm = null;
    for (const m of mats) {
      delete m.defines.USE_CSM;
      delete m.defines.CSM_CASCADES;
      delete m.defines.CSM_FADE;
      m.needsUpdate = true;
    }
    if (q.shadows > 0) {
      this.csm = new Shadows({ scene: this.scene, camera: this.camera, preset: q, sunDir: WorldUniforms.uSunDir.value, sunColor: this.sun.color, intensity: this.sun.intensity });
      for (const m of mats) this.csm.setupMaterial(m);
      this.sun.visible = !this.csm.csm;
    } else this.sun.visible = true;
    this._shadowIntensity();
  }
}

export { Color };
