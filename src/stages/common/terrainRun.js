import { Vector3 } from 'three';
import { CanyonTerrain } from '../../world/terrain/canyonStreamer.js';
import { createTerrainMaterial } from '../../world/terrain/terrainMaterial.js';

const _v = new Vector3();
const _v2 = new Vector3();

/**
 * Streamed rail-space terrain as a stage component (see
 * docs/overhaul/CONTRACTS.md §2.2 / §6). Baseline implementation on top of
 * the canyon streamer: height field, scrape collisions, ground queries.
 * Profiles, corridor swing and obstacles are added by the WORLD stream.
 */
export class TerrainRun {
  constructor(stage, def) {
    this.stage = stage;
    this.game = stage.game;
    this.def = def;
    this.scrapeCd = 0;
  }

  async init() {
    const st = this.stage;
    const g = this.game;
    const q = g.preset;
    this.material = createTerrainMaterial({ res: q.textures === '2k' ? '2k' : '1k', anisotropy: q.anisotropy });
    this.terrain = new CanyonTerrain({ rail: st.rail, def: this.def, quality: q, material: this.material, scene: g.world.scene, csm: g.world.csm });
    st.ctx.groundHeight = (x, z, obj) => this.terrain.heightAtWorld(x, z, obj, st.player.s);
    await Promise.race([this.material.userData.ready, new Promise((r) => setTimeout(r, 15000))]);
    this.terrain.prime(st.player.s);
  }

  preUpdate() {}

  update(dt) {
    const st = this.stage;
    const p = st.player;
    this.terrain.update(p.s, 2);
    this.scrapeCd -= dt;
    if (!p.alive || st.dead) return;
    const h = this.terrain.heightAt(p.s, p.x);
    const clearance = p.pos.y - h;
    if (clearance < 5) {
      const hC = this.terrain.heightAt(p.s, p.x * 0.8);
      if (hC < h - 2) {
        p.x *= 0.96;
        p.vx = -p.vx * 0.4 - Math.sign(p.x) * 20;
      } else {
        p.y += 5 - clearance;
        p.vy = Math.max(p.vy, 12);
      }
      if (this.scrapeCd <= 0) {
        this.scrapeCd = 0.35;
        st.playerHit(clearance < 0 ? st.difficulty.terrain : st.difficulty.terrain * 0.4, 'terrain', p.pos);
        st.fx.hitSparks(p.pos, p.velocity, 26);
        st.fx.smokePuff(_v.copy(p.pos).setY(h + 2), _v2.set(0, 6, 0), 8, 1.4);
        this.game.rig.addTrauma(0.5);
      }
    }
  }

  groundAt(s, x) {
    return this.terrain.heightAt(s, x);
  }

  query(s, x, y) {
    return y - this.terrain.heightAt(s, x);
  }

  safeX() {
    return 0;
  }

  dispose() {
    this.terrain?.dispose();
    this.material?.dispose?.();
  }
}

export function terrainRun(def) {
  return (stage) => new TerrainRun(stage, def);
}
