// Assembly: the scratch context a design's build() writes into. Collects parts
// per material slot and per node (static root, hinge pivots, named nodes),
// plus gameplay anchor points (nozzles, wingtips, hardpoints, gun port).

import { Vector3 } from 'three';
import { mergeSlot, setGlow, triCount } from './geom.js';
import { ellipsoid } from './loft.js';

export const SLOTS = ['body', 'glass', 'emissive', 'metal'];

function emptyParts() {
  return { body: [], glass: [], emissive: [], metal: [] };
}

const toV = (p) => (p instanceof Vector3 ? p.clone() : new Vector3(p[0], p[1], p[2]));

export class Assembly {
  constructor(id, lod) {
    this.id = id;
    this.lod = lod;
    this.nodes = new Map();
    this.nodes.set('root', { name: 'root', parent: null, origin: new Vector3(), axis: null, deploy: false, parts: emptyParts() });
    this.controls = [];
    this.visibles = [];
    this.nozzles = [];
    this.wingtips = [];
    this.hardpoints = [];
    this.gunPort = new Vector3();
    this.meta = {};
  }

  /** Pick a detail value for the current LOD. */
  L(a, b, c) {
    return this.lod <= 0 ? a : this.lod === 1 ? b : c;
  }

  add(slot, geom, node = 'root') {
    if (!geom) return null;
    const n = this.nodes.get(node);
    if (!n) throw new Error(`assembly ${this.id}: unknown node ${node}`);
    n.parts[slot].push(geom);
    return geom;
  }

  body(g, node) {
    return this.add('body', g, node);
  }
  metal(g, node) {
    return this.add('metal', g, node);
  }
  glass(g, node) {
    return this.add('glass', g, node);
  }
  emissive(g, node) {
    return this.add('emissive', g, node);
  }

  /**
   * Named node (optionally with a rotation axis) - weak points, turrets, rotor
   * heads, gear legs... `deploy: true` marks deployable parts (landing gear)
   * that are excluded from the static gear-up geometry and bounds.
   */
  node(name, origin, { parent = 'root', axis = null, deploy = false } = {}) {
    const ax = axis ? toV(axis).normalize() : null;
    const dep = deploy || !!this.nodes.get(parent)?.deploy;
    this.nodes.set(name, { name, parent, origin: toV(origin), axis: ax, deploy: dep, parts: emptyParts() });
    return name;
  }

  /**
   * Hinge pivot from a line a->b. `prefer` orients the axis so its x (or y/z)
   * component is positive, giving consistent sign conventions left/right:
   * horizontal surfaces ('x'): +angle = trailing edge down; fins ('y'): +angle = TE to +x.
   */
  hinge(name, a, b, { prefer = 'x', parent = 'root' } = {}) {
    const A = toV(a);
    const B = toV(b);
    const axis = B.clone().sub(A).normalize();
    const k = prefer === 'x' ? 'x' : prefer === 'y' ? 'y' : 'z';
    if (axis[k] < 0) axis.negate();
    this.nodes.set(name, { name, parent, origin: A.clone().add(B).multiplyScalar(0.5), axis, deploy: !!this.nodes.get(parent)?.deploy, parts: emptyParts() });
    return name;
  }

  /** Attach a control law: fn(state) -> angle (radians) about the node's axis. */
  control(node, fn) {
    if (this.nodes.has(node)) this.controls.push({ node, fn });
  }

  /** Visibility law: fn(state) -> boolean (e.g. hide retracted gear). */
  visible(node, fn) {
    if (this.nodes.has(node)) this.visibles.push({ node, fn });
  }

  nozzle(pos, radius, dir = [0, 0, 1]) {
    this.nozzles.push({ position: toV(pos), radius, direction: toV(dir).normalize() });
  }

  wingtip(pos, node = 'root') {
    this.wingtips.push({ rest: toV(pos), node });
  }

  hardpoint(pos) {
    this.hardpoints.push(toV(pos));
  }

  gun(pos) {
    this.gunPort = toV(pos);
  }

  /**
   * Small emissive light blob. kind: 0 steady, 1 afterburner, 2 strobe, 3 formation.
   * color in linear RGB.
   */
  light(pos, color, { kind = 0, size = 0.08, node = 'root', stretch = 1 } = {}) {
    const seg = this.lod >= 2 ? 4 : 6;
    const g = ellipsoid(size, size, size * stretch, seg, this.lod >= 2 ? 2 : 3);
    g.translate(pos[0], pos[1], pos[2]);
    setGlow(g, color, kind);
    this.add('emissive', g, node);
  }

  /** Merge parts per node & slot. */
  finalize() {
    const nodes = [];
    let tris = 0;
    for (const n of this.nodes.values()) {
      const geoms = {};
      for (const slot of SLOTS) {
        geoms[slot] = mergeSlot(slot, n.parts[slot]);
        if (!n.deploy) tris += triCount(geoms[slot]);
      }
      nodes.push({ name: n.name, parent: n.parent, origin: n.origin, axis: n.axis, deploy: !!n.deploy, geoms });
    }
    return { nodes, tris };
  }
}
