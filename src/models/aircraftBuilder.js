// Public API for procedural aircraft / vehicle models.
//
//   buildAircraft(id, { lod, scheme })        -> animated Group with pivots (player / hero)
//   buildAircraftGeometry(id, lod)            -> merged static geometry per material (InstancedMesh)
//   createAircraftMaterials(id, scheme, opts) -> cached { body, glass, emissive, metal }
//   buildVehicle(id, opts)                    -> missile / destroyer / samLauncher
//
// Geometry and materials are cached by key and shared between instances.

import { Group, Mesh, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Assembly, SLOTS } from './assembly.js';
import { resolveLivery } from './livery.js';
import { createBodyMaterial, createGlassMaterial, createEmissiveMaterial, createMetalMaterial } from './materials.js';

import f14d from './designs/f14d.js';
import fa18e from './designs/fa18e.js';
import f15e from './designs/f15e.js';
import fighterA from './designs/fighterA.js';
import stealthB from './designs/stealthB.js';
import bomberXB from './designs/bomberXB.js';
import bomberB52 from './designs/bomberB52.js';
import kc10 from './designs/kc10.js';
import heloCH47 from './designs/heloCH47.js';
import missile from './designs/missile.js';
import destroyer from './designs/destroyer.js';
import samLauncher from './designs/samLauncher.js';

export const DESIGNS = { f14d, fa18e, f15e, fighterA, stealthB, bomberXB, bomberB52, kc10, heloCH47, missile, destroyer, samLauncher };

export const AIRCRAFT_IDS = ['f14d', 'fa18e', 'f15e', 'fighterA', 'stealthB', 'bomberXB', 'bomberB52', 'kc10', 'heloCH47'];
export const VEHICLE_IDS = ['missile', 'destroyer', 'samLauncher'];
export const ALL_MODEL_IDS = [...AIRCRAFT_IDS, ...VEHICLE_IDS];
// lockCap: simultaneous missile locks outside Climax (LockOn.max)
export const PLAYER_JETS = [
  { id: 'f14d', name: 'F-14D SUPER TOMCAT', lockCap: 6 },
  { id: 'fa18e', name: 'F/A-18E SUPER HORNET', lockCap: 6 },
  { id: 'f15e', name: 'F-15E STRIKE EAGLE', lockCap: 8 }
];
export const SCHEMES = ['standard', 'camo', 'special', 'lowvis'];
export const ENEMY_SCHEME = 'enemy';
export const LOD_COUNT = 3;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const geoCache = new Map();
const matCache = new Map();

function getDesign(id) {
  const d = DESIGNS[id];
  if (!d) throw new Error(`Unknown model id "${id}"`);
  return d;
}

function clampLod(lod) {
  return Math.min(Math.max(lod | 0, 0), LOD_COUNT - 1);
}

/** Build (or fetch) the finalized per-node geometry for a design & LOD. */
function buildEntry(id, lodIn) {
  const lod = clampLod(lodIn);
  const key = `${id}|${lod}`;
  let e = geoCache.get(key);
  if (e) return e;
  const design = getDesign(id);
  const t0 = now();
  const A = new Assembly(id, lod);
  design.build(A);
  const fin = A.finalize();
  // bounds at rest pose
  let r2 = 0;
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const n of fin.nodes) {
    for (const slot of SLOTS) {
      const g = n.geoms[slot];
      if (!g) continue;
      g.computeBoundingSphere();
      g.computeBoundingBox();
      if (n.deploy) continue; // bounds are gear-up
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i];
        const y = p[i + 1];
        const z = p[i + 2];
        const d = x * x + y * y + z * z;
        if (d > r2) r2 = d;
        if (x < min.x) min.x = x;
        if (y < min.y) min.y = y;
        if (z < min.z) min.z = z;
        if (x > max.x) max.x = x;
        if (y > max.y) max.y = y;
        if (z > max.z) max.z = z;
      }
    }
  }
  e = {
    id,
    lod,
    design,
    nodes: fin.nodes,
    tris: fin.tris,
    radius: Math.max(Math.sqrt(r2), A.meta.radius ?? 0),
    length: max.z - min.z,
    span: max.x - min.x,
    height: max.y - min.y,
    bboxMin: min,
    bboxMax: max,
    nozzles: A.nozzles,
    hardpoints: A.hardpoints,
    wingtips: A.wingtips,
    gunPort: A.gunPort,
    controls: A.controls,
    visibles: A.visibles,
    gearContactY: A.meta.gearContactY ?? null,
    meta: A.meta,
    buildMs: 0,
    static: null
  };
  e.buildMs = now() - t0;
  geoCache.set(key, e);
  return e;
}

function nodePositions(e) {
  const out = {};
  for (const n of e.nodes) if (n.name !== 'root') out[n.name] = n.origin.clone();
  return out;
}

/**
 * Fully merged static geometry (rest pose) per material slot, for InstancedMesh.
 * Returned geometries are cached/shared: do not dispose them.
 */
export function buildAircraftGeometry(id, lod = 1) {
  const e = buildEntry(id, lod);
  if (!e.static) {
    const s = {};
    for (const slot of SLOTS) {
      // gear-up: deployable nodes (landing gear, doors) are left out
      const list = e.nodes.filter((n) => !n.deploy).map((n) => n.geoms[slot]).filter(Boolean);
      s[slot] = list.length === 0 ? null : list.length === 1 ? list[0].clone() : mergeGeometries(list, false);
      if (s[slot]) {
        s[slot].computeBoundingSphere();
        s[slot].computeBoundingBox();
      }
    }
    e.static = s;
  }
  return {
    body: e.static.body,
    glass: e.static.glass,
    emissive: e.static.emissive,
    metal: e.static.metal,
    radius: e.radius,
    length: e.length,
    span: e.span,
    nozzles: e.nozzles.map(cloneNozzle),
    hardpoints: e.hardpoints.map((v) => v.clone()),
    wingtips: e.wingtips.map((w) => w.rest.clone()),
    gunPort: e.gunPort.clone(),
    gearContactY: e.gearContactY,
    nodes: nodePositions(e),
    triangles: e.tris
  };
}

function cloneNozzle(n) {
  return { position: n.position.clone(), radius: n.radius, direction: n.direction.clone() };
}

function heatRange(id) {
  const design = getDesign(id);
  if (design.livery?.heat) return design.livery.heat;
  const e = buildEntry(id, 2);
  if (!e.nozzles.length) return [1e5, 1e5 + 1];
  let z = -Infinity;
  let r = 0;
  for (const n of e.nozzles) {
    z = Math.max(z, n.position.z);
    r = Math.max(r, n.radius);
  }
  return [z - r * 3.5, z];
}

/** Cached materials for a design + scheme. `instanced` builds lighter shader variants. */
export function createAircraftMaterials(id, scheme, { instanced = false } = {}) {
  const design = getDesign(id);
  const sch = scheme || design.defaultScheme;
  const key = `${id}|${sch}|${instanced ? 1 : 0}`;
  let m = matCache.get(key);
  if (m) return m.materials;
  const liv = resolveLivery(design, sch);
  const materials = {
    body: createBodyMaterial(liv, design.decals || [], { instanced }),
    glass: createGlassMaterial({ instanced, tint: design.glassTint }),
    emissive: createEmissiveMaterial(),
    metal: createMetalMaterial({ heat: heatRange(id), tint: design.metalTint })
  };
  for (const [k, mat] of Object.entries(materials)) mat.name = `${id}:${sch}:${k}`;
  m = { materials, refs: 0 };
  matCache.set(key, m);
  return materials;
}

function acquireMaterials(id, scheme) {
  const design = getDesign(id);
  const sch = scheme || design.defaultScheme;
  const mats = createAircraftMaterials(id, sch, { instanced: false });
  const key = `${id}|${sch}|0`;
  matCache.get(key).refs++;
  return { mats, key };
}

function releaseMaterials(key) {
  const m = matCache.get(key);
  if (!m) return;
  m.refs--;
  if (m.refs <= 0) {
    for (const mat of Object.values(m.materials)) mat.dispose();
    matCache.delete(key);
  }
}

const ZERO = new Vector3();

function instantiate(id, { lod = 0, scheme } = {}) {
  const t0 = now();
  const e = buildEntry(id, lod);
  const { mats, key } = acquireMaterials(id, scheme);
  const root = new Group();
  root.name = id;
  const groups = new Map();
  const origins = new Map();
  groups.set('root', root);
  origins.set('root', ZERO);
  for (const n of e.nodes) {
    let g = root;
    if (n.name !== 'root') {
      g = new Group();
      g.name = n.name;
      const parent = groups.get(n.parent) || root;
      const po = origins.get(n.parent) || ZERO;
      g.position.copy(n.origin).sub(po);
      parent.add(g);
      groups.set(n.name, g);
      origins.set(n.name, n.origin);
    }
    for (const slot of SLOTS) {
      const geo = n.geoms[slot];
      if (!geo) continue;
      const mesh = new Mesh(geo, mats[slot]);
      mesh.name = `${n.name}:${slot}`;
      if (n.name !== 'root') mesh.position.copy(n.origin).negate();
      mesh.castShadow = slot !== 'emissive';
      mesh.receiveShadow = slot === 'body' || slot === 'metal';
      g.add(mesh);
    }
  }
  const byName = new Map(e.nodes.map((n) => [n.name, n]));
  const controls = e.controls
    .filter((c) => groups.has(c.node) && byName.get(c.node).axis)
    .map((c) => ({ group: groups.get(c.node), axis: byName.get(c.node).axis, fn: c.fn }));
  const vis = e.visibles.filter((v) => groups.has(v.node)).map((v) => ({ group: groups.get(v.node), fn: v.fn }));
  const tips = e.wingtips.map((w) => ({
    rest: w.rest,
    out: w.rest.clone(),
    group: groups.get(w.node) || root,
    origin: origins.get(w.node) || ZERO
  }));
  const wingtips = tips.map((t) => t.out);
  const abU = mats.emissive.userData.uniforms.uAfterburner;
  const EMPTY = {};

  function animate(state = EMPTY) {
    for (let i = 0; i < controls.length; i++) {
      const c = controls[i];
      c.group.quaternion.setFromAxisAngle(c.axis, c.fn(state) || 0);
    }
    for (let i = 0; i < vis.length; i++) vis[i].group.visible = !!vis[i].fn(state);
    for (let i = 0; i < tips.length; i++) {
      const t = tips[i];
      if (t.group === root) continue;
      t.out.copy(t.rest).sub(t.origin).applyQuaternion(t.group.quaternion).add(t.origin);
    }
    if (state.afterburner !== undefined) abU.value = state.afterburner;
  }

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    releaseMaterials(key);
  }

  animate(EMPTY);
  const nodes = {};
  for (const [k, g] of groups) if (k !== 'root') nodes[k] = g;
  return {
    id,
    lod: e.lod,
    scheme: scheme || e.design.defaultScheme,
    root,
    materials: mats,
    nozzles: e.nozzles.map(cloneNozzle),
    wingtips,
    hardpoints: e.hardpoints.map((v) => v.clone()),
    gunPort: e.gunPort.clone(),
    radius: e.radius,
    length: e.length,
    span: e.span,
    height: e.height,
    gearContactY: e.gearContactY,
    nodes,
    triangles: e.tris,
    buildMs: now() - t0 + e.buildMs,
    animate,
    dispose
  };
}

/** Animated aircraft instance (see module header). */
export function buildAircraft(id, opts = {}) {
  if (!AIRCRAFT_IDS.includes(id)) throw new Error(`buildAircraft: "${id}" is not an aircraft id`);
  return instantiate(id, opts);
}

/** Missile / destroyer / SAM launcher - same return shape as buildAircraft. */
export function buildVehicle(id, opts = {}) {
  if (!VEHICLE_IDS.includes(id)) throw new Error(`buildVehicle: "${id}" is not a vehicle id`);
  return instantiate(id, opts);
}

/** Design metadata (name, kind, default scheme, available schemes). */
export function getModelInfo(id) {
  const d = getDesign(id);
  return { id: d.id, name: d.name, kind: d.kind, defaultScheme: d.defaultScheme, schemes: Object.keys(d.schemes || {}) };
}

/** Drop every cached geometry / material (e.g. on hot reload). */
export function clearModelCache() {
  for (const e of geoCache.values()) {
    for (const n of e.nodes) for (const slot of SLOTS) n.geoms[slot]?.dispose();
    if (e.static) for (const slot of SLOTS) e.static[slot]?.dispose();
  }
  geoCache.clear();
  for (const m of matCache.values()) for (const mat of Object.values(m.materials)) mat.dispose();
  matCache.clear();
}

/** Build every design at the given LOD; returns per-id timing (ms) and tri counts. */
export function prebuildAll(lod = 0, ids = ALL_MODEL_IDS) {
  const out = {};
  for (const id of ids) {
    const t0 = now();
    const e = buildEntry(id, lod);
    out[id] = { ms: now() - t0, tris: e.tris };
  }
  return out;
}
