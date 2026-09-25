import { Vector3 } from 'three';
import { makeFrame } from '../../sim/rail.js';
import { corridorX, groundPoint, sectionAt } from './util.js';

const _f = makeFrame();
const _v = new Vector3();
const _sec = { width: 0, depth: 0, floor: 0 };

/**
 * Ground sites placed on the banks of a valley / fjord (cue `opts.cue`):
 * each site sits `offset` metres beyond the floor half-width of the terrain
 * section on its side of the (swinging) corridor, never below the water.
 *
 * opts: { cue = 'sites', tag, sites: [{ds (m ahead of the player), side: -1|1, type}],
 *         offset = 100, water = 0 (level, or null) }
 */
export class BankSites {
  constructor(stage, opts) {
    this.stage = stage;
    this.opts = { cue: 'sites', offset: 100, water: 0, ...opts };
  }

  cue(name) {
    const o = this.opts;
    if (name !== o.cue) return;
    const st = this.stage;
    const p = st.player;
    for (const site of o.sites) {
      const s = p.s + site.ds;
      sectionAt(st.def.terrain?.sections, s, _sec);
      const l = corridorX(st, s) + site.side * (_sec.width + o.offset);
      groundPoint(st, s, l, 0, _v);
      if (o.water != null) _v.y = Math.max(_v.y, o.water + 1);
      st.rail.frameAt(s, _f);
      st.enemies.spawn(site.type, {
        behavior: 'static',
        world: { x: _v.x, y: _v.y, z: _v.z },
        heading: Math.atan2(_f.T.x, -_f.T.z) + Math.PI,
        tag: o.tag
      });
    }
  }
}

export const bankSites = (opts) => (stage) => new BankSites(stage, opts);
