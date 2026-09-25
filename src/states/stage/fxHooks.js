import { PointLight, Vector3 } from 'three';
import { fxQuality, MISSILE_TRAILS } from '../../render/fx/config.js';

const _v = new Vector3();

/**
 * Presentation tunables (explosion sizes, throttle, shake, flash light, sfx).
 * Sizes are `fx.explosion` sizes: 1 = fireball ~25-40 m across; kind 'big'
 * is scaled again by BIG_SCALE inside the recipe.
 */
export const FX_TUNE = {
  size: { fighter: 2.6, big: 6, sea: 3.2, ground: 2.0, fallStart: 1.3, playerDeath: 3.2 },
  debris: { fighter: 15, big: 45 },
  plume: { dur: 2.0, bigDur: 3.2, liteDur: 1.2, scale: 0.6 },
  /** at most `full` full explosions per `window` world seconds, the rest use the 'lite' recipe */
  throttle: { window: 0.25, full: 3 },
  shake: { base: 0.12, near: 0.5, range: 1200, big: 0.8, liteMul: 0.5, nearMiss: 0.15, evade: 0.08 },
  /** pooled PointLights (high/ultra only): candela peak, e-folding decay (world s) */
  flash: { peak: 4e5, decay: 0.25, color: 0xffa24a, distance: 2600, maxOnPlayer: 25 },
  sfx: { nearDist: 650, liteGap: 0.07, whooshDist: 90 }
};

/**
 * Presentation side of combat events: explosions, debris, smoke, trails,
 * tracers, sparks, flash lights, camera shake and positional SFX. Game rules
 * (score, Climax gauge, director notifications) stay in StageState; this class
 * only makes things look and sound good. See docs/overhaul/CONTRACTS.md.
 */
export class FxHooks {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    /** missile -> {trail, prevD, whooshed} (records are pooled) */
    this.trails = new Map();
    this._recPool = [];
    this.lastHitSfx = 0;
    this._gunN = 0;
    // explosion throttle: world times of the last full explosions (ring)
    this._fullT = new Float64Array(8).fill(-1e9);
    this._fullI = 0;
    this._lastBoomT = -1e9;
    this._salvoUntil = -1e9;
    /** flash light pool: [{light, peak, t0, d, x, y, z, vx, vy, vz}] (created in warmup) */
    this.lights = null;
    this.stats = { full: 0, lite: 0 };
    this._alpha = 1;
    this._renderTrail = this._renderTrail.bind(this);
    const ev = stage.events;
    this._offs = ev
      ? [
          ev.on('nearMiss', (p) => this.onNearMiss(p)),
          ev.on('evade', (p) => this.onEvade(p)),
          ev.on('climax', (p) => this.onClimax(p))
        ]
      : [];
  }

  get fx() {
    return this.stage.fx;
  }

  _now() {
    const c = this.game.clock;
    return c ? c.worldTime : this.stage.time || 0;
  }

  _listener() {
    return this.game.rig?.camera?.position || this.stage.player.pos;
  }

  /** true while missiles belong to a Climax salvo (shorter trails for performance) */
  _climaxSalvo() {
    const c = this.stage.climax;
    if (!c) return false;
    return c.active || c.phase === 'salvo' || this._now() < this._salvoUntil;
  }

  /** Reserve a full explosion slot; false = over budget, use the lite recipe. */
  _allowFull(now) {
    const T = this._fullT;
    const full = FX_TUNE.throttle.full;
    const max = Math.min(T.length, full, this.fx.Q?.liteBurst ?? full); // per-quality budget (low: 2)
    let n = 0;
    for (let i = 0; i < T.length; i++) if (now - T[i] < FX_TUNE.throttle.window) n++;
    if (n >= max) return false;
    T[this._fullI] = now;
    this._fullI = (this._fullI + 1) % T.length;
    return true;
  }

  /** Shake by distance: trauma 0.12 + 0.5 (1 - d/1200) inside 1200 m, big kills 0.8. */
  _shake(d, big, mul = 1) {
    const S = FX_TUNE.shake;
    let tr = 0;
    if (big) tr = S.big;
    else if (d < S.range) tr = S.base + S.near * (1 - d / S.range);
    if (tr > 0) this.game.rig?.addTrauma(tr * mul);
  }

  /** Distance-layered boom (positional). */
  _boom(pos, vel, big, gain = 1, d = pos.distanceTo(this._listener())) {
    const a = this.game.audio;
    if (!a) return;
    const name = big ? 'boomHuge' : d < FX_TUNE.sfx.nearDist ? 'boomNear' : 'boomFar';
    a.play(name, { position: pos, velocity: vel, gain });
    this._lastBoomT = this._now();
  }

  // ---------------------------------------------------------------- enemies
  onEnemyHit(e, amt, src) {
    if (src === 'gun') {
      const now = this.stage.time;
      if (now - this.lastHitSfx > 0.07) {
        this.lastHitSfx = now;
        this.game.audio?.play('hit', { position: e.pos, gain: 0.5 });
      }
    }
  }

  /** res = scoring result {base, bonus}; mode 'instant' | 'fall' | 'big' (the last two fall burning). */
  onEnemyKill(e, src, mode, res) {
    const st = this.stage;
    st.hudBridge.popupAtWorld(e.pos, `+${res.base}`);
    if (res.bonus) {
      st.hudBridge.popupAtWorld(e.pos, `COMBO BONUS +${res.bonus}`, '#7dffb0', -30);
      this.game.audio?.play('combo', { rate: 1 + Math.min(st.scoring.combo, 80) / 80 });
    }
    if (mode === 'instant') return;
    e.smoke = this.fx.createSmokeEmitter({ fire: true });
    // the kill itself must read instantly: a burst where the hit landed, then the burning fall
    const now = this._now();
    const d = e.pos.distanceTo(this._listener());
    if (mode === 'big') {
      const full = this._allowFull(now);
      this.fx.explosion(e.pos, { size: FX_TUNE.size.fighter, vel: e.vel, kind: full ? 'air' : 'lite', seed: e.id + 7 });
      this._flash(e.pos, e.vel, 0.6);
      this._boom(e.pos, e.vel, false, 1, d);
      this._shake(d, false);
    } else {
      this.fx.explosion(e.pos, { size: FX_TUNE.size.fallStart, vel: e.vel, kind: 'lite', seed: e.id + 7 });
      if (now - this._lastBoomT > FX_TUNE.sfx.liteGap) this._boom(e.pos, e.vel, false, 0.6, d);
      this._shake(d, false, FX_TUNE.shake.liteMul);
    }
  }

  onEnemyDyingTick(e) {
    e.smoke?.update(e.pos, e.fallVel, 1);
  }

  onEnemyExplode(e, kind) {
    const T = FX_TUNE;
    const big = !!e.def.big;
    const now = this._now();
    const d = e.pos.distanceTo(this._listener());
    const full = big || this._allowFull(now);
    const size = big ? T.size.big : e.def.sea ? T.size.sea : kind === 'ground' ? T.size.ground : T.size.fighter;
    const fx = this.fx;
    if (full) {
      this.stats.full++;
      fx.explosion(e.pos, { size, vel: e.vel, kind: big ? 'big' : kind, seed: e.id });
      if (kind !== 'water') fx.debris(e.pos, e.vel, big ? T.debris.big : T.debris.fighter);
    } else {
      this.stats.lite++;
      fx.explosion(e.pos, { size: size * 0.85, vel: e.vel, kind: 'lite', seed: e.id });
    }
    // black smoke plume hanging where the kill happened (air kills and burning ships)
    if (kind === 'air' || big || e.def.sea) {
      const dur = big ? T.plume.bigDur : full ? T.plume.dur : T.plume.liteDur;
      fx.smokePlume?.(e.pos, e.def.sea ? null : e.vel, size * T.plume.scale, dur, true);
    }
    this._flash(e.pos, e.vel, big ? 1.6 : full ? 1 : 0.6);
    if (full || now - this._lastBoomT > T.sfx.liteGap) this._boom(e.pos, e.vel, big, full ? 1 : 0.7, d);
    this._shake(d, big, full ? 1 : T.shake.liteMul);
    e.smoke?.stop();
    e.smoke = null;
  }

  onEnemyDespawn(e) {
    e.smoke?.stop();
    e.smoke = null;
  }

  // --------------------------------------------------------------- missiles
  onMissileLaunch(m) {
    const enemy = m.owner !== 'player';
    const pre = enemy ? (m.strong ? MISSILE_TRAILS.enemyStrong : MISSILE_TRAILS.enemy) : MISSILE_TRAILS.player;
    const life = this._climaxSalvo() ? MISSILE_TRAILS.climaxLife : pre.life;
    const trail = this.fx.createTrail({ kind: 'missile', width: pre.width, life, opacity: pre.opacity, color: pre.color });
    const rec = this._recPool.pop() || { trail: null, prevD: 1e9, whooshed: false };
    rec.trail = trail;
    rec.prevD = 1e9;
    rec.whooshed = !enemy;
    this.trails.set(m, rec);
    if (!enemy) this.game.audio?.play('missileLaunch', { gain: 0.8 });
    else this.game.audio?.play('missileLaunch', { position: m.pos, gain: 0.6 });
  }

  onMissileHit(m, tgt) {
    if (m.owner === 'player') this.fx.explosion(m.pos, { size: 0.8, kind: 'missile' });
    else {
      this.fx.explosion(m.pos, { size: 0.9, kind: 'missile' });
      this.game.audio?.play('boomNear', { gain: 0.7 });
    }
  }

  onMissileEnd(m, reason) {
    const rec = this.trails.get(m);
    if (rec) {
      rec.trail.stop();
      rec.trail = null;
      this.trails.delete(m);
      this._recPool.push(rec);
    }
    if (reason === 'water') this.fx.waterSplash(m.pos, 0.6);
    else if (reason === 'shot') {
      // enemy missile shot down by the vulcan
      this.fx.explosion(m.pos, { size: 1.4, kind: 'missile', vel: m.vel });
      this.fx.hitSparks(m.pos, m.vel, 10);
      this._boom(m.pos, m.vel, false, 0.6);
    } else if (reason === 'ground' || reason === 'timeout' || reason === 'decoy') this.fx.explosion(m.pos, { size: 0.5, kind: reason === 'ground' ? 'ground' : 'missile' });
  }

  clearTrails() {
    for (const rec of this.trails.values()) {
      rec.trail.stop();
      rec.trail = null;
      this._recPool.push(rec);
    }
    this.trails.clear();
  }

  // -------------------------------------------------------------- events
  onNearMiss(p) {
    const e = p && p.e;
    if (e && e.pos) this.game.audio?.play('whoosh', { position: e.pos, velocity: e.vel });
    else this.game.audio?.play('whoosh');
    this.game.rig?.addTrauma(FX_TUNE.shake.nearMiss);
  }

  onEvade() {
    this.game.audio?.play('evade');
    this.game.rig?.addTrauma(FX_TUNE.shake.evade);
  }

  onClimax(p) {
    // salvo missiles fire after release: keep their trails short until the ripple is done
    if (p && p.phase === 'end') this._salvoUntil = this._now() + 0.5 + 0.035 * (p.salvo || 0);
  }

  // -------------------------------------------------------------------- gun
  onGunFire(pos, dir) {
    if ((this._gunN++ & 3) === 0) this.fx.muzzleFlash?.(pos, dir, this.stage.player.velocity);
  }

  onBulletHit(e, pos) {
    this.fx.hitSparks(pos, e.vel, 12);
  }

  // ----------------------------------------------------------------- player
  onPlayerHit(kind, pos) {
    const p = this.stage.player;
    this.game.rig.addTrauma(kind === 'gun' ? 0.15 : 0.7);
    this.game.audio?.play(kind === 'gun' ? 'hit' : 'playerHit', { gain: kind === 'gun' ? 0.6 : 1 });
    this.game.gamepad?.rumble(kind === 'gun' ? 0.3 : 1, 0.6, kind === 'gun' ? 60 : 300);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(kind === 'gun' ? 20 : 120);
    if (kind === 'missile' && pos) this.fx.hitSparks(pos, p.velocity, 24);
  }

  onPlayerDie() {
    const p = this.stage.player;
    this.fx.explosion(p.pos, { size: FX_TUNE.size.playerDeath, kind: 'big', vel: p.velocity });
    this.fx.debris(p.pos, p.velocity, 24);
    this.game.audio?.play('boomHuge');
    this.game.rig.addTrauma(1);
  }

  // ------------------------------------------------------------ flash light
  /** Point the least useful pooled light at this explosion (no-op on low/medium). */
  _flash(pos, vel, strength = 1) {
    const L = this.lights;
    if (!L || !L.length) return;
    const now = this._now();
    const F = FX_TUNE.flash;
    // effective distance: stronger (bigger) blasts win over nearer small ones
    const d = pos.distanceTo(this._listener()) / Math.max(strength, 0.1);
    // a light that has faded (older than 2 decays) is free; otherwise take over
    // the live light showing the farthest explosion, but only for a nearer one
    let free = null, far = null;
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      if (r.peak <= 0 || now - r.t0 > F.decay * 2) {
        if (!free || r.t0 < free.t0) free = r;
      } else if (!far || r.d > far.d) far = r;
    }
    if (free) this._setFlash(free, pos, vel, strength, d, now);
    else if (far.d > d) this._setFlash(far, pos, vel, strength, d, now);
  }

  _setFlash(best, pos, vel, strength, d, now) {
    const F = FX_TUNE.flash;
    best.peak = F.peak * strength;
    best.t0 = now;
    best.d = d;
    best.x = pos.x; best.y = pos.y; best.z = pos.z;
    best.vx = vel ? vel.x * 0.5 : 0; best.vy = vel ? vel.y * 0.5 : 0; best.vz = vel ? vel.z * 0.5 : 0;
  }

  _updateLights() {
    const L = this.lights;
    if (!L) return;
    const now = this._now();
    const F = FX_TUNE.flash;
    const pp = this.stage.player.pos;
    for (let i = 0; i < L.length; i++) {
      const r = L[i];
      const age = now - r.t0;
      const li = r.light;
      if (r.peak <= 0 || age > F.decay * 7 || age < 0) {
        li.intensity = 0;
        r.peak = 0;
        continue;
      }
      const ta = Math.min(age, 0.6);
      li.position.set(r.x + r.vx * ta, r.y + r.vy * ta, r.z + r.vz * ta);
      // never blow the HalfFloat target: cap the irradiance on the player jet (I / d^2)
      const dp = Math.max(li.position.distanceTo(pp), 1);
      li.intensity = Math.min(r.peak * Math.exp(-age / F.decay), F.maxOnPlayer * dp * dp);
    }
  }

  // ----------------------------------------------------------------- render
  /** Per rendered frame: extend missile trails, missile fly-by whooshes, flash lights, tracers. */
  render(alpha) {
    this._alpha = alpha;
    this.trails.forEach(this._renderTrail); // (no iterator/entry allocations)
    this._updateLights();
    this._tracers();
  }

  _renderTrail(rec, m) {
    if (m.t > m.dropT) rec.trail.push(_v.lerpVectors(m.prevPos, m.pos, this._alpha));
    if (!rec.whooshed) {
      const d = m.pos.distanceTo(this.stage.player.pos);
      // closest approach passed within whoosh range: fly-by
      if (d > rec.prevD && rec.prevD < FX_TUNE.sfx.whooshDist) {
        rec.whooshed = true;
        this.game.audio?.play('whoosh', { position: m.pos, velocity: m.vel });
      }
      rec.prevD = d;
    }
  }

  _tracers() {
    const st = this.stage;
    const v = st.vulcan, eg = st.enemyGuns;
    const n = v.count + eg.count;
    if (!this._tracerPos || this._tracerPos.length < (v.max + eg.max) * 3) {
      this._tracerPos = new Float32Array((v.max + eg.max) * 3);
      this._tracerVel = new Float32Array((v.max + eg.max) * 3);
    }
    const TP = this._tracerPos, TV = this._tracerVel;
    const nv = v.count * 3, ne = eg.count * 3;
    for (let i = 0; i < nv; i++) {
      TP[i] = v.packedPos[i];
      TV[i] = v.packedVel[i];
    }
    for (let i = 0; i < ne; i++) {
      TP[nv + i] = eg.packedPos[i];
      TV[nv + i] = eg.packedVel[i];
    }
    this.fx.tracers?.setData(TP, TV, n);
  }

  /**
   * Called from StageState._precompile (before renderer.compileAsync): create
   * everything that changes shader programs now. The flash PointLights are
   * added to the scene ONCE here with intensity 0 and never added/removed or
   * hidden during the stage (a light-count change recompiles every lit material).
   */
  warmup() {
    const g = this.game;
    const n = fxQuality(g.preset?.name).lights | 0;
    const scene = g.world?.scene;
    if (this.lights || n <= 0 || !scene) return;
    const F = FX_TUNE.flash;
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const light = new PointLight(F.color, 0, F.distance, 2);
      light.name = 'fxFlash' + i;
      light.castShadow = false;
      light.position.set(0, -20000, 0);
      scene.add(light);
      this.lights.push({ light, peak: 0, t0: -1e9, d: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    }
  }

  dispose() {
    this.clearTrails();
    for (const off of this._offs) off();
    this._offs.length = 0;
    if (this.lights) {
      for (const r of this.lights) r.light.removeFromParent();
      this.lights = null;
    }
  }
}
