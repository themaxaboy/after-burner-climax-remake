import {
  BoxGeometry, ConeGeometry, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial,
  Quaternion, Vector3, BufferGeometry
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addShaderHook } from './shaderHooks.js';
import { applyWorldFog } from './worldUniforms.js';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

// Instances per (model, scale) group: ≥ 48 fighters alive for swarms and Climax.
const CAPACITY = { fighterA: 64, stealthB: 32, bomberXB: 3, bomberB52: 3, destroyer: 8, samLauncher: 16, heloCH47: 12, kc10: 2, missile: 8, bunker: 4 };
const SLOT_ORDER = ['body', 'metal', 'glass', 'emissive'];

/**
 * Render-only scale per model so enemies read clearly at arcade distances
 * (ENEMY_TYPES[type].visScale wins when present). Collisions use e.radius.
 */
export const VIS_SCALE = { fighterA: 1.8, stealthB: 1.6, heloCH47: 1.4, bomberXB: 1.15, bomberB52: 1.15, kc10: 1.15 };

/** Render scale for an enemy type definition. */
export function visScaleOf(def) {
  return def?.visScale ?? VIS_SCALE[def?.model] ?? 1;
}

/**
 * Shared look uniforms for every enemy material: a Fresnel rim light (sun
 * tinted) and a reduced share of the aerial-perspective fog, so enemies pop
 * against bright skies and hazy horizons.
 */
export const ENEMY_LOOK = {
  uEnemyRim: { value: 0.55 },
  uEnemyFog: { value: 0.45 }
};

function fallbackGeometry(model) {
  const parts = [];
  const big = model === 'bomberXB' || model === 'bomberB52' || model === 'kc10';
  const ship = model === 'destroyer';
  const s = big ? 3 : ship ? 8 : 1;
  if (ship) {
    parts.push(new BoxGeometry(18, 10, 150).translate(0, 3, 0));
    parts.push(new BoxGeometry(10, 12, 30).translate(0, 14, 10));
  } else if (model === 'bunker') {
    // hardened command bunker: half-cylinder shelter, berms, blast door, radar mast
    const shelter = new CylinderGeometry(14, 14, 44, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
    parts.push(shelter);
    parts.push(new BoxGeometry(34, 5, 58).translate(0, 2.5, 0));
    parts.push(new BoxGeometry(12, 10, 1.5).translate(0, 5, -22.5));
    parts.push(new BoxGeometry(6, 8, 6).translate(9, 16, 10));
    parts.push(new CylinderGeometry(0.4, 0.6, 18, 6).translate(9, 29, 10));
    parts.push(new BoxGeometry(7, 0.3, 3).translate(9, 36, 10));
    for (const x of [-22, 22]) parts.push(new BoxGeometry(6, 7, 70).translate(x, 3.5, 0));
  } else if (model === 'samLauncher') {
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

/**
 * Adds per-instance hit flash (emissive pulse), a Fresnel rim light and a
 * reduced fog share to an instanced enemy material (after applyWorldFog).
 */
function addEnemyLook(mat) {
  return addShaderHook(mat, 'enemyLook', (shader) => {
    shader.uniforms.uEnemyRim = ENEMY_LOOK.uEnemyRim;
    shader.uniforms.uEnemyFog = ENEMY_LOOK.uEnemyFog;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlash;\nvarying float vFlash;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlash = aFlash;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;\nuniform float uEnemyRim;\nuniform float uEnemyFog;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(3.0, 1.6, 0.6) * vFlash;
        {
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - nv, 3.0);
          totalEmissiveRadiance += (uSunColor * 0.8 + vec3(0.25, 0.3, 0.35)) * rim * uEnemyRim;
        }`
      )
      // keep only part of the aerial-perspective fog (see applyWorldFog)
      .replace(
        'gl_FragColor.rgb = applyWorldFog(gl_FragColor.rgb, vFogWorldPos);',
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, applyWorldFog(gl_FragColor.rgb, vFogWorldPos), uEnemyFog);'
      );
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
      const concrete = model === 'bunker';
      mats = { body: new MeshStandardMaterial({ color: concrete ? 0x9a938a : 0x6d7680, metalness: concrete ? 0 : 0.3, roughness: concrete ? 0.9 : 0.5 }) };
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
        addEnemyLook(mat);
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
      _s.setScalar(visScaleOf(e.def));
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
