import { BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { makeTerrainShape } from './profiles.js';
import { buildChunk } from './chunkBuilder.js';
import { makeFrame } from '../../sim/rail.js';

const _f = makeFrame();
const _up = new Vector3(0, 1, 0);
const _rh = new Vector3();
const _p = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();

/** Dense core half-width (m): wide enough that the swinging corridor stays detailed. */
export const INNER_HALF = 340;

/** Lateral sample positions: dense near the corridor, sparse far away. */
export function lateralColumns(half = 2200, inner = INNER_HALF, innerStep = 6, outerCount = 18) {
  const cols = [];
  const n = Math.round((2 * inner) / innerStep);
  for (let i = 0; i <= n; i++) cols.push(-inner + (2 * inner * i) / n);
  const out = [];
  for (let i = 1; i <= outerCount; i++) {
    const t = i / outerCount;
    out.push(inner + (half - inner) * Math.pow(t, 1.6));
  }
  return [...out.map((v) => -v).reverse(), ...cols, ...out];
}

function gridIndex(rows, cols) {
  const idx = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      // rows advance along the rail (forward), columns to the right; CCW seen from above
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = b; idx[k++] = e; idx[k++] = d;
    }
  }
  return new BufferAttribute(idx, 1);
}

/** Terrain def fields the worker needs (structured-clone safe). */
export function shapeDef(def) {
  const { seed, profile, sections, centre, centreMaxSlope, centreMaxOffset, clearance, water, snowLine, river } = def;
  return JSON.parse(JSON.stringify({ seed, profile, sections, centre, centreMaxSlope, centreMaxOffset, clearance, water, snowLine, river }));
}

/**
 * Streams rail-space terrain chunks (any profile) along the stage rail. Near
 * chunks are dense, far chunks use the same columns with fewer rows (no cracks
 * at LOD borders). The corridor centre is baked into each row so the dense
 * columns follow it. Vertex data is generated in a Web Worker (sync fallback).
 *
 * Shadows: only near chunks cast, and the near range reaches past the shadow
 * distance, so the LOD switch never pops a shadow in view.
 *
 * Optional `trees: { geometry, material, density, maxPerChunk }` adds
 * instanced pines to near chunks (positions come from the worker).
 */
export class TerrainStreamer {
  constructor({ rail, def, quality, material, scene, csm = null, trees = null }) {
    this.rail = rail;
    this.def = def;
    this.shape = makeTerrainShape(def);
    this.scene = scene;
    this.material = material;
    csm?.setupMaterial(material);
    const q = quality.name;
    this.chunkLen = 200;
    const innerStep = q === 'low' ? 10 : q === 'medium' ? 8 : 6;
    this.inner = INNER_HALF;
    this.lat = new Float32Array(lateralColumns(2200, INNER_HALF, innerStep, q === 'low' ? 12 : 18));
    this.cols = this.lat.length;
    this.nearRows = Math.round(this.chunkLen / (q === 'low' ? 10 : q === 'medium' ? 8 : 6)) + 1;
    this.farRows = Math.round(this.chunkLen / 25) + 1;
    const shadowFar = quality.shadows > 0 ? quality.shadowFar || 0 : 0;
    this.nearCount = Math.max(9, Math.ceil((shadowFar + 300) / this.chunkLen) + 2);
    this.farCount = q === 'low' ? 18 : 28;
    this.nearIndex = gridIndex(this.nearRows, this.cols);
    this.farIndex = gridIndex(this.farRows, this.cols);
    this.slots = [];
    const mk = (lod) => {
      const rows = lod === 0 ? this.nearRows : this.farRows;
      const n = rows * this.cols;
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aCavity', new BufferAttribute(new Float32Array(n), 1));
      g.setAttribute('aRel', new BufferAttribute(new Float32Array(n), 1));
      g.setIndex(lod === 0 ? this.nearIndex : this.farIndex);
      const mesh = new Mesh(g, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = lod === 0;
      mesh.name = `terrain-${lod}`;
      mesh.matrixAutoUpdate = true;
      scene.add(mesh);
      return { mesh, lod, k: -1, ready: false, pending: false, gen: 0, index: this.slots.length, nearIdx: lod === 0 ? this.slots.length : -1 };
    };
    for (let i = 0; i < this.nearCount; i++) this.slots.push(mk(0));
    for (let i = 0; i < this.farCount; i++) this.slots.push(mk(1));

    // instanced pines on near chunks
    this.trees = null;
    if (trees && trees.density > 0) {
      const per = trees.maxPerChunk || 220;
      const mesh = new InstancedMesh(trees.geometry, trees.material, per * this.nearCount);
      csm?.setupMaterial(trees.material);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.name = 'terrain-trees';
      scene.add(mesh);
      this.trees = { mesh, per, cfg: { density: trees.density, max: per, snowLine: this.shape.snowLine, seed: (def.seed || 1) * 7 + 3 }, height: trees.height || 22 };
    }

    this.gen = 0;
    this.inFlight = 0;
    this.maxInFlight = 3;
    this.worker = null;
    try {
      this.worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onBuilt(e.data);
      this.worker.postMessage({ type: 'init', def: shapeDef(def) });
    } catch (e) {
      console.warn('terrain worker unavailable, building synchronously', e);
      this.worker = null;
    }
  }

  railY(s) {
    return this.rail.positionAt(s, _p).y;
  }

  /** Terrain height (world y) at rail distance s, lateral offset l. */
  heightAt(s, l) {
    return this.shape.heightAt(s, l, this.railY(s));
  }

  /** Ground under (s, l) ignoring walls, mesas and big dunes (movement floor). */
  floorAt(s, l) {
    return this.shape.floorAt(s, l, this.railY(s));
  }

  /** World-space query; `obj` caches its rail distance for fast projection. */
  heightAtWorld(x, z, obj, hintS = 0) {
    _p.set(x, 0, z);
    let s;
    if (obj && obj._railS !== undefined) s = this.rail.project(_p.setY(this.railY(obj._railS)), obj._railS, 260);
    else s = this.rail.project(_p.setY(this.railY(hintS)), hintS, 4000);
    if (obj) obj._railS = s;
    this.rail.frameAt(s, _f);
    _rh.crossVectors(_f.T, _up).normalize();
    const l = (x - _f.pos.x) * _rh.x + (z - _f.pos.z) * _rh.z;
    return this.shape.heightAt(s, l, _f.pos.y);
  }

  _request(slot, k) {
    const rows = slot.lod === 0 ? this.nearRows : this.farRows;
    const s0 = k * this.chunkLen;
    const ds = this.chunkLen / (rows - 1);
    const s = new Float32Array(rows + 2);
    const frames = new Float32Array((rows + 2) * 5);
    for (let r = 0; r < rows + 2; r++) {
      const sr = s0 + (r - 1) * ds;
      s[r] = sr;
      this.rail.frameAt(Math.max(0, sr), _f);
      _rh.crossVectors(_f.T, _up).normalize();
      frames[r * 5] = _f.pos.x + (sr < 0 ? _f.T.x * sr : 0);
      frames[r * 5 + 1] = _f.pos.y;
      frames[r * 5 + 2] = _f.pos.z + (sr < 0 ? _f.T.z * sr : 0);
      frames[r * 5 + 3] = _rh.x;
      frames[r * 5 + 4] = _rh.z;
    }
    const origin = [frames[5], frames[7]];
    slot.pending = true;
    slot.k = k;
    slot.gen = ++this.gen;
    slot.origin = origin;
    const msg = { type: 'build', id: slot.index, gen: slot.gen, rows, cols: this.cols, lat: this.lat, s, frames, origin, inner: this.inner };
    if (this.trees && slot.lod === 0) msg.trees = this.trees.cfg;
    if (this.worker) {
      this.inFlight++;
      this.worker.postMessage(msg);
    } else {
      const res = buildChunk(this.shape, msg);
      this._onBuilt({ id: msg.id, gen: msg.gen, ...res });
    }
  }

  _onBuilt(d) {
    if (this.worker) this.inFlight = Math.max(0, this.inFlight - 1);
    const slot = this.slots[d.id];
    if (!slot || slot.gen !== d.gen) return; // stale
    const g = slot.mesh.geometry;
    g.attributes.position.array.set(d.pos);
    g.attributes.normal.array.set(d.nor);
    g.attributes.aCavity.array.set(d.cav);
    g.attributes.aRel.array.set(d.rel);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.aCavity.needsUpdate = true;
    g.attributes.aRel.needsUpdate = true;
    slot.mesh.position.set(slot.origin[0], 0, slot.origin[1]);
    slot.pending = false;
    slot.ready = true;
    slot.mesh.visible = true;
    if (slot.lod === 0 && this.trees) this._setTrees(slot, d.trees, d.treeCount || 0);
    // hide the far version of the same chunk once the near one is in
    if (slot.lod === 0) {
      for (const o of this.slots) if (o.lod === 1 && o.k === slot.k) o.mesh.visible = false;
    } else if (this._find(0, slot.k, true)) slot.mesh.visible = false;
    this._dirty = true; // re-evaluate lingering far chunks
  }

  _setTrees(slot, data, count) {
    const T = this.trees;
    slot.treeMats ||= new Float32Array(T.per * 16);
    const out = slot.treeMats;
    for (let i = 0; i < count; i++) {
      const o = i * 4;
      const sc = data[o + 3] * T.height;
      _p.set(data[o] + slot.origin[0], data[o + 1], data[o + 2] + slot.origin[1]);
      _q.setFromAxisAngle(_up, (i * 2.399963) % (Math.PI * 2));
      _s.set(sc, sc * (0.9 + (i % 5) * 0.06), sc);
      _m.compose(_p, _q, _s);
      out.set(_m.elements, i * 16);
    }
    slot.treeCount = count;
    this._packTrees();
  }

  _clearTrees(slot) {
    if (!this.trees || slot.lod !== 0) return;
    slot.treeCount = 0;
    this._packTrees();
  }

  /** Pack the trees of every near chunk into one contiguous instance range (no empty instances drawn). */
  _packTrees() {
    const mesh = this.trees.mesh;
    const arr = mesh.instanceMatrix.array;
    let n = 0;
    for (let i = 0; i < this.nearCount; i++) {
      const sl = this.slots[i];
      if (!sl.treeCount) continue;
      arr.set(sl.treeMats.subarray(0, sl.treeCount * 16), n * 16);
      n += sl.treeCount;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Synchronously build everything needed at s (loading screen). */
  prime(s) {
    const w = this.worker;
    this.worker = null;
    this.update(s, Infinity);
    this.worker = w;
  }

  _find(lod, k, readyOnly = false) {
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      if (sl.lod === lod && sl.k === k && (!readyOnly || sl.ready)) return sl;
    }
    return null;
  }

  _free(sl) {
    if (sl.ready) this._clearTrees(sl);
    sl.k = -1;
    sl.ready = false;
    sl.pending = false;
    sl.gen = ++this.gen;
    sl.mesh.visible = false;
  }

  /**
   * Keep near chunks around the player and far chunks beyond. Cheap when
   * nothing changed (called every sim step): work only happens when the
   * player crosses a chunk border or requests are still outstanding.
   */
  update(playerS, budget = 2) {
    const kp = Math.floor(playerS / this.chunkLen);
    if (kp === this._kp && !this._dirty) return;
    this._kp = kp;
    const nearLo = kp - 1, nearHi = kp + this.nearCount - 2;
    const farLo = nearHi + 1, farHi = farLo + this.farCount - 1;
    const maxK = Math.floor((this.rail.length + 400) / this.chunkLen);
    // release chunks that are no longer wanted (far chunks linger until their near replacement is ready)
    for (let i = 0; i < this.slots.length; i++) {
      const sl = this.slots[i];
      if (sl.k < 0) continue;
      let want;
      if (sl.lod === 0) want = sl.k >= nearLo && sl.k <= nearHi;
      else want = (sl.k >= farLo && sl.k <= farHi) || (sl.k >= nearLo && sl.k <= nearHi && !this._find(0, sl.k, true));
      if (!want) this._free(sl);
    }
    let issued = 0;
    let missing = false;
    for (let lod = 0; lod < 2; lod++) {
      const lo = lod === 0 ? nearLo : farLo, hi = lod === 0 ? nearHi : farHi;
      for (let k = Math.max(0, lo); k <= Math.min(hi, maxK); k++) {
        if (this._find(lod, k)) continue;
        if (issued >= budget || (this.worker && this.inFlight >= this.maxInFlight)) {
          missing = true;
          continue;
        }
        let free = null;
        for (let i = 0; i < this.slots.length; i++) {
          const sl = this.slots[i];
          if (sl.lod === lod && sl.k === -1) {
            free = sl;
            break;
          }
        }
        if (!free) {
          missing = true;
          continue;
        }
        this._request(free, k);
        issued++;
      }
    }
    this._dirty = missing || this.inFlight > 0;
  }

  dispose() {
    this.worker?.terminate();
    for (const s of this.slots) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
    if (this.trees) {
      this.scene.remove(this.trees.mesh);
      this.trees.mesh.dispose?.();
    }
  }
}
