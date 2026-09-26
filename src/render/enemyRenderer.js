import {
  AdditiveBlending, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4,
  MeshBasicMaterial, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3, BufferGeometry
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addShaderHook } from './shaderHooks.js';
import { applyWorldFog } from './worldUniforms.js';
import { smoothstep } from '../core/math.js';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _a = new Vector3();
const _back = new Vector3();
const _cam = new Vector3();
const _toCam = new Vector3();
const _col = new Color();

// Instances per (model, scale) group: ≥ 48 fighters alive for swarms and Climax.
const CAPACITY = { fighterA: 64, stealthB: 32, bomberXB: 3, bomberB52: 3, destroyer: 8, samLauncher: 16, heloCH47: 12, kc10: 2, missile: 8, bunker: 4 };
const SLOT_ORDER = ['body', 'metal', 'glass', 'emissive'];
const AIR_MODELS = new Set(['fighterA', 'stealthB', 'bomberXB', 'bomberB52', 'kc10', 'heloCH47', 'missile']);

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
 * Distance compensation for small aircraft: ×1 up to 400 m from the camera,
 * then growing to ×1.8 at 1280 m and beyond (a fighter at 1.5 km covers about
 * twice the pixels; up close the size is unchanged).
 */
export const DIST_SCALE = { from: 400, span: 1100, max: 1.8 };
export function distanceScale(d) {
  const k = 1 + (d - DIST_SCALE.from) / DIST_SCALE.span;
  return k < 1 ? 1 : k > DIST_SCALE.max ? DIST_SCALE.max : k;
}

/**
 * Final render scale of an enemy at `d` metres from the camera: visScale, ×
 * the distance compensation for aircraft that are not big (bombers keep their
 * size so boss sub-part lock points stay on the airframe; ground units too).
 */
export function drawScaleOf(def, d) {
  const v = visScaleOf(def);
  return def && def.air !== false && !def.big ? v * distanceScale(d) : v;
}

/**
 * Exhaust glow / nose light (HDR, additive, one instanced draw call).
 * `pxK`: minimum glow radius per metre of distance — 0.0032 d ≈ 2 px radius at
 * 720p (fov 58°), so an exhaust is ≥ ~4 px across even at 1.5 km.
 */
export const ENEMY_GLOW = {
  exhaust: new Color(6, 2.2, 0.55),
  nose: new Color(10, 0.7, 0.35),
  helo: 0.35, // turboshaft exhausts: dimmer
  pxK: 0.0032,
  noseK: 0.0026,
  pullFrom: 350, // m: glows are depth-biased toward the camera from here …
  pullTo: 1000, // … fully (by 0.6 × the drawn airframe length) from here
  nozzle: 0.45 // model nozzle glow (emissive uAfterburner) for enemies
};
const GLOW_CAP = 200;

/**
 * Shared look uniforms for every enemy material: a thin warm Fresnel rim and
 * a reduced share of the aerial-perspective fog, so the dark enemy paint
 * reads as a silhouette against bright skies and hazy horizons.
 */
export const ENEMY_LOOK = {
  uEnemyRim: { value: 0.3 },
  uEnemyRimColor: { value: new Color(1.0, 0.5, 0.25) },
  uEnemyFog: { value: 0.22 },
  uEnemyEnv: { value: 0.4 } // share of the sky's image-based light (no bright sheen on the dark paint)
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
  const out = { body: g };
  if (AIR_MODELS.has(model)) {
    out.nozzles = [{ position: new Vector3(0, 0, 7.5 * s), radius: 0.7 * s }];
    out.noseZ = -7.5 * s;
  }
  return out;
}

/**
 * Exhaust anchors of a model (object space, before scale): nozzles closer
 * than 2 m are merged (bomber engine boxes / pod pairs), at most 4 anchors.
 */
export function glowAnchors(nozzles = []) {
  const clusters = [];
  for (const n of nozzles) {
    const p = n.position;
    let c = clusters.find((k) => k.members.some((m) => m.distanceTo(p) < 2.0));
    if (!c) clusters.push((c = { members: [], r: 0 }));
    c.members.push(p);
    c.r = Math.max(c.r, n.radius);
  }
  const out = [];
  for (const c of clusters) {
    const ctr = new Vector3();
    for (const m of c.members) ctr.add(m);
    ctr.divideScalar(c.members.length);
    let ext = 0;
    for (const m of c.members) ext = Math.max(ext, m.distanceTo(ctr));
    out.push({ x: ctr.x, y: ctr.y, z: ctr.z, r: c.r + ext });
  }
  out.sort((a, b) => b.r - a.r);
  return out.slice(0, 4);
}

/**
 * Adds per-instance hit flash (emissive pulse), a thin warm Fresnel rim and a
 * reduced fog share to an instanced enemy material (after applyWorldFog).
 */
function addEnemyLook(mat) {
  return addShaderHook(mat, 'enemyLook', (shader) => {
    shader.uniforms.uEnemyRim = ENEMY_LOOK.uEnemyRim;
    shader.uniforms.uEnemyRimColor = ENEMY_LOOK.uEnemyRimColor;
    shader.uniforms.uEnemyFog = ENEMY_LOOK.uEnemyFog;
    shader.uniforms.uEnemyEnv = ENEMY_LOOK.uEnemyEnv;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlash;\nvarying float vFlash;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlash = aFlash;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlash;\nuniform float uEnemyRim;\nuniform vec3 uEnemyRimColor;\nuniform float uEnemyFog;\nuniform float uEnemyEnv;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(3.0, 1.6, 0.6) * vFlash;
        {
          float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - nv, 5.0) * (1.0 - smoothstep(250.0, 900.0, length(vViewPosition)));
          totalEmissiveRadiance += uEnemyRimColor * rim * uEnemyRim;
        }`
      )
      // dim the sky's image-based light: dark paint stays a dark silhouette
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        #if defined( RE_IndirectDiffuse )
          iblIrradiance *= uEnemyEnv;
          irradiance *= mix(1.0, uEnemyEnv, 0.5);
        #endif
        #if defined( RE_IndirectSpecular )
          radiance *= uEnemyEnv;
        #endif`
      )
      // keep only part of the aerial-perspective fog (see applyWorldFog)
      .replace(
        'gl_FragColor.rgb = applyWorldFog(gl_FragColor.rgb, vFogWorldPos);',
        'gl_FragColor.rgb = mix(gl_FragColor.rgb, applyWorldFog(gl_FragColor.rgb, vFogWorldPos), uEnemyFog);'
      );
  });
}

/**
 * Draws every enemy with one InstancedMesh per (model, material slot), plus
 * one additive InstancedMesh for every exhaust glow and rammer nose light.
 * Instances are packed each frame from the active enemy list with
 * interpolated transforms; small aircraft grow with distance to the camera
 * (drawScaleOf) so they stay readable at 1–1.5 km.
 */
export class EnemyRenderer {
  constructor(scene, models, { csm = null } = {}) {
    this.scene = scene;
    this.models = models;
    this.csm = csm;
    this.groups = new Map(); // model -> {meshes[], flash, count, cap, anchors, noseZ}
    this.materials = [];
    this.time = 0;
    // exhaust glows + nose lights: one draw call, created now so the stage precompile builds it
    this.glowMat = new MeshBasicMaterial({ color: new Color(1, 1, 1), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
    this.glowMat.name = 'enemyGlow';
    this.glow = new InstancedMesh(new SphereGeometry(1, 10, 6), this.glowMat, GLOW_CAP);
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < GLOW_CAP; i++) this.glow.setColorAt(i, ENEMY_GLOW.exhaust);
    this.glow.instanceColor.setUsage(DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.castShadow = false;
    this.glow.receiveShadow = false;
    this.glow.count = 0;
    this.glow.renderOrder = 5;
    this.glow.name = 'enemy:glow';
    scene.add(this.glow);
    this.glowCount = 0;
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
          // enemy engines always run hot: visible nozzle glow from behind
          const u = mats.emissive?.userData?.uniforms;
          if (u?.uAfterburner) u.uAfterburner.value = ENEMY_GLOW.nozzle;
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
      mats = { body: new MeshStandardMaterial({ color: concrete ? 0x9a938a : 0x3a4048, metalness: concrete ? 0 : 0.3, roughness: concrete ? 0.9 : 0.5 }) };
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
    // exhaust anchors and nose tip (object space, group scale applied)
    const air = AIR_MODELS.has(model);
    const anchors = air ? glowAnchors(geos.nozzles).map((a) => ({ x: a.x * scale, y: a.y * scale, z: a.z * scale, r: a.r * scale })) : [];
    const bb = geos.body?.boundingBox || (geos.body?.computeBoundingBox(), geos.body?.boundingBox);
    const noseZ = (geos.noseZ ?? bb?.min.z ?? -8) * scale * 0.97;
    const len = bb ? (bb.max.z - bb.min.z) * scale : 16 * scale;
    g = { meshes, flash, count: 0, cap, matrixAttr, anchors, noseZ, len, helo: model === 'heloCH47' };
    this.groups.set(key, g);
    return g;
  }

  /** Create groups ahead of time (so shaders compile during loading). */
  prepare(models) {
    for (const [m, s] of models) this._group(m, s);
  }

  /**
   * @param {EnemyManager} enemies
   * @param {number} alpha interpolation between the last two sim steps
   * @param {Camera} [camera] distance compensation and glow sizing (else e.dist, the lock-on distance)
   * @param {number} [realDt] flicker / blink clock
   */
  update(enemies, alpha, camera, realDt = 1 / 60) {
    this.time += realDt;
    for (const g of this.groups.values()) g.count = 0;
    const cam = camera ? _cam.copy(camera.position) : null;
    const list = enemies.list;
    let n = 0;
    const garr = this.glow.instanceMatrix.array;
    const carr = this.glow.instanceColor.array;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.active || !e.visible) continue;
      const g = this._group(e.def.model, e.def.scale || 1);
      if (g.count >= g.cap) continue;
      _p.lerpVectors(e.prevPos, e.pos, alpha);
      _q.slerpQuaternions(e.prevQuat, e.quat, alpha);
      const d = cam ? _p.distanceTo(cam) : e.dist ?? 0;
      const sc = drawScaleOf(e.def, d);
      _s.setScalar(sc);
      _m.compose(_p, _q, _s);
      _m.toArray(g.matrixAttr.array, g.count * 16);
      g.flash.array[g.count] = e.flash;
      g.count++;
      // ---- exhaust glow at each nozzle anchor, nose light for rammers
      if (!e.def.air || e.dead || e.dying > 0 || !g.anchors.length) continue;
      const near = d < 150 ? Math.max(0.1, (d - 20) / 130) : 1; // close passes: no screen-filling orbs at the lens
      const rMin = d * ENEMY_GLOW.pxK * smoothstep(250, 1000, d); // pixel floor for far aircraft only
      _back.set(0, 0, 1).applyQuaternion(_q); // aircraft tail direction
      // brighter when the tail faces the camera
      let face = 1;
      let pull = 0;
      if (cam) {
        _toCam.subVectors(cam, _p).normalize();
        face = 0.6 + 0.25 * Math.max(0, _back.dot(_toCam));
        // far away the glow is moved toward the camera along its view ray (same screen spot)
        // so the airframe never hides it: a nose-on enemy still shows its hot engines
        pull = smoothstep(ENEMY_GLOW.pullFrom, ENEMY_GLOW.pullTo, d) * g.len * sc * 0.6;
      }
      const fl = (0.88 + 0.12 * Math.sin(this.time * 70 + e.id * 1.7)) * face * near * (g.helo ? ENEMY_GLOW.helo : 1);
      for (const an of g.anchors) {
        if (n >= GLOW_CAP) break;
        const rb = an.r * 1.1 * sc;
        const r = Math.max(rb, rMin);
        const len = Math.max(rb * 2.4, r * 1.4);
        _a.set(an.x * sc, an.y * sc, an.z * sc).applyQuaternion(_q).add(_p).addScaledVector(_back, len * 0.45);
        if (pull > 0) _a.addScaledVector(_toCam, pull + len);
        _s.set(r, r, len);
        _m.compose(_a, _q, _s);
        _m.toArray(garr, n * 16);
        _col.copy(ENEMY_GLOW.exhaust).multiplyScalar(fl).toArray(carr, n * 3);
        n++;
      }
      if (e.noseLight && n < GLOW_CAP) {
        const r = Math.max(0.45 * sc, d * ENEMY_GLOW.noseK);
        _a.set(0, 0, g.noseZ * sc).applyQuaternion(_q).add(_p);
        _s.set(r, r, r);
        _m.compose(_a, _q, _s);
        _m.toArray(garr, n * 16);
        _col.copy(ENEMY_GLOW.nose).multiplyScalar(near).toArray(carr, n * 3);
        n++;
      }
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
    this.glowCount = n;
    this.glow.count = n;
    if (n) {
      const im = this.glow.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, n * 16);
      im.needsUpdate = true;
      const ic = this.glow.instanceColor;
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, n * 3);
      ic.needsUpdate = true;
    }
  }

  /** Make every group (and the glow mesh) visible once for shader precompilation. */
  warmup(on) {
    for (const g of this.groups.values()) for (const m of g.meshes) m.count = on ? 1 : 0;
    this.glow.count = on ? 1 : 0;
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
    this.scene.remove(this.glow);
    this.glow.geometry.dispose();
    this.glowMat.dispose();
    this.glow.dispose();
  }
}

export { BufferGeometry };
