import {
  AdditiveBlending, Color, CylinderGeometry, ConeGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial,
  MeshStandardMaterial, Quaternion, SphereGeometry, Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWorldFog } from './worldUniforms.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _d = new Vector3();
const _s = new Vector3(1, 1, 1);
const _fw = new Vector3(0, 0, -1);
const _col = new Color();

// Exhaust glow colours (HDR, per instance): player missiles hot yellow-white,
// enemy missiles red-orange (easy to read as a threat), "strong" ones redder.
export const MISSILE_GLOW = {
  player: new Color(9, 5.5, 2.5),
  enemy: new Color(11, 3.4, 1.1),
  strong: new Color(12, 1.5, 0.5)
};
// Enemy missiles are drawn a bit larger than the player's.
const ENEMY_BODY_SCALE = 1.25;
const ENEMY_GLOW_SCALE = 1.45;

function missileGeometry() {
  const body = new CylinderGeometry(0.09, 0.09, 3.2, 10, 1).rotateX(Math.PI / 2);
  const nose = new ConeGeometry(0.09, 0.45, 10).rotateX(-Math.PI / 2).translate(0, 0, -1.8);
  const finGeo = [];
  for (let i = 0; i < 4; i++) {
    const g = new ConeGeometry(0.22, 0.4, 3, 1).scale(1, 1, 0.08).rotateX(Math.PI / 2).rotateZ((i * Math.PI) / 2).translate(0, 0, 1.4);
    finGeo.push(g);
  }
  return mergeGeometries([body.toNonIndexed(), nose.toNonIndexed(), ...finGeo.map((g) => g.toNonIndexed())]);
}

/** Instanced missiles (both sides) + hot exhaust glow (colour per instance). */
export class MissileRenderer {
  constructor(scene, models, csm) {
    const cap = 96;
    let geo = null;
    let mat = null;
    if (models?.buildVehicleGeometry) {
      try {
        const g = models.buildVehicleGeometry('missile', 1);
        geo = g.body;
      } catch {
        geo = null;
      }
    }
    geo = geo || missileGeometry();
    mat = applyWorldFog(new MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.35, roughness: 0.4 }));
    if (csm) csm.setupMaterial(mat);
    this.mesh = new InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.name = 'missiles';
    scene.add(this.mesh);
    this.glowMat = new MeshBasicMaterial({ color: new Color(1, 1, 1), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
    this.glow = new InstancedMesh(new SphereGeometry(0.55, 10, 6), this.glowMat, cap);
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    // create the per-instance colour attribute now so the shader compiles with it at load
    for (let i = 0; i < cap; i++) this.glow.setColorAt(i, MISSILE_GLOW.player);
    this.glow.instanceColor.setUsage(DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.count = 0;
    this.glow.renderOrder = 5;
    scene.add(this.glow);
    this.materials = [mat, this.glowMat];
  }

  /** @param {Camera} [camera] dims exhaust glows that pass close to the lens (no screen-filling orbs) */
  update(missiles, alpha, camera) {
    const cam = camera ? camera.position : null;
    let n = 0;
    const arr = this.mesh.instanceMatrix.array;
    const garr = this.glow.instanceMatrix.array;
    const carr = this.glow.instanceColor.array;
    for (const m of missiles.list) {
      if (!m.active) continue;
      const enemy = m.owner !== 'player';
      const bs = enemy ? ENEMY_BODY_SCALE : 1;
      _p.lerpVectors(m.prevPos, m.pos, alpha);
      _d.copy(m.vel).normalize();
      _q.setFromUnitVectors(_fw, _d);
      _s.set(bs, bs, bs);
      _m.compose(_p, _q, _s);
      _m.toArray(arr, n * 16);
      // glow at the tail, flicker, only after ignition
      const lit = m.t > m.dropT ? 1 : 0.05;
      let fl = lit * (0.85 + Math.sin(m.t * 90 + m.seed) * 0.15) * (enemy ? ENEMY_GLOW_SCALE : 1);
      let near = 1;
      if (cam) {
        const d = _p.distanceTo(cam);
        near = d < 90 ? Math.max(0.12, (d - 12) / 78) : 1;
        fl *= 0.55 + 0.45 * near;
      }
      _p.addScaledVector(_d, -1.9 * bs);
      _s.set(fl, fl, fl * 2.2);
      _m.compose(_p, _q, _s);
      _m.toArray(garr, n * 16);
      _col.copy(enemy ? (m.strong ? MISSILE_GLOW.strong : MISSILE_GLOW.enemy) : MISSILE_GLOW.player).multiplyScalar(near).toArray(carr, n * 3);
      n++;
      if (n >= 96) break;
    }
    this.mesh.count = n;
    this.glow.count = n;
    if (n) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, n * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.glow.instanceMatrix.clearUpdateRanges();
      this.glow.instanceMatrix.addUpdateRange(0, n * 16);
      this.glow.instanceMatrix.needsUpdate = true;
      this.glow.instanceColor.clearUpdateRanges();
      this.glow.instanceColor.addUpdateRange(0, n * 3);
      this.glow.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    this.glow.geometry.dispose();
    this.glowMat.dispose();
    this.glow.dispose();
  }

  warmup(on) {
    this.mesh.count = on ? 1 : 0;
    this.glow.count = on ? 1 : 0;
  }
}
