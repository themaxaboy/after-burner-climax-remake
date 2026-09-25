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

/** Instanced missiles (both sides) + hot exhaust glow. */
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
    this.glowMat = new MeshBasicMaterial({ color: new Color(9, 5.5, 2.5), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false, toneMapped: false });
    this.glow = new InstancedMesh(new SphereGeometry(0.55, 10, 6), this.glowMat, cap);
    this.glow.instanceMatrix.setUsage(DynamicDrawUsage);
    this.glow.frustumCulled = false;
    this.glow.count = 0;
    this.glow.renderOrder = 5;
    scene.add(this.glow);
    this.materials = [mat, this.glowMat];
  }

  update(missiles, alpha) {
    let n = 0;
    const arr = this.mesh.instanceMatrix.array;
    const garr = this.glow.instanceMatrix.array;
    for (const m of missiles.list) {
      if (!m.active) continue;
      _p.lerpVectors(m.prevPos, m.pos, alpha);
      _d.copy(m.vel).normalize();
      _q.setFromUnitVectors(_fw, _d);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      _m.toArray(arr, n * 16);
      // glow at the tail, flicker, only after ignition
      const lit = m.t > m.dropT ? 1 : 0.05;
      const fl = lit * (0.85 + Math.sin(m.t * 90 + m.seed) * 0.15);
      _p.addScaledVector(_d, -1.9);
      _s.set(fl, fl, fl * 2.2);
      _m.compose(_p, _q, _s);
      _m.toArray(garr, n * 16);
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
