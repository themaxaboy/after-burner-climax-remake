import {
  BoxGeometry, ConeGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial,
  Quaternion, Vector3, BufferGeometry
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addShaderHook } from './shaderHooks.js';
import { applyWorldFog } from './worldUniforms.js';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

const CAPACITY = { fighterA: 32, stealthB: 16, bomberXB: 3, bomberB52: 3, destroyer: 8, samLauncher: 16, heloCH47: 8, kc10: 2, missile: 8, bunker: 4 };
const SLOT_ORDER = ['body', 'metal', 'glass', 'emissive'];

function fallbackGeometry(model) {
  const parts = [];
  const big = model === 'bomberXB' || model === 'bomberB52' || model === 'kc10';
  const ship = model === 'destroyer';
  const s = big ? 3 : ship ? 8 : 1;
  if (ship) {
    parts.push(new BoxGeometry(18, 10, 150).translate(0, 3, 0));
    parts.push(new BoxGeometry(10, 12, 30).translate(0, 14, 10));
  } else if (model === 'samLauncher' || model === 'bunker') {
    parts.push(new BoxGeometry(4, 3, 8).translate(0, 1.5, 0));
    parts.push(new BoxGeometry(3, 1.5, 6).rotateX(-0.6).translate(0, 4, 0));
  } else {
    parts.push(new ConeGeometry(0.9 * s, 15 * s, 8).rotateX(-Math.PI / 2));
    parts.push(new BoxGeometry(11 * s, 0.3 * s, 4 * s).translate(0, 0, 2 * s));
    parts.push(new BoxGeometry(0.25 * s, 3 * s, 2.5 * s).translate(0, 1.5 * s, 6 * s));
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  return { body: g };
}

/** Adds per-instance hit flash (emissive pulse) to an instanced material. */
function addHitFlash(mat) {
  return addShaderHook(mat, 'hitFlash', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlash;\nvarying float vFlash;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlash = aFlash;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(3.0, 1.6, 0.6) * vFlash;');
  });
}

/**
 * Draws every enemy with one InstancedMesh per (model, material slot).
 * Instances are packed each frame from the active enemy list with
 * interpolated transforms.
 */
export class EnemyRenderer {
  constructor(scene, models, { csm = null } = {}) {
    this.scene = scene;
    this.models = models;
    this.csm = csm;
    this.groups = new Map(); // model -> {meshes[], flash, count, cap}
    this.materials = [];
  }

  _group(model, scale = 1) {
    const key = scale === 1 ? model : `${model}@${scale}`;
    let g = this.groups.get(key);
    if (g) return g;
    const cap = CAPACITY[model] || 16;
    let geos = null, mats = null;
    if (this.models) {
      try {
        const lod = model === 'destroyer' || model === 'samLauncher' || model === 'bunker' ? 0 : 1;
        if (this.models.buildAircraftGeometry && this.models.AIRCRAFT_IDS?.includes(model)) {
          geos = this.models.buildAircraftGeometry(model, lod);
          mats = this.models.createAircraftMaterials(model, 'enemy', { instanced: true });
        } else if (this.models.buildVehicleGeometry) {
          geos = this.models.buildVehicleGeometry(model, lod);
          mats = this.models.createVehicleMaterials ? this.models.createVehicleMaterials(model, { instanced: true }) : null;
        }
      } catch (e) {
        console.warn('model build failed', model, e);
        geos = null;
      }
    }
    if (!geos || !mats) {
      geos = fallbackGeometry(model);
      mats = { body: new MeshStandardMaterial({ color: 0x6d7680, metalness: 0.3, roughness: 0.5 }) };
    }
    const flash = new InstancedBufferAttribute(new Float32Array(cap), 1);
    flash.setUsage(DynamicDrawUsage);
    const meshes = [];
    let matrixAttr = null;
    for (const slot of SLOT_ORDER) {
      const geo = geos[slot];
      const mat = mats[slot] || mats.body;
      if (!geo) continue;
      if (!mat.userData.enemyPatched) {
        mat.userData.enemyPatched = true;
        applyWorldFog(mat);
        addHitFlash(mat);
        this.csm?.setupMaterial(mat);
        this.materials.push(mat);
      }
      const gg = geo.clone();
      if (scale !== 1) gg.scale(scale, scale, scale);
      gg.setAttribute('aFlash', flash);
      const mesh = new InstancedMesh(gg, mat, cap);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      if (matrixAttr) mesh.instanceMatrix = matrixAttr;
      else matrixAttr = mesh.instanceMatrix;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = slot !== 'emissive';
      mesh.receiveShadow = true;
      mesh.name = `enemy:${key}:${slot}`;
      this.scene.add(mesh);
      meshes.push(mesh);
    }
    g = { meshes, flash, count: 0, cap, matrixAttr };
    this.groups.set(key, g);
    return g;
  }

  /** Create groups ahead of time (so shaders compile during loading). */
  prepare(models) {
    for (const [m, s] of models) this._group(m, s);
  }

  update(enemies, alpha) {
    for (const g of this.groups.values()) g.count = 0;
    const list = enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.active || !e.visible) continue;
      const g = this._group(e.def.model, e.def.scale || 1);
      if (g.count >= g.cap) continue;
      _p.lerpVectors(e.prevPos, e.pos, alpha);
      _q.slerpQuaternions(e.prevQuat, e.quat, alpha);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      _m.toArray(g.matrixAttr.array, g.count * 16);
      g.flash.array[g.count] = e.flash;
      g.count++;
    }
    for (const g of this.groups.values()) {
      for (const m of g.meshes) m.count = g.count;
      if (g.count > 0) {
        g.matrixAttr.clearUpdateRanges();
        g.matrixAttr.addUpdateRange(0, g.count * 16);
        g.matrixAttr.needsUpdate = true;
        g.flash.clearUpdateRanges();
        g.flash.addUpdateRange(0, g.count);
        g.flash.needsUpdate = true;
      }
    }
  }

  /** Make every group visible once for shader precompilation. */
  warmup(on) {
    for (const g of this.groups.values()) for (const m of g.meshes) m.count = on ? 1 : 0;
  }

  dispose() {
    for (const g of this.groups.values()) {
      for (const m of g.meshes) {
        this.scene.remove(m);
        m.geometry.dispose();
        m.dispose();
      }
    }
    this.groups.clear();
  }
}

export { BufferGeometry };
