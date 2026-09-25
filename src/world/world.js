import { DirectionalLight, Group, HemisphereLight, Scene, Color } from 'three';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { WorldUniforms } from '../render/worldUniforms.js';

/**
 * Stage environment: scene graph root, sky/IBL, sun light, ocean and the
 * per-stage environment systems (terrain, clouds...) plugged in by stages.
 */
export class World {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.scene = new Scene();
    this.scene.name = 'world';
    this.sky = new Sky(renderer);
    this.scene.add(this.sky.dome);

    this.sun = new DirectionalLight(0xffffff, 3);
    this.sun.name = 'sun';
    this.sun.castShadow = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // subtle bounce from the sea / ground, complements IBL
    this.hemi = new HemisphereLight(0x8899aa, 0x0a1a24, 0.0);
    this.scene.add(this.hemi);

    this.ocean = null;
    this.dynamic = new Group();
    this.dynamic.name = 'dynamic';
    this.scene.add(this.dynamic);
    this.systems = []; // {update(dt, camera), dispose()}
    this.env = null;
  }

  configure(env) {
    this.env = env;
    this.sky.configure(env);
    this.scene.environment = this.sky.envMap;
    this.scene.environmentIntensity = env.envIntensity ?? 1.0;
    this.sun.color.copy(this.sky.sunColor);
    this.sun.intensity = this.sky.sunLightIntensity() * (env.sunLight ?? 1);
    if (env.ocean) {
      const q = this.quality;
      if (!this.ocean) {
        this.ocean = new Ocean({ rings: 60 + q.oceanRings * 10, segments: q.oceanRes + 32, preset: env.ocean });
        this.scene.add(this.ocean.mesh);
      } else this.ocean.setPreset(env.ocean);
      this.ocean.mesh.visible = true;
    } else if (this.ocean) this.ocean.mesh.visible = false;
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
  }
}

export { Color };
