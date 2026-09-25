import { Vector3 } from 'three';
import { CanyonTerrain } from '../world/terrain/canyonStreamer.js';
import { createTerrainMaterial } from '../world/terrain/terrainMaterial.js';
import { makeFrame } from '../sim/rail.js';
import { clamp, dampTo } from '../core/math.js';
import { TARGET_S, CANYON } from './stage2_canyon.js';

const _f = makeFrame();
const _v = new Vector3();
const _v2 = new Vector3();
const _up = new Vector3(0, 1, 0);

/**
 * Stage 2: streamed canyon terrain + collisions, radar ceiling (fly high and
 * the SAM sites light you up), time-to-target clock, pop-up strike with
 * automatic slow motion, and a high-G pull-out through a SAM volley.
 */
export class Stage2Logic {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.hud = { hideCombat: false, hideGauges: false, timer: null };
    this.radarWarning = null;
    this.radarT = 0;
    this.samCd = 0;
    this.scrapeCd = 0;
    this.timeToTarget = 150; // 2:30 from entering the canyon
    this.clockRunning = false;
    this.struck = false;
    this.gOverride = 0;
  }

  async init() {
    const st = this.stage;
    const g = this.game;
    const q = g.preset;
    this.material = createTerrainMaterial({ res: q.textures === '2k' ? '2k' : '1k', anisotropy: q.anisotropy });
    this.terrain = new CanyonTerrain({ rail: st.rail, def: st.def.terrain, quality: q, material: this.material, scene: g.world.scene, csm: g.world.csm });
    // collision / placement callbacks used by the simulation
    st.ctx.groundHeight = (x, z, obj) => this.terrain.heightAtWorld(x, z, obj, st.player.s);
    this.groundAt = (s, l) => this.terrain.heightAt(s, l);
    // wait for the textures to download before compiling shaders
    await Promise.race([this.material.userData.ready, new Promise((r) => setTimeout(r, 15000))]);
    // locate the bottom of the dive on the real (arc-length) rail and retime the strike cues
    let best = TARGET_S, bestY = Infinity;
    for (let s = TARGET_S - 600; s < TARGET_S + 900; s += 10) {
      const y = st.rail.positionAt(s, _v).y;
      if (y < bestY - 0.01) {
        bestY = y;
        best = s;
      }
    }
    this.targetS = best - 150; // middle of the low pass over the basin
    const retime = { strikeTarget: -1900, strike: -1050, pullup: 230 };
    for (const ev of st.director.distEvents) if (ev.cue && retime[ev.cue] != null) ev.at = this.targetS + retime[ev.cue];
    st.director.distEvents.sort((a, b) => a.at - b.at);
    this.terrain.prime(st.player.s);
  }

  preUpdate(dt) {
    const st = this.stage;
    const p = st.player;
    // movement box: follow the canyon walls, tall box so the ceiling can be busted
    const fw = this.terrain.shape.flyableHalfWidth(p.s);
    const bx = Number.isFinite(fw) ? clamp(fw - 16, 26, 75) : 75;
    p.box.x = dampTo(p.box.x, bx, 3, dt);
    p.box.y = p.s > CANYON.from - 400 && p.s < CANYON.to ? 58 : 40;
    p.boxCenterY = p.s > CANYON.from - 400 && p.s < CANYON.to ? 16 : 0;
    if (this.gOverride > 0) {
      this.gOverride -= dt;
      p.gLoad = Math.max(p.gLoad, 8.5);
    }
  }

  update(dt, wdt) {
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    this.terrain.update(p.s, 2);

    // --- terrain collision: scrape floors and walls
    this.scrapeCd -= dt;
    if (p.alive && !st.dead) {
      const h = this.terrain.heightAt(p.s, p.x);
      const clearance = p.pos.y - h;
      if (clearance < 5) {
        // push back toward the centreline / up
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
          st._playerHit(clearance < 0 ? st.difficulty.terrain : st.difficulty.terrain * 0.4, 'terrain', p.pos);
          st.fx.hitSparks(p.pos, p.velocity, 26);
          st.fx.smokePuff(_v.copy(p.pos).setY(h + 2), _v2.set(0, 6, 0), 8, 1.4);
          g.rig.addTrauma(0.5);
        }
      }
    }

    // --- radar ceiling
    const rc = st.def.radarCeiling;
    this.radarWarning = null;
    if (rc && p.s > rc.from && p.s < rc.to && p.alive) {
      const floor = this.terrain.heightAt(p.s, 0);
      const agl = p.pos.y - floor;
      if (agl > rc.agl) {
        this.radarT += dt;
        this.radarWarning = this.radarT > 1 ? 'RADAR LOCK — GET LOW!' : 'RADAR CEILING';
        if (this.radarT > 1.2) {
          this.samCd -= dt;
          if (this.samCd <= 0) {
            this.samCd = 2.3;
            this._samFromRim();
            if (!this._ceilingRadio) {
              this._ceilingRadio = true;
              st._radio('r.s2.ceiling');
            }
          }
        }
      } else {
        this.radarT = Math.max(0, this.radarT - dt * 2);
        this.samCd = Math.max(this.samCd, 0.6);
      }
    }

    // --- time to target
    if (!this.clockRunning && p.s > CANYON.from) this.clockRunning = true;
    if (this.clockRunning && !this.struck) this.timeToTarget = Math.max(0, this.timeToTarget - wdt);
    this.hud.timer = this.clockRunning && !this.struck ? { label: 'TIME TO TARGET', value: this.timeToTarget } : null;
    if (this.clockRunning && !this.struck && this.timeToTarget <= 0 && !this._late) {
      this._late = true;
      st.hud.message('TIME OVER', { sub: 'TARGET DEFENCES ALERTED', color: '#ff5a4a' });
      st.enemies.difficulty.fireRate *= 1.6;
    }
  }

  /** Enemy SAM launched from the canyon rim ahead of the player. */
  _samFromRim() {
    const st = this.stage;
    const p = st.player;
    const s = p.s + 900 + st.rng.next() * 700;
    const side = st.rng.sign();
    const sec = this.terrain.shape.sectionAt(s);
    const l = side * (sec.width + sec.depth * 0.5 + 40);
    st.rail.frameAt(s, _f);
    _v2.crossVectors(_f.T, _up).normalize();
    _v.copy(_f.pos).addScaledVector(_v2, l);
    _v.y = this.terrain.heightAt(s, l) + 4;
    st.fx.smokePuff(_v, _v2.set(0, 20, 0), 12, 2);
    const vel = _v2.subVectors(p.pos, _v).normalize().multiplyScalar(180);
    st.missiles.launch('enemy', _v, vel, p, { speedBonus: 60 });
  }

  cue(name) {
    const st = this.stage;
    const g = this.game;
    if (name === 'strikeTarget') {
      // the fortified target in the basin
      st.rail.frameAt(this.targetS, _f);
      const e = st.enemies.spawn('target', {
        behavior: 'static',
        world: { x: _f.pos.x, y: this.terrain.heightAt(this.targetS, 0) + 1, z: _f.pos.z },
        heading: Math.atan2(_f.T.x, -_f.T.z),
        tag: 'strike',
        countable: false,
        hpMul: 1
      });
      this.target = e;
      st.director.eo = null;
      st.director._eoStart({ id: 's2_strike', title: 'DESTROY THE TARGET', kind: 'destroy', tags: ['strike'], count: 1, bonus: 100000 }, st.player);
      if (e) st.director.eo.remaining = 1;
    } else if (name === 'popup') {
      g.rig.fovKick = 6;
      st.hud.message('POP UP!', { dur: 1.6, color: '#ffd27a' });
    } else if (name === 'strike') {
      // Maverick-style strike: time slows as the target fills the sight
      st.climax.gauge = Math.max(st.climax.gauge, 1);
      st._activateClimax();
      st.hud.message('STRIKE!', { sub: 'LOCK ON AND FIRE', dur: 2.2, color: '#ff8a4a', style: 'center' });
    } else if (name === 'pullup') {
      this.struck = true;
      this.gOverride = 3.2;
      g.rig.addTrauma(0.6);
      g.audio?.play('gLoad');
      if (this.target && !this.target.dead && this.target.active) st.director.failEO();
      else st._radio('r.s2.hit');
      // SAM volley from the basin
      for (let i = 0; i < 4; i++) st.schedule(0.4 + i * 0.55, () => this._samVolley());
    }
  }

  _samVolley() {
    const st = this.stage;
    if (!st.player.alive || st.finished) return;
    const p = st.player;
    for (let k = 0; k < 2; k++) {
      const s = p.s + st.rng.range(-600, 900);
      const l = st.rng.range(-900, 900);
      st.rail.frameAt(Math.max(0, s), _f);
      _v2.crossVectors(_f.T, _up).normalize();
      _v.copy(_f.pos).addScaledVector(_v2, l);
      _v.y = this.terrain.heightAt(s, l) + 3;
      st.fx.smokePuff(_v, _v2.set(0, 25, 0), 14, 2.5);
      const vel = _v2.subVectors(p.pos, _v).normalize().multiplyScalar(220);
      st.missiles.launch('enemy', _v, vel, p, { speedBonus: 40 });
    }
  }

  dispose() {
    this.terrain.dispose();
  }
}
