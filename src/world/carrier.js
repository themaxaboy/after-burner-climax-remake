import {
  BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CylinderGeometry, Group, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, Vector3, Color, SphereGeometry, CapsuleGeometry,
  Shape, ExtrudeGeometry
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyWorldFog } from '../render/worldUniforms.js';
import { Rng } from '../core/rng.js';

// Original supercarrier design (Nimitz-class proportions), local space:
// bow toward -Z, deck at y = DECK_Y, origin at the waterline centre.
export const CARRIER = {
  length: 326,
  beam: 40,
  deckWidth: 76,
  deckY: 19.5,
  catStart: -40, // bow catapult track start (z)
  catEnd: -158, // launch point (bow edge)
  catX: -9 // lateral offset of catapult 1 (starboard bow cat is +)
};

function hullGeometry() {
  // cross sections along z: [z, halfBeamDeck, halfBeamWater, keelDepth]
  const L = CARRIER.length;
  const secs = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = i / n; // 0 = stern, 1 = bow
    const z = L / 2 - t * L;
    const bowK = Math.max(0, (t - 0.72) / 0.28);
    const sternK = Math.max(0, (0.06 - t) / 0.06);
    const halfDeck = 17 * (1 - bowK * bowK * 0.92) * (1 - sternK * 0.1);
    const halfWater = 16 * (1 - Math.pow(bowK, 1.4) * 0.97) * (1 - sternK * 0.25);
    const keel = 11 * (1 - bowK * 0.4);
    secs.push([z, Math.max(0.3, halfDeck), Math.max(0.2, halfWater), keel]);
  }
  const pos = [];
  const idx = [];
  const ring = (s) => {
    const [z, hd, hw, k] = s;
    const D = CARRIER.deckY - 1.5;
    // polygon (clockwise viewed from bow): deck-left, water-left, keel-left, keel-right, water-right, deck-right
    return [
      [-hd, D, z], [-hw, 0.5, z], [-hw * 0.7, -k, z], [hw * 0.7, -k, z], [hw, 0.5, z], [hd, D, z]
    ];
  };
  const rings = secs.map(ring);
  const M = 6;
  for (const r of rings) for (const p of r) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = i * M + j + 1, c = (i + 1) * M + j, d = (i + 1) * M + j + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // stern transom cap
  idx.push(0, 1, 5, 1, 4, 5, 1, 2, 4, 2, 3, 4);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  const ni = g.toNonIndexed();
  ni.computeVertexNormals();
  // uv.y = height above water for the boot-top colour band
  const p = ni.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getZ(i) / L;
    uv[i * 2 + 1] = p.getY(i);
  }
  ni.setAttribute('uv', new BufferAttribute(uv, 2));
  return ni;
}

function deckShape() {
  // flight deck outline (x, z) with the angled deck sponson to port
  const s = new Shape();
  const L = CARRIER.length / 2;
  s.moveTo(20, L - 2);
  s.lineTo(34, L - 60);
  s.lineTo(38, -20);
  s.lineTo(31, -100);
  s.lineTo(14, -L + 2);
  s.lineTo(-12, -L + 4);
  s.lineTo(-22, -120);
  s.lineTo(-40, -40); // angled deck corner
  s.lineTo(-38, 60);
  s.lineTo(-24, L - 4);
  s.closePath();
  return s;
}

function deckTexture(rng) {
  const W = 512, H = 2048; // x: 80 m, z: 330 m
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const mx = (x) => ((x + 40) / 80) * W;
  const mz = (z) => ((z + 165) / 330) * H;
  g.fillStyle = '#5d6166';
  g.fillRect(0, 0, W, H);
  // non-skid noise + tire marks + stains
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rng.next() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.18;
  for (let i = 0; i < 260; i++) {
    g.fillStyle = rng.next() < 0.5 ? '#222' : '#5a5e62';
    const x = rng.range(0, W), y = rng.range(0, H);
    g.fillRect(x, y, rng.range(2, 6), rng.range(20, 140));
  }
  g.globalAlpha = 1;
  // angled landing area (9 degrees to port)
  g.save();
  g.translate(mx(-6), mz(80));
  g.rotate((-9 * Math.PI) / 180);
  g.strokeStyle = '#e8e8e0';
  g.lineWidth = 3;
  g.setLineDash([]);
  g.strokeRect(-mx(-40) + mx(-51), -mz(0) + mz(-150), (22 / 80) * W, (230 / 330) * H);
  g.setLineDash([26, 22]);
  g.strokeStyle = '#f2f2ea';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, -(230 / 330) * H);
  g.stroke();
  g.restore();
  g.setLineDash([]);
  // foul lines (red/yellow)
  g.strokeStyle = '#d9b227';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(mx(-2), mz(-160));
  g.lineTo(mx(-2), mz(100));
  g.stroke();
  // catapult tracks
  g.strokeStyle = '#2a2c2e';
  g.lineWidth = 5;
  for (const x of [CARRIER.catX, CARRIER.catX + 18]) {
    g.beginPath();
    g.moveTo(mx(x), mz(CARRIER.catEnd + 4));
    g.lineTo(mx(x), mz(CARRIER.catStart + 30));
    g.stroke();
    g.strokeStyle = '#e8e8e0';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(mx(x - 1.5), mz(CARRIER.catEnd + 4));
    g.lineTo(mx(x - 1.5), mz(CARRIER.catStart + 30));
    g.moveTo(mx(x + 1.5), mz(CARRIER.catEnd + 4));
    g.lineTo(mx(x + 1.5), mz(CARRIER.catStart + 30));
    g.stroke();
    g.strokeStyle = '#2a2c2e';
    g.lineWidth = 5;
  }
  // elevator outlines
  g.strokeStyle = '#d9b227';
  g.lineWidth = 2;
  for (const [x, z] of [[32, -40], [32, 20], [-36, 70]]) g.strokeRect(mx(x - 7), mz(z - 10), (14 / 80) * W, (20 / 330) * H);
  // hull number at the bow (original)
  g.save();
  g.translate(mx(0), mz(-135));
  g.fillStyle = '#e9e9e2';
  g.font = 'bold 120px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('77', 0, 0);
  g.restore();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  return tex;
}

function islandGeometry() {
  const parts = [];
  const x = 30, z = 30;
  parts.push(new BoxGeometry(10, 12, 34).translate(x, CARRIER.deckY + 6, z));
  parts.push(new BoxGeometry(9, 8, 26).translate(x, CARRIER.deckY + 16, z - 2));
  parts.push(new BoxGeometry(8, 5, 16).translate(x, CARRIER.deckY + 22.5, z - 6));
  parts.push(new BoxGeometry(9.5, 3, 8).translate(x, CARRIER.deckY + 26.5, z - 10)); // bridge
  // mast
  parts.push(new CylinderGeometry(0.6, 1.2, 18, 8).translate(x, CARRIER.deckY + 37, z - 4));
  parts.push(new BoxGeometry(7, 0.5, 0.5).translate(x, CARRIER.deckY + 40, z - 4));
  parts.push(new BoxGeometry(5, 0.4, 0.4).translate(x, CARRIER.deckY + 43, z - 4));
  // radar arrays
  parts.push(new BoxGeometry(0.4, 4, 4).translate(x - 5.1, CARRIER.deckY + 20, z - 8));
  parts.push(new BoxGeometry(0.4, 4, 4).translate(x + 5.1, CARRIER.deckY + 20, z - 8));
  const rot = new CylinderGeometry(0.2, 0.2, 6, 6).rotateZ(Math.PI / 2).translate(x, CARRIER.deckY + 47, z - 4);
  parts.push(rot);
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

/** Aircraft carrier set piece with deck crew, parked jets, steam and wake. */
export class Carrier {
  constructor({ models = null, fx = null, csm = null, seed = 9 } = {}) {
    const rng = new Rng(seed);
    this.group = new Group();
    this.group.name = 'carrier';
    this.fx = fx;
    this.materials = [];
    const hullMat = new MeshStandardMaterial({ color: new Color(0.26, 0.28, 0.3), metalness: 0.2, roughness: 0.7 });
    this._bootTop(hullMat);
    const deckMat = new MeshStandardMaterial({ map: deckTexture(rng), roughness: 0.88, metalness: 0.05 });
    const islandMat = new MeshStandardMaterial({ color: new Color(0.3, 0.32, 0.34), metalness: 0.25, roughness: 0.6 });
    for (const m of [hullMat, deckMat, islandMat]) {
      applyWorldFog(m);
      csm?.setupMaterial(m);
      this.materials.push(m);
    }
    const hull = new Mesh(hullGeometry(), hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    this.group.add(hull);

    const deckGeo = new ExtrudeGeometry(deckShape(), { depth: 1.6, bevelEnabled: false });
    deckGeo.rotateX(Math.PI / 2);
    deckGeo.translate(0, CARRIER.deckY + 0.1, 0);
    // planar UVs over the deck
    const p = deckGeo.attributes.position;
    const uv = deckGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 40) / 80, 1 - (p.getZ(i) + 165) / 330);
    uv.needsUpdate = true;
    deckGeo.computeVertexNormals();
    const deck = new Mesh(deckGeo, deckMat);
    deck.receiveShadow = true;
    deck.castShadow = true;
    this.group.add(deck);

    const island = new Mesh(islandGeometry(), islandMat);
    island.castShadow = true;
    island.receiveShadow = true;
    this.group.add(island);

    // jet blast deflectors behind the bow catapults (raised)
    this.jbd = new Mesh(new BoxGeometry(12, 3.4, 0.4).rotateX(-0.95), islandMat);
    this.jbd.position.set(CARRIER.catX, CARRIER.deckY + 1.8, CARRIER.catStart + 14);
    this.jbd.castShadow = true;
    this.group.add(this.jbd);

    // deck crew: coloured jersey torso + dark trousers + cranial helmet
    const crewCols = [0xf5d000, 0x2e9d3a, 0x7b3fb0, 0xc62828, 0xeeeeee, 0x1e5bd6, 0x7b5a2e];
    const D = CARRIER.deckY + 0.1;
    const torsoGeo = new CapsuleGeometry(0.2, 0.42, 3, 8).translate(0, D + 1.18, 0);
    const legsGeo = mergeGeometries([
      new CapsuleGeometry(0.085, 0.72, 2, 6).translate(-0.11, D + 0.45, 0),
      new CapsuleGeometry(0.085, 0.72, 2, 6).translate(0.11, D + 0.45, 0)
    ]);
    const headGeo = new SphereGeometry(0.14, 10, 8).translate(0, D + 1.62, 0);
    const torsoMat = applyWorldFog(new MeshStandardMaterial({ roughness: 0.85 }));
    const legsMat = applyWorldFog(new MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.9 }));
    const headMat = applyWorldFog(new MeshStandardMaterial({ roughness: 0.6 }));
    this.materials.push(torsoMat, legsMat, headMat);
    const nCrew = 46;
    const torso = new InstancedMesh(torsoGeo, torsoMat, nCrew);
    const legs = new InstancedMesh(legsGeo, legsMat, nCrew);
    const head = new InstancedMesh(headGeo, headMat, nCrew);
    const m = new Matrix4();
    const col = new Color();
    const q = new Quaternion();
    const place = (k, x, z, colour) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), rng.range(0, Math.PI * 2));
      m.compose(new Vector3(x, 0, z), q, new Vector3(1, 1, 1));
      torso.setMatrixAt(k, m);
      legs.setMatrixAt(k, m);
      head.setMatrixAt(k, m);
      torso.setColorAt(k, col.setHex(colour));
      head.setColorAt(k, col.setHex(colour).multiplyScalar(0.9));
    };
    for (let i = 0; i < nCrew; i++) {
      let x, z;
      do {
        x = rng.range(-30, 32);
        z = rng.range(-150, 150);
      } while (Math.abs(x - CARRIER.catX) < 9 && z < CARRIER.catStart + 25 && z > CARRIER.catEnd - 5);
      place(i, x, z, crewCols[i % crewCols.length]);
    }
    // shooter + hook-up crew around the launching jet
    const near = [[CARRIER.catX - 9, CARRIER.catStart - 6], [CARRIER.catX - 8, CARRIER.catStart + 6], [CARRIER.catX + 10, CARRIER.catStart + 8]];
    near.forEach(([x, z], k) => place(k, x, z, k === 0 ? 0xf5d000 : 0x2e9d3a));
    for (const im of [torso, legs, head]) {
      im.castShadow = true;
      this.group.add(im);
    }

    // parked aircraft on the deck (static LOD geometry)
    if (models?.buildAircraftGeometry) {
      try {
        const geos = models.buildAircraftGeometry('fa18e', 1);
        const mats = models.createAircraftMaterials('fa18e', 'lowvis', { instanced: true });
        const spots = [];
        for (let i = 0; i < 7; i++) spots.push([22 + (i % 2) * 2, 60 + i * 13, -2.3]);
        for (let i = 0; i < 5; i++) spots.push([-30, 90 + i * 14, 2.4]);
        for (const slot of ['body', 'glass', 'metal']) {
          if (!geos[slot]) continue;
          const mat = mats[slot] || mats.body;
          if (!mat.userData.carrierPatched) {
            mat.userData.carrierPatched = true;
            applyWorldFog(mat);
            csm?.setupMaterial(mat);
          }
          const im = new InstancedMesh(geos[slot], mat, spots.length);
          spots.forEach(([x, z, yaw], k) => {
            m.compose(new Vector3(x, CARRIER.deckY + 2.2, z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw), new Vector3(1, 1, 1));
            im.setMatrixAt(k, m);
          });
          im.castShadow = true;
          im.receiveShadow = true;
          this.group.add(im);
        }
      } catch (e) {
        console.warn('parked jets failed', e);
      }
    }

    // deck edge lights / island lights (small emissive dots)
    const lightMat = new MeshStandardMaterial({ color: 0x000000, emissive: new Color(3, 2.4, 1.4) });
    const lights = new InstancedMesh(new SphereGeometry(0.25, 6, 4), lightMat, 40);
    for (let i = 0; i < 40; i++) {
      const side = i % 2 ? 1 : -1;
      m.makeTranslation(side * (i % 4 < 2 ? 19 : 33), CARRIER.deckY + 0.3, -150 + (i >> 1) * 15);
      lights.setMatrixAt(i, m);
    }
    this.group.add(lights);
    this._steamT = 0;
  }

  _bootTop(mat) {
    // dark red anti-fouling below the waterline, black boot-top band
    return mat;
  }

  /** Place so that the launch point (bow end of cat 1) sits at `bowPoint` heading along `dir` (unit, xz). */
  placeAt(bowPoint, dir) {
    const yaw = Math.atan2(-dir.x, -dir.z);
    this.group.rotation.set(0, yaw, 0);
    const local = new Vector3(CARRIER.catX, 0, CARRIER.catEnd).applyEuler(this.group.rotation);
    this.group.position.set(bowPoint.x - local.x, 0, bowPoint.z - local.z);
    this.group.updateMatrixWorld(true);
  }

  /** World position of a local deck point. */
  deckPoint(x, z, out = new Vector3()) {
    return out.set(x, CARRIER.deckY, z).applyMatrix4(this.group.matrixWorld);
  }

  update(dt, steam = 0) {
    this._steamT += dt;
    if (this.fx && steam > 0 && this._steamT > 0.06) {
      this._steamT = 0;
      const p = this.deckPoint(CARRIER.catX + (Math.random() - 0.5) * 2, CARRIER.catStart - 20 - Math.random() * 60);
      p.y += 0.5;
      this.fx.smokePuff(p, new Vector3(0, 3 + Math.random() * 2, 0), 4 * steam, 1.4);
    }
  }
}
