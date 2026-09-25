import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from 'three';
import { makeCanyonShape } from './canyonShape.js';
import { buildChunk } from './chunkBuilder.js';
import { makeFrame } from '../../sim/rail.js';

const _f = makeFrame();
const _up = new Vector3(0, 1, 0);
const _rh = new Vector3();
const _p = new Vector3();

/** Lateral sample positions: dense near the canyon, sparse far away. */
export function lateralColumns(half = 2200, inner = 300, innerStep = 6, outerCount = 18) {
  const cols = [];
  for (let l = -inner; l <= inner + 1e-6; l += innerStep) cols.push(l);
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

/**
 * Streams canyon terrain chunks along the stage rail. Near chunks are dense,
 * far chunks use the same columns with fewer rows (no cracks at LOD borders).
 * Vertex data is generated in a Web Worker (sync fallback when unavailable).
 */
export class CanyonTerrain {
  constructor({ rail, def, quality, material, scene, csm = null }) {
    this.rail = rail;
    this.def = def;
    this.shape = makeCanyonShape(def);
    this.scene = scene;
    this.material = material;
    csm?.setupMaterial(material);
    const q = quality.name;
    this.chunkLen = 200;
    const innerStep = q === 'low' ? 10 : q === 'medium' ? 8 : 6;
    this.lat = new Float32Array(lateralColumns(2200, 300, innerStep, q === 'low' ? 12 : 18));
    this.cols = this.lat.length;
    this.nearRows = Math.round(this.chunkLen / (q === 'low' ? 10 : q === 'medium' ? 8 : 6)) + 1;
    this.farRows = Math.round(this.chunkLen / 25) + 1;
    this.nearCount = 9;
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
      g.setIndex(lod === 0 ? this.nearIndex : this.farIndex);
      const mesh = new Mesh(g, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = lod === 0;
      mesh.name = `terrain-${lod}`;
      mesh.matrixAutoUpdate = true;
      scene.add(mesh);
      return { mesh, lod, k: -1, ready: false, pending: false, gen: 0 };
    };
    for (let i = 0; i < this.nearCount; i++) this.slots.push(mk(0));
    for (let i = 0; i < this.farCount; i++) this.slots.push(mk(1));
    this.gen = 0;
    this.inFlight = 0;
    this.maxInFlight = 3;
    this.worker = null;
    try {
      this.worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onBuilt(e.data);
      this.worker.postMessage({ type: 'init', def });
    } catch (e) {
      console.warn('terrain worker unavailable, building synchronously', e);
      this.worker = null;
    }
    this._frames = new Float32Array((this.nearRows + 2) * 5);
  }

  railY(s) {
    return this.rail.positionAt(s, _p).y;
  }

  /** Terrain height (world y) at rail distance s, lateral offset l. */
  heightAt(s, l) {
    return this.shape.heightAt(s, l, this.railY(s));
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
    const msg = { type: 'build', id: this.slots.indexOf(slot), gen: slot.gen, rows, cols: this.cols, lat: this.lat, s, frames, origin };
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
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.aCavity.needsUpdate = true;
    slot.mesh.position.set(slot.origin[0], 0, slot.origin[1]);
    slot.pending = false;
    slot.ready = true;
    slot.mesh.visible = true;
    // hide the far version of the same chunk once the near one is in
    if (slot.lod === 0) for (const o of this.slots) if (o.lod === 1 && o.k === slot.k) o.mesh.visible = false;
  }

  /** Synchronously build everything needed at s (loading screen). */
  prime(s) {
    const w = this.worker;
    this.worker = null;
    this.update(s, Infinity);
    this.worker = w;
  }

  update(playerS, budget = 2) {
    const kp = Math.floor(playerS / this.chunkLen);
    const nearSet = [];
    for (let k = kp - 1; k < kp - 1 + this.nearCount; k++) nearSet.push(k);
    const farSet = [];
    for (let k = kp - 1 + this.nearCount; k < kp - 1 + this.nearCount + this.farCount; k++) farSet.push(k);
    let issued = 0;
    const assign = (lod, set) => {
      const slots = this.slots.filter((s) => s.lod === lod);
      // free slots whose chunk is no longer wanted
      for (const sl of slots) {
        if (sl.k >= 0 && !set.includes(sl.k)) {
          sl.k = -1;
          sl.ready = false;
          sl.pending = false;
          sl.gen = ++this.gen;
          sl.mesh.visible = false;
        }
      }
      for (const k of set) {
        if (k < 0 || k * this.chunkLen > this.rail.length + 400) continue;
        if (slots.some((s) => s.k === k)) continue;
        if (issued >= budget || (this.worker && this.inFlight >= this.maxInFlight)) return;
        const free = slots.find((s) => s.k === -1);
        if (!free) return;
        this._request(free, k);
        issued++;
      }
    };
    assign(0, nearSet);
    assign(1, farSet);
    // show far chunks unless their near version is ready
    for (const sl of this.slots) {
      if (sl.lod !== 1 || !sl.ready) continue;
      const nearReady = this.slots.some((o) => o.lod === 0 && o.k === sl.k && o.ready);
      sl.mesh.visible = !nearReady;
    }
  }

  dispose() {
    this.worker?.terminate();
    for (const s of this.slots) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
    }
  }
}
