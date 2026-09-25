import { Vector3 } from 'three';
import { TerrainStreamer } from '../../world/terrain/terrainStreamer.js';
import { createTerrainMaterial } from '../../world/terrain/terrainMaterial.js';
import { ObstacleField, createPropMaterial, pineGeometry } from '../../world/terrain/obstacles.js';
import { OCEAN_PRESETS } from '../../world/ocean.js';
import { clamp } from '../../core/math.js';

const _v = new Vector3();
const _v2 = new Vector3();

/** Player collision radius (m). */
const PR = 6;
/** Vertical clearance below which the jet scrapes the terrain (m). */
const SCRAPE = 5;
/** Terrain rising under the jet faster than this (m/s) is a head-on crash, not a scrape. */
const HEADON_RISE = 80;
/** Collision look-ahead for CAUTION / PULL UP (s). */
const CAUTION_T = 1.2;

/** Calm turquoise river, used when the stage env has no ocean and LOOK's preset is missing. */
export const RIVER_FALLBACK = {
  color: [0.01, 0.15, 0.16],
  scatter: [0.04, 0.42, 0.38],
  roughness: 0.04,
  amp: 0.22,
  waves: [
    [1.0, 0.25, 0.12, 60],
    [0.8, 0.55, 0.1, 31],
    [0.3, -0.9, 0.1, 17],
    [-0.6, 0.8, 0.08, 9],
    [0.9, -0.2, 0.08, 5.3],
    [-0.2, 1.0, 0.06, 3.1]
  ],
  detail: 0.35,
  foam: 0.1
};

const DEFAULT_PALETTE = { canyon: 'desertRed', valley: 'emerald', dunes: 'dunes' };

/**
 * Streamed rail-space terrain as a stage component (docs/overhaul/CONTRACTS.md
 * §2.2 / §6): profile height field with a swinging corridor, palette material,
 * instanced obstacles and trees, collisions (scrape / head-on), CAUTION and
 * PULL UP prediction, the autopilot corridor hint and ground queries.
 *
 * Coordinates: s = rail distance, x = rail-space lateral offset (like
 * player.x), y = world altitude (like player.pos.y / groundAt()).
 */
export class TerrainRun {
  constructor(stage, def) {
    this.stage = stage;
    this.game = stage.game;
    this.def = def || {};
    this.scrapeCd = 0;
    this.hitCd = 0;
    this.lookahead = 0.7; // s of flight ahead for the autopilot hint
    this._hit = { d: Infinity, part: null };
    this._iv = [];
    this._cautionOn = { terrain: false, pullup: false };
    this._cautionHold = { terrain: 0, pullup: 0 };
    this._evt = { kind: 'terrain', on: false };
    this._predStep = 0;
    this._hintY = false;
    /** Last contact (debug / tuning): { what: 'wall' | 'ground' | part role, s, x, crash } */
    this.lastHit = { what: null, s: 0, x: 0, crash: false };
  }

  _noteHit(what, crash) {
    const h = this.lastHit, p = this.stage.player;
    h.what = what;
    h.s = p.s;
    h.x = p.x;
    h.crash = crash;
  }

  async init() {
    const st = this.stage;
    const g = this.game;
    const q = g.preset;
    const def = this.def;
    const profile = def.profile || 'canyon';
    this.material = createTerrainMaterial({
      res: q.textures === '2k' ? '2k' : '1k',
      anisotropy: q.anisotropy,
      palette: def.palette || DEFAULT_PALETTE[profile] || 'desertRed',
      snowLine: def.snowLine ?? 260,
      waterLevel: def.water ? (def.water.level ?? 0) : null
    });
    const wantTrees = def.trees && def.trees.density > 0 && q.name !== 'low';
    const needProps = wantTrees || (def.obstacles || []).some((o) => ['tower', 'bridge'].includes(o.kind) || (o.kinds || []).some((k) => k === 'tower' || k === 'bridge'));
    if (needProps) this.propMaterial = createPropMaterial();
    if (wantTrees) this.treeMaterial = createPropMaterial({ roughness: 0.92, metalness: 0 });
    this.streamer = new TerrainStreamer({
      rail: st.rail,
      def,
      quality: q,
      material: this.material,
      scene: g.world.scene,
      csm: g.world.csm,
      trees: wantTrees ? { geometry: pineGeometry(), material: this.treeMaterial, density: def.trees.density, maxPerChunk: q.name === 'medium' ? 180 : 260 } : null
    });
    /** @deprecated alias kept for code written against the baseline stub */
    this.terrain = this.streamer;
    this.shape = this.streamer.shape;
    const range = (this.streamer.nearCount + this.streamer.farCount - 2) * this.streamer.chunkLen;
    this.obstacles = def.obstacles && def.obstacles.length
      ? new ObstacleField({ def, shape: this.shape, rail: st.rail, scene: g.world.scene, rockMaterial: this.material, propMaterial: this.propMaterial || this.material, csm: g.world.csm, boxX: st.def?.rail?.box?.x ?? st.player.box.x ?? 200, range })
      : null;
    this._setupWater();
    st.ctx.groundHeight = (x, z, obj) => this.streamer.heightAtWorld(x, z, obj, st.player.s);
    st.hudExtra.caution = null;
    await Promise.race([this.material.userData.ready, new Promise((r) => setTimeout(r, 15000))]);
    this.streamer.prime(st.player.s);
    this.obstacles?.update(st.player.s);
  }

  _setupWater() {
    const w = this.def.water;
    if (!w) return;
    const g = this.game;
    const world = g.world;
    if ((w.level ?? 0) !== 0) console.warn('terrain water.level must be 0 (the world ocean plane); set section floors relative to it');
    if (!world.ocean || !world.ocean.mesh.visible) {
      world.configure({ ...world.env, ocean: OCEAN_PRESETS[w.preset] ? w.preset : RIVER_FALLBACK });
    }
    if (!this.stage.ctx.seaHeight && world.ocean) this.stage.ctx.seaHeight = (x, z) => world.ocean.heightAt(x, z, g.clock.worldTime);
  }

  // ------------------------------------------------------------------ queries
  railY(s) {
    return this.streamer.railY(s);
  }

  /** Full terrain height (world y) at rail-space (s, x). */
  heightAt(s, x) {
    return this.streamer.heightAt(s, x);
  }

  /** Movement floor under (s, x): ground ignoring walls / mesas / big dunes, never below the water. */
  floorAt(s, x) {
    const f = this.streamer.floorAt(s, x);
    const wl = this.shape.waterLevel;
    return wl != null ? Math.max(f, wl) : f;
  }

  /**
   * Terrain height under a rail-space point (world y), water surface included.
   * For the player's own position (StageState._limits) it returns the movement
   * floor instead, so walls are collisions rather than a lift that carries the
   * jet up the cliff.
   */
  groundAt(s, x) {
    const p = this.stage.player;
    if (p && s === p.s && x === p.x) return this.floorAt(s, x);
    const h = this.heightAt(s, x);
    const wl = this.shape.waterLevel;
    return wl != null ? Math.max(h, wl) : h;
  }

  /** Signed clearance (m) from (s, x, world y) to the nearest terrain / obstacle surface. */
  query(s, x, y) {
    const e = 2;
    const h = this.heightAt(s, x);
    const gx = (this.heightAt(s, x + e) - this.heightAt(s, x - e)) / (2 * e);
    const gs = (this.heightAt(s + e, x) - h) / e;
    let d = (y - h) / Math.sqrt(1 + gx * gx + gs * gs);
    if (this.obstacles) d = Math.min(d, this.obstacles.query(s, x, y));
    return d;
  }

  /** Reachable corridor [xa, xb] at s (walls minus a margin, player box). */
  _corridor(s, out) {
    const c = this.shape.centreAt(s);
    const fw = Math.min(this.shape.flyableHalfWidth(s), 400);
    const bx = Math.max(20, (this.stage.player?.box?.x ?? 200) - 12);
    const m = PR + 12;
    out[0] = Math.max(c - fw + m, -bx);
    out[1] = Math.min(c + fw - m, bx);
    if (out[0] > out[1]) out[0] = out[1] = clamp(c, -bx, bx);
    return c;
  }

  /**
   * Lateral offset of the free corridor at s for world altitude y: the corridor
   * centre, or — when an obstacle stands anywhere in [from, s + 30] (default
   * from = s − 30) — the best gap beside the first one, so a hint aimed ahead of
   * the jet never steers it back into an obstacle it has not passed yet.
   * `prefer` (e.g. the jet's current x) favours the reachable gap and keeps the
   * choice stable while passing.
   */
  safeX(s, y, from = s - 30, prefer = null) {
    const cor = this._cor || (this._cor = [0, 0]);
    const ob = this.obstacles;
    const so = ob ? ob.nextBlocking(Math.min(from, s), s + 30, y) : null;
    if (so != null) {
      const c = this._corridor(so, cor);
      const iv = ob.freeIntervalsIn(so - 25, so + 25, y, cor[0], cor[1], this._iv);
      const need = PR + 10;
      const pr = prefer ?? c;
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < iv.length; i += 2) {
        const a = iv[i], b = iv[i + 1];
        if (b - a < 2 * need) continue;
        const x = clamp(c, a + need, b - need);
        const score = (b - a) * 0.2 - Math.abs(x - c) * 0.5 - Math.abs(x - pr);
        if (score > bestScore) {
          bestScore = score;
          best = x;
        }
      }
      if (best != null) return best;
    }
    const c = this._corridor(s, cor);
    return clamp(c, cor[0], cor[1]);
  }

  // ------------------------------------------------------------------ steps
  preUpdate() {
    const st = this.stage;
    const p = st.player;
    this.streamer.update(p.s, 2);
    this.obstacles?.update(p.s);
    const hint = st.autopilotHint;
    if (!hint || !p.alive) return;
    const la = p.s + Math.max(120, p.speed * this.lookahead);
    const ry = this.railY(la);
    hint.x = this.safeX(la, ry + p.y, p.s + 4, p.x);
    // arch beams / bridge decks ahead: aim under them
    let yT = null;
    if (this.obstacles) {
      const P = this.obstacles.parts;
      for (let i = this.obstacles.firstIndex(p.s, 0); i < P.length; i++) {
        const q = P[i];
        if (q.s0 > la + 60) break;
        if (q.type !== 'box' || q.s1 < p.s) continue;
        const under = q.y0 - 16 - this.railY((q.s0 + q.s1) / 2);
        if (p.y > under - 4) yT = yT == null ? under : Math.min(yT, under);
      }
    }
    if (yT != null) {
      hint.y = yT;
      this._hintY = true;
    } else if (this._hintY) {
      hint.y = null;
      this._hintY = false;
    }
  }

  update(dt) {
    const st = this.stage;
    const p = st.player;
    this.scrapeCd -= dt;
    this.hitCd -= dt;
    this._cautionHold.terrain -= dt;
    this._cautionHold.pullup -= dt;
    if (!p.alive || st.dead || st.finished) {
      this._setCaution('terrain', false);
      this._setCaution('pullup', false);
      return;
    }
    const s = p.s, x = p.x, y = p.pos.y;
    const h = this.heightAt(s, x);
    const clr = y - h;
    const hit = this.obstacles ? this.obstacles.nearest(s, x, y, this._hit, 40) : null;
    if (hit && hit.d < PR) this._obstacleHit(hit);
    else if (clr < SCRAPE) this._terrainHit(h, clr);
    if ((this._predStep = (this._predStep + 1) % 2) === 0) this._predict();
  }

  _scrapeDamage() {
    return this.game.settings?.difficulty === 'easy' ? 3 : 4;
  }

  _crash(what) {
    const st = this.stage;
    const p = st.player;
    this._noteHit(what, true);
    if (this.hitCd <= 0 && !(p.invuln > 0)) {
      st.playerHit(st.difficulty?.terrain ?? 25, 'terrain', p.pos);
      p.invuln = Math.max(p.invuln, 1);
      this.hitCd = 1;
      st.fx.hitSparks?.(p.pos, p.velocity, 60);
      st.fx.smokePuff?.(_v.copy(p.pos), _v2.set(0, 8, 0), 12, 1.6);
      this.game.rig?.addTrauma(0.85);
    }
  }

  _scrape(pos, what) {
    const st = this.stage;
    const p = st.player;
    this._noteHit(what, false);
    if (this.scrapeCd > 0) return;
    this.scrapeCd = 0.35;
    if (!(p.invuln > 0)) st.playerHit(this._scrapeDamage(), 'terrain', p.pos);
    st.fx.hitSparks?.(pos, p.velocity, 26);
    st.fx.smokePuff?.(_v.copy(pos), _v2.set(0, 6, 0), 8, 1.4);
    this.game.rig?.addTrauma(0.4);
  }

  /** Nearest lateral position (toward `dir` first) where the jet is clear of terrain and obstacles. */
  _escapeX(s, y, dir) {
    const bx = this.stage.player.box.x;
    for (let pass = 0; pass < 2; pass++) {
      const d = (dir || 1) * (pass ? -1 : 1);
      for (let k = 1; k <= 40; k++) {
        const xx = this.stage.player.x + d * k * 3;
        if (Math.abs(xx) > bx) break;
        if (y - this.heightAt(s, xx) < SCRAPE + 6) continue;
        if (this.obstacles && this.obstacles.query(s, xx, y) < PR + 3) continue;
        return xx;
      }
    }
    return clamp(this.safeX(s, y), -bx, bx);
  }

  _terrainHit(h, clr) {
    const p = this.stage.player;
    const s = p.s, x = p.x;
    const e = 2;
    const gx = (this.heightAt(s, x + e) - this.heightAt(s, x - e)) / (2 * e);
    const gs = (this.heightAt(s + 3, x) - h) / 3;
    const rise = gs * p.speed + gx * p.vx - p.vy; // how fast the surface climbs relative to the jet
    const steep = Math.abs(gx) > 0.9;
    const dir = steep ? -Math.sign(gx) : 0;
    _v.copy(p.pos).setY(h + 1.5);
    if ((clr < 0 && rise > HEADON_RISE) || clr < -8) {
      this._crash(steep ? 'wall' : 'ground');
      if (steep) {
        p.x = this._escapeX(s, p.pos.y, dir);
        p.vx = dir * 80;
      } else {
        p.y += SCRAPE + 4 - clr;
        p.vy = Math.max(p.vy, 30);
      }
      return;
    }
    this._scrape(_v, steep ? 'wall' : 'ground');
    if (steep) {
      p.x += dir * Math.min(5, (SCRAPE - clr) / Math.max(Math.abs(gx), 0.5));
      p.vx = dir * Math.max(25, Math.abs(p.vx) * 0.4);
    } else {
      p.y += SCRAPE - clr;
      p.vy = Math.max(p.vy, 12);
    }
  }

  _obstacleHit(hit) {
    const p = this.stage.player;
    const q = hit.part;
    const pen = PR - hit.d;
    if (q.type === 'cyl') {
      const ddx = p.x - q.x;
      let dir = Math.sign(ddx);
      if (!dir) dir = this.safeX(p.s, p.pos.y) >= q.x ? 1 : -1;
      const r = Math.max(q.r, q.rTop);
      const central = Math.abs(ddx) < (r + PR) * 0.7;
      _v.copy(p.pos);
      if (central) {
        this._crash(q.role);
        let nx = q.x + dir * (r + PR + 4);
        if (Math.abs(nx) > p.box.x) nx = q.x - dir * (r + PR + 4);
        p.x = clamp(nx, -p.box.x, p.box.x);
        p.vx = Math.sign(p.x - q.x) * 70;
      } else {
        this._scrape(_v, q.role);
        p.x += dir * pen;
        p.vx = dir * Math.max(30, Math.abs(p.vx) * 0.5);
      }
      return;
    }
    // beam / deck: vertical push-out
    const mid = (q.y0 + q.y1) / 2;
    const below = p.pos.y < mid;
    const overlap = Math.min(p.pos.y + PR - q.y0, q.y1 - (p.pos.y - PR));
    _v.copy(p.pos);
    if (overlap > 7) this._crash(q.role);
    else this._scrape(_v, q.role);
    const target = below ? q.y0 - PR - 1.5 : q.y1 + PR + 1.5;
    p.y += target - p.pos.y;
    p.vy = below ? Math.min(p.vy, -20) : Math.max(p.vy, 20);
  }

  _predict() {
    const st = this.stage;
    const p = st.player;
    const shape = this.shape;
    let tHit = Infinity, kind = null;
    for (let i = 1; i <= 8; i++) {
      const t = (i / 8) * CAUTION_T;
      const ss = p.s + p.speed * t;
      const xx = clamp(p.x + p.vx * t, -p.box.x, p.box.x);
      const ry = this.railY(ss);
      const yy = ry + p.y + p.vy * t;
      const hh = shape.heightAt(ss, xx, ry);
      if (yy - hh < 3) {
        const ff = shape.floorAt(ss, xx, ry);
        kind = hh - ff < 3 ? 'pullup' : 'terrain';
        tHit = t;
        break;
      }
      if (this.obstacles && this.obstacles.query(ss, xx, yy) < PR + 2) {
        kind = 'terrain';
        tHit = t;
        break;
      }
    }
    if (kind) this._cautionHold[kind] = 0.5;
    const hold = this._cautionHold;
    this._setCaution('terrain', hold.terrain > 0);
    this._setCaution('pullup', hold.pullup > 0);
    st.hudExtra.caution = this._cautionOn.pullup ? 'PULL UP' : this._cautionOn.terrain ? 'CAUTION' : null;
    this.cautionT = tHit;
  }

  _setCaution(kind, on) {
    if (this._cautionOn[kind] === on) return;
    this._cautionOn[kind] = on;
    const st = this.stage;
    if (!on && !this._cautionOn.terrain && !this._cautionOn.pullup && st.hudExtra) st.hudExtra.caution = null;
    this._evt.kind = kind;
    this._evt.on = on;
    st.events?.emit('caution', this._evt);
  }

  dispose() {
    this.streamer?.dispose();
    this.obstacles?.dispose();
    this.material?.dispose?.();
    this.propMaterial?.dispose?.();
    this.treeMaterial?.dispose?.();
    if (this.stage.hudExtra) this.stage.hudExtra.caution = null;
  }
}

/** Factory for compose(): `terrainRun(def.terrain)` → (stage) => TerrainRun. */
export function terrainRun(def) {
  return (stage) => new TerrainRun(stage, def);
}
