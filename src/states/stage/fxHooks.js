import { Vector3 } from 'three';

const _v = new Vector3();

/**
 * Presentation side of combat events: explosions, debris, smoke, trails,
 * tracers, sparks, camera shake and positional SFX. Game rules (score,
 * Climax gauge, director notifications) stay in StageState; this class only
 * makes things look and sound good. See docs/overhaul/CONTRACTS.md.
 */
export class FxHooks {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.trails = new Map();
    this.lastHitSfx = 0;
    this._gunN = 0;
  }

  get fx() {
    return this.stage.fx;
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

  /** res = scoring result {base, bonus}; mode 'instant' | undefined (falls burning). */
  onEnemyKill(e, src, mode, res) {
    const st = this.stage;
    st.hudBridge.popupAtWorld(e.pos, `+${res.base}`);
    if (res.bonus) {
      st.hudBridge.popupAtWorld(e.pos, `COMBO BONUS +${res.bonus}`, '#7dffb0', -30);
      this.game.audio?.play('combo', { rate: 1 + Math.min(st.scoring.combo, 80) / 80 });
    }
    if (mode !== 'instant') e.smoke = this.fx.createSmokeEmitter({ fire: true });
    if (e.def.big) this.game.rig.addTrauma(0.35);
  }

  onEnemyDyingTick(e) {
    e.smoke?.update(e.pos, e.fallVel, 1);
  }

  onEnemyExplode(e, kind) {
    const st = this.stage;
    const big = !!e.def.big;
    this.fx.explosion(e.pos, { size: big ? 3.2 : e.def.sea ? 2 : 1.1, vel: e.vel, kind: big ? 'big' : kind, seed: e.id });
    if (kind !== 'water') this.fx.debris(e.pos, e.vel, big ? 30 : 10);
    if (big) this.fx.shockRing(e.pos, 4);
    this.game.audio?.play(big ? 'explosionLarge' : 'explosionSmall', { position: e.pos, velocity: e.vel });
    const d = e.pos.distanceTo(st.player.pos);
    if (d < 600) this.game.rig.addTrauma(big ? 0.6 : 0.25 * (1 - d / 600));
    e.smoke?.stop();
    e.smoke = null;
  }

  onEnemyDespawn(e) {
    e.smoke?.stop();
    e.smoke = null;
  }

  // --------------------------------------------------------------- missiles
  onMissileLaunch(m) {
    const trail = this.fx.createTrail({ kind: 'missile', width: m.owner === 'player' ? 1.2 : 1.4, life: 2.4 });
    this.trails.set(m, trail);
    if (m.owner === 'player') this.game.audio?.play('missileLaunch', { gain: 0.8 });
    else this.game.audio?.play('missileLaunch', { position: m.pos, gain: 0.6 });
  }

  onMissileHit(m, tgt) {
    if (m.owner === 'player') this.fx.explosion(m.pos, { size: 0.6, kind: 'missile' });
    else this.fx.explosion(m.pos, { size: 0.9, kind: 'missile' });
  }

  onMissileEnd(m, reason) {
    const tr = this.trails.get(m);
    if (tr) {
      tr.stop();
      this.trails.delete(m);
    }
    if (reason === 'water') this.fx.waterSplash(m.pos, 0.6);
    else if (reason === 'ground' || reason === 'timeout' || reason === 'decoy') this.fx.explosion(m.pos, { size: 0.5, kind: reason === 'ground' ? 'ground' : 'missile' });
  }

  clearTrails() {
    for (const tr of this.trails.values()) tr.stop();
    this.trails.clear();
  }

  // -------------------------------------------------------------------- gun
  onGunFire(pos, dir) {
    if ((this._gunN++ & 3) === 0) this.fx.muzzleFlash?.(pos, dir, this.stage.player.velocity);
  }

  onBulletHit(e, pos) {
    this.fx.hitSparks(pos, e.vel, 8);
  }

  // ----------------------------------------------------------------- player
  onPlayerHit(kind, pos) {
    const p = this.stage.player;
    this.game.rig.addTrauma(kind === 'gun' ? 0.15 : 0.7);
    this.game.audio?.play(kind === 'gun' ? 'hit' : 'playerHit', { gain: kind === 'gun' ? 0.6 : 1 });
    this.game.gamepad?.rumble(kind === 'gun' ? 0.3 : 1, 0.6, kind === 'gun' ? 60 : 300);
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(kind === 'gun' ? 20 : 120);
    if (kind === 'missile' && pos) this.fx.hitSparks(pos, p.velocity, 20);
  }

  onPlayerDie() {
    const p = this.stage.player;
    this.fx.explosion(p.pos, { size: 2.2, kind: 'big', vel: p.velocity });
    this.fx.debris(p.pos, p.velocity, 24);
    this.game.audio?.play('explosionLarge');
    this.game.rig.addTrauma(1);
  }

  // ----------------------------------------------------------------- render
  /** Per rendered frame: extend missile trails, upload tracers. */
  render(alpha) {
    const st = this.stage;
    for (const [m, tr] of this.trails) {
      if (m.t > m.dropT) tr.push(_v.lerpVectors(m.prevPos, m.pos, alpha));
    }
    this._tracers();
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

  /** Called from StageState._precompile: create any lazily-built FX now. */
  warmup() {}

  dispose() {
    this.clearTrails();
  }
}
