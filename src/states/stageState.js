import { Vector3 } from 'three';
import { Rail, makeFrame } from '../sim/rail.js';
import { Player } from '../sim/player.js';
import { EnemyManager } from '../sim/enemies.js';
import { MissileSystem } from '../sim/missiles.js';
import { Vulcan, MissileStock } from '../sim/weapons.js';
import { EnemyGuns } from '../sim/enemyGuns.js';
import { LockOn, projectPoint } from '../sim/lockon.js';
import { Climax } from '../sim/climax.js';
import { Director } from '../sim/director.js';
import { ENEMY_TYPES } from '../sim/enemyTypes.js';
import { rngStream } from '../core/rng.js';
import { clamp, dampTo } from '../core/math.js';
import { loadModels, loadFX } from '../render/assets.js';
import { FX_STUB } from '../render/fxStub.js';
import { PlayerJet } from '../render/playerJet.js';
import { EnemyRenderer } from '../render/enemyRenderer.js';
import { MissileRenderer } from '../render/missileRenderer.js';
import { t } from '../ui/i18n.js';
import { Clouds } from '../world/clouds.js';
import { TouchSource } from '../input/touch.js';
import { Color } from 'three';

const _v = new Vector3();
const _v2 = new Vector3();
const _s = new Vector3();
const _frame = makeFrame();
const _UP = new Vector3(0, 1, 0);

// Damage values (percent of armor). "arcade" mirrors the original's brutality.
export const DAMAGE = {
  normal: { missile: 34, gun: 3, collision: 45, terrain: 25 },
  arcade: { missile: 70, gun: 4, collision: 100, terrain: 40 },
  easy: { missile: 22, gun: 2, collision: 30, terrain: 15 }
};

/**
 * One stage of gameplay: owns the simulation (player, enemies, weapons,
 * director) and drives rendering, HUD and audio for it.
 */
export class StageState {
  constructor(game, stageDef, opts = {}) {
    this.game = game;
    this.kind = 'stage';
    this.def = stageDef;
    this.opts = opts;
    this.loading = true;
    this.trails = new Map();
    this.time = 0;
    this.finished = false;
    this.paused = false;
  }

  // ------------------------------------------------------------------ setup
  async enter() {
    const g = this.game;
    const def = this.def;
    const session = g.session;
    g.setLoading?.(0.05, 'BUILDING WORLD');
    this.rail = new Rail(def.rail);
    g.world.configure(def.env);
    g.renderer.toneMappingExposure = def.env.toneExposure ?? 0.6;
    g.post.grade.setGrade(def.env.grade || 'neutral');
    const bl = def.env.bloom || {};
    g.post.bloom.luminanceMaterial.threshold = bl.threshold ?? 1.0;
    g.post.bloom.intensity = bl.intensity ?? 0.9;

    const [models, fxMod] = await Promise.all([loadModels(), loadFX()]);
    this.models = models;
    g.setLoading?.(0.3, 'ASSEMBLING AIRCRAFT');
    const scene = g.world.scene;
    this.fx = fxMod?.FX ? new fxMod.FX({ scene, renderer: g.renderer, maxParticles: g.preset.particles, quality: g.preset.name }) : FX_STUB;
    this.fx.setLighting?.(g.world.sun.intensity, 0.55);
    this.jet = new PlayerJet({ models, fx: this.fx, jetId: session.jet, scheme: session.scheme, csm: g.world.csm });
    g.world.dynamic.add(this.jet.group);
    this.enemyRenderer = new EnemyRenderer(scene, models, { csm: g.world.csm });
    this.missileRenderer = new MissileRenderer(scene, models, g.world.csm);
    const used = new Map();
    const collect = (sp) => {
      if (!sp) return;
      for (const s of Array.isArray(sp) ? sp : [sp]) {
        const d = ENEMY_TYPES[s.type];
        if (d) used.set(`${d.model}@${d.scale || 1}`, [d.model, d.scale || 1]);
      }
    };
    for (const ev of def.timeline) {
      collect(ev.spawn);
      if (ev.eo) collect(ev.eo.spawn);
    }
    this.enemyRenderer.prepare([...used.values()]);

    // ---- simulation
    const seed = g.params.seed || 1;
    this.rng = rngStream(seed, def.id);
    const p = (this.player = new Player());
    p.reset({ s: def.rail.startS ?? 150, baseSpeed: def.rail.baseSpeed, box: def.rail.box, y: def.rail.startY ?? 0 });
    p.vel = p.velocity;
    p.active = true;
    p.id = -1;
    p.lockPos = p.pos;
    p.radius = 6;
    p.armor = 100;
    p.computePose(this.rail);
    p.prevPos.copy(p.pos);
    p.prevQuat.copy(p.quat);

    this.difficulty = DAMAGE[g.settings.difficulty || 'normal'] || DAMAGE.normal;
    this.enemies = new EnemyManager({ max: 96, rng: this.rng, hooks: this._enemyHooks() });
    const rank = session.stars;
    this.enemies.difficulty.aggression = 1 + rank * 0.08;
    this.enemies.difficulty.fireRate = 1 + rank * 0.1;
    this.missiles = new MissileSystem({ max: 96, rng: this.rng, hooks: this._missileHooks() });
    this.vulcan = new Vulcan({ rng: this.rng, hooks: this._gunHooks() });
    this.enemyGuns = new EnemyGuns({ rng: this.rng, hooks: { onPlayerHit: (pos) => this._playerHit(this.difficulty.gun, 'gun', pos) } });
    this.stock = new MissileStock(50, 2);
    this.lockon = new LockOn();
    this.lockon.assist = g.settings.assist ?? 2;
    this.climax = new Climax();
    this.climax.gauge = session.climaxGauge ?? 0.35;
    this.scoring = session.scoring;
    this.scoring.resetStage();
    this.director = new Director(def, this._directorApi());
    this.ctx = {
      player: p,
      rail: this.rail,
      rng: this.rng,
      fireMissile: (e) => this._enemyMissile(e),
      fireGun: (e) => this.enemyGuns.burst(e, 7 + Math.round(rank * 1.5)),
      enemyFlares: (e) => {
        this.missiles.flares(e.pos, e.vel, e.id, 0.7);
        this.fx.flareBurst(e.pos, e.vel);
      },
      seaHeight: def.env.ocean && g.world.ocean ? (x, z) => g.world.ocean.heightAt(x, z, g.clock.worldTime) : null,
      groundHeight: def.groundHeight ? (x, z) => def.groundHeight(x, z) : null,
      enemyN: 1,
      enemyMissileG: 1
    };
    this.hud = g.hud;
    this.hudState = this._makeHudState();
    this.reticleOffset = { x: 0, y: 0 };
    this.flareCd = 0;
    this.dead = false;
    this.deadT = 0;
    this.salvo = [];
    this.salvoT = 0;
    this.warnT = 0;
    this.hitFlash = 0;
    this.whiteout = 0;
    this.pullUp = false;
    this.lastGunSfx = 0;
    this.lastHitSfx = 0;

    // cloud banks
    const cdef = def.env.clouds;
    if (cdef && g.preset.clouds > 0) {
      this.clouds = new Clouds({
        rail: this.rail,
        count: Math.round(g.preset.clouds * (cdef.count ?? 1)),
        seed: seed + 7,
        minY: cdef.minY,
        maxY: cdef.maxY,
        spread: cdef.spread,
        layer: cdef.layer || null,
        puffSize: cdef.puffSize,
        atlasSize: g.preset.name === 'low' ? 512 : 1024
      });
      const sky = g.world.sky;
      const top = sky.radiance(_v.set(0, 1, 0), new Color());
      const bottom = new Color().copy(g.world.sky.radiance(_v.set(0.3, 0.02, -0.95).normalize(), new Color())).multiplyScalar(0.55);
      this.clouds.setLighting((sky.params.sunIntensity * sky.params.exposure) / Math.PI * (cdef.sun ?? 1), top.multiplyScalar(cdef.ambient ?? 1), bottom);
      this.clouds.init(p.s);
      scene.add(this.clouds.mesh);
    }

    // hooks for stage-specific systems (carrier launch, canyon, bosses...)
    this.stageLogic = def.createLogic ? def.createLogic(this) : null;
    await this.stageLogic?.init?.();

    if (g.params.t > 0) this.fastForward(g.params.t);
    if (g.params.climax) {
      this.climax.gauge = 1;
      this._activateClimax();
    }

    if (g.params.warp > 0) {
      const steps = Math.floor(g.params.warp * 120);
      for (let i = 0; i < steps; i++) {
        g.clock.advanceReal(1 / 120);
        const wdt = (1 / 120) * g.clock.timeScale;
        g.clock.advanceWorld(wdt);
        this.update(1 / 120, wdt);
        if (i % 30 === 0) g.rig.update(this.player, this.rail, 1, 0.25);
      }
    }

    g.setLoading?.(0.7, 'COMPILING SHADERS');
    await this._precompile();
    g.setLoading?.(1, 'READY');
    this.loading = false;
    if (!this.stageLogic?.handlesMusic) g.audio?.music?.play(def.music || 'stage1');
    this.touchMode = TouchSource.isTouchDevice();
    g.touch.setVisible(this.touchMode);
    g.hud.touchLayout = this.touchMode;
    if (!this.stageLogic?.skipIntroMessage) this._introMessage();
  }

  async _precompile() {
    const g = this.game;
    this.enemyRenderer.warmup(true);
    this.missileRenderer.warmup(true);
    this.fx.warmup?.();
    this.fx.vaporCone?.(this.jet.group, 1); // lazily created mesh: compile it now
    g.rig.update(this.player, this.rail, 1, 1 / 60);
    g.world.update(0, g.rig.camera);
    try {
      await g.renderer.compileAsync(g.world.scene, g.rig.camera);
    } catch (e) {
      console.warn('compileAsync failed', e);
    }
    g.renderWorld(1 / 60);
    this.fx.vaporCone?.(this.jet.group, 0);
    this.enemyRenderer.warmup(false);
    this.missileRenderer.warmup(false);
  }

  _introMessage() {
    const d = this.def;
    this.hud.message(`${t('ui.stage')} ${d.index}`, { sub: `${d.name} — ${d.subtitle}`, dur: 3.2 });
    this.hud.message(t('ui.getReady'), { dur: 1.6, color: '#ffd27a', delay: 3.3 });
  }

  exit() {
    const g = this.game;
    g.world.dynamic.remove(this.jet.group);
    this.enemyRenderer.dispose();
    if (this.clouds) {
      g.world.scene.remove(this.clouds.mesh);
      this.clouds.dispose();
    }
    g.world.scene.remove(this.missileRenderer.mesh, this.missileRenderer.glow);
    this.fx.dispose?.();
    this.stageLogic?.dispose?.();
    g.session.climaxGauge = this.climax.gauge;
    // leave global systems clean for the next state
    g.touch.setVisible(false);
    const h = this.hud;
    h.clearMessages();
    h.popups.length = 0;
    h.radioLines.length = 0;
    h.eo = null;
    clearTimeout(this._eoClear);
    g.audio?.stopLoop?.('vulcan');
    g.audio?.stopLoop?.('missileAlert');
    g.audio?.setTimeScale?.(1);
    g.clock.scaleTo(1, 0);
    g.clock.paused = false;
    g.dynres.locked = false;
    const gf = g.post.gforce;
    for (const [k, v] of [['uLetterbox', 0], ['uFade', 0], ['uWhite', 0], ['uGrey', 0], ['uDamage', 0], ['uClimax', 0], ['uWarn', 0]]) gf.set(k, v);
    const cf = g.post.cameraFX.uniforms;
    cf.get('uRadial').value = 0;
    cf.get('uHazeStrength').value = 0;
    g.post.cameraFX.resetHistory();
    g.rig.cine = null;
    g.rig.fov = g.rig.baseFov;
    g.rig.camera.fov = g.rig.baseFov;
    g.rig.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ hook tables
  _enemyHooks() {
    return {
      onHit: (e, amt, src) => {
        if (src === 'gun') {
          const now = this.time;
          if (now - this.lastHitSfx > 0.07) {
            this.lastHitSfx = now;
            this.game.audio?.play('hit', { position: e.pos, gain: 0.5 });
          }
        }
      },
      onKill: (e, src, mode) => {
        const res = this.scoring.kill(e);
        this.stageLogic?.onKill?.(e);
        this.climax.onKill(!!e.def.big, this.player.throttle);
        this.director.notify('killed', e.tag);
        if (projectPoint(this.game.rig.camera, e.pos, _s)) {
          const W = this.game.hudCanvas.width, H = this.game.hudCanvas.height;
          const x = (_s.x * 0.5 + 0.5) * W, y = (-_s.y * 0.5 + 0.5) * H;
          this.hud.popup(x, y, `+${res.base}`);
          if (res.bonus) this.hud.popup(x, y - 30, `COMBO BONUS +${res.bonus}`, '#7dffb0');
        }
        if (res.bonus) this.game.audio?.play('combo', { rate: 1 + Math.min(this.scoring.combo, 80) / 80 });
        if (mode !== 'instant') e.smoke = this.fx.createSmokeEmitter({ fire: true });
        if (e.def.big) this.game.rig.addTrauma(0.35);
        if (this.rng.next() < 0.18) this._radio('r.gen.goodKill');
      },
      onDyingTick: (e) => e.smoke?.update(e.pos, e.fallVel, 1),
      onExplode: (e, kind) => {
        const big = !!e.def.big;
        this.fx.explosion(e.pos, { size: big ? 3.2 : e.def.sea ? 2 : 1.1, vel: e.vel, kind: big ? 'big' : kind, seed: e.id });
        if (kind !== 'water') this.fx.debris(e.pos, e.vel, big ? 30 : 10);
        if (big) this.fx.shockRing(e.pos, 4);
        this.game.audio?.play(big ? 'explosionLarge' : 'explosionSmall', { position: e.pos, velocity: e.vel });
        const d = e.pos.distanceTo(this.player.pos);
        if (d < 600) this.game.rig.addTrauma(big ? 0.6 : 0.25 * (1 - d / 600));
        e.smoke?.stop();
        e.smoke = null;
      },
      onEscape: (e) => {
        this.director.notify('escaped', e.tag);
      },
      onDespawn: (e) => {
        e.smoke?.stop();
        e.smoke = null;
      }
    };
  }

  _missileHooks() {
    return {
      onLaunch: (m) => {
        const trail = this.fx.createTrail({ kind: 'missile', width: m.owner === 'player' ? 1.2 : 1.4, life: 2.4 });
        this.trails.set(m, trail);
        if (m.owner === 'player') this.game.audio?.play('missileLaunch', { gain: 0.8 });
        else {
          this.game.audio?.play('missileLaunch', { position: m.pos, gain: 0.6 });
          if (this.rng.next() < 0.35) this._radio('r.gen.missile');
        }
      },
      onHit: (m, tgt) => {
        if (m.owner === 'player') {
          this.fx.explosion(m.pos, { size: 0.6, kind: 'missile' });
          this.enemies.damage(tgt, m.damage, 'missile');
        } else {
          this.fx.explosion(m.pos, { size: 0.9, kind: 'missile' });
          this._playerHit(this.difficulty.missile, 'missile', m.pos);
        }
      },
      onEnd: (m, reason) => {
        const tr = this.trails.get(m);
        if (tr) {
          tr.stop();
          this.trails.delete(m);
        }
        if (reason === 'water') this.fx.waterSplash(m.pos, 0.6);
        else if (reason === 'ground' || reason === 'timeout' || reason === 'decoy') this.fx.explosion(m.pos, { size: 0.5, kind: reason === 'ground' ? 'ground' : 'missile' });
      },
      onDecoyed: () => {}
    };
  }

  _gunHooks() {
    let n = 0;
    return {
      onFire: (pos, dir) => {
        if ((n++ & 3) === 0) this.fx.muzzleFlash?.(pos, dir, this.player.velocity);
      },
      onBulletHit: (e, pos) => {
        this.fx.hitSparks(pos, e.vel, 8);
      }
    };
  }

  _directorApi() {
    const g = this.game;
    return {
      spawn: (type, o) => this.enemies.spawn(type, o),
      cue: (name, ev) => this.stageLogic?.cue?.(name, ev),
      radio: (key) => this._radio(key),
      message: (key, ev) => this.hud.message(t(key), { sub: ev.sub ? t(ev.sub) : '', dur: ev.dur || 2.5, color: ev.color }),
      eoEvent: (kind, eo) => this._eoEvent(kind, eo),
      end: () => this._finish(),
      rank: () => g.session.stars,
      player: () => this.player,
      worldPoint: (s, x, y, ground) => {
        this.rail.frameAt(s, _frame);
        _v.crossVectors(_frame.T, _UP).normalize(); // horizontal right
        const out = { x: _frame.pos.x + _v.x * x, y: 0, z: _frame.pos.z + _v.z * x };
        const logic = this.stageLogic;
        const gh = ground ? (logic?.groundAt ? logic.groundAt(s, x) : 0) : 0;
        out.y = gh + (y || 0);
        return out;
      },
      railHeading: (s) => {
        this.rail.frameAt(s, _frame);
        return Math.atan2(_frame.T.x, -_frame.T.z);
      }
    };
  }

  _radio(key) {
    const line = t(key);
    if (Array.isArray(line)) {
      this.hud.radio(line[0], line[1]);
      this.game.audio?.radio?.(line[0]);
    }
  }

  _eoEvent(kind, eo) {
    const a = this.game.audio;
    if (kind === 'start') {
      this.hud.message(t('ui.eo'), { sub: eo.title, dur: 3, color: '#ffd84a' });
      a?.play('eoAlert');
    } else if (kind === 'cleared') {
      this.scoring.eo(eo.bonus);
      this.game.session.eoCleared[eo.id] = true;
      this.hud.message(t('ui.eoClear'), { sub: `BONUS +${eo.bonus}`, dur: 3, color: '#7dffb0' });
      a?.play('stageClear', { gain: 0.6 });
    } else if (kind === 'failed') {
      this.hud.message(t('ui.eoFail'), { dur: 2.5, color: '#ff5a4a' });
    }
    this.hud.eo = eo;
    clearTimeout(this._eoClear);
    if (kind !== 'start') this._eoClear = setTimeout(() => (this.hud.eo = null), 4000);
  }

  // ------------------------------------------------------------ combat acts
  _enemyMissile(e) {
    const p = this.player;
    _v.subVectors(p.pos, e.pos).normalize();
    _v2.copy(e.vel).addScaledVector(_v, 60);
    _s.copy(e.pos).addScaledVector(_v, e.radius + 3);
    this.missiles.launch('enemy', _s, _v2, p, { speedBonus: this.game.session.stars * 15 });
  }

  _firePlayerMissile(target, free = false) {
    if (!free && !this.stock.take()) {
      this.game.audio?.play('uiBack', { gain: 0.4 });
      return false;
    }
    const p = this.player;
    this.jet.nextHardpoint(_s);
    _v2.copy(p.velocity).addScaledVector(this.rail.frameAt(p.s, _frame).U, -7);
    const m = this.missiles.launch('player', _s, _v2, target, { damage: 12 * this.climax.damageMul });
    this.game.session.stats.missilesFired++;
    return !!m;
  }

  _fireMissileButton() {
    const target = this.lockon.consume();
    if (target) this._firePlayerMissile(target);
    else {
      // unguided: seek the assist target if any, else fly straight
      this._firePlayerMissile(this.lockon.assistTarget || null);
    }
    if (this.rng.next() < 0.12) this._radio('r.gen.fox2');
  }

  _activateClimax() {
    if (!this.climax.activate()) return;
    const g = this.game;
    g.clock.scaleTo(this.climax.timeScale, 0.25);
    g.audio?.play('climaxStart');
    g.audio?.setTimeScale?.(this.climax.timeScale);
    g.rig.fovKick = 8;
    g.rig.addTrauma(0.2);
    g.dynres.locked = true;
    g.session.stats.climaxUsed++;
    this._radio('r.gen.climax');
  }

  _endClimax() {
    const g = this.game;
    g.clock.scaleTo(1, 0.35);
    g.audio?.play('climaxEnd');
    g.audio?.setTimeScale?.(1);
    g.dynres.locked = false;
    // one missile per lock, rippled
    this.salvo = this.lockon.locks.slice();
    this.lockon.reset();
    this.salvoT = 0;
  }

  _playerHit(amount, kind, pos) {
    const p = this.player;
    if (!p.alive || this.dead || this.game.params.god) return;
    const applied = p.damage(amount);
    if (!applied) return;
    this.scoring.hurt();
    this.hitFlash = Math.min(1, this.hitFlash + (kind === 'gun' ? 0.25 : 0.9));
    this.game.rig.addTrauma(kind === 'gun' ? 0.15 : 0.7);
    this.game.audio?.play(kind === 'gun' ? 'hit' : 'playerHit', { gain: kind === 'gun' ? 0.6 : 1 });
    this.game.gamepad?.rumble(kind === 'gun' ? 0.3 : 1, 0.6, kind === 'gun' ? 60 : 300);
    if (navigator.vibrate) navigator.vibrate(kind === 'gun' ? 20 : 120);
    if (kind === 'missile' && pos) this.fx.hitSparks(pos, p.velocity, 20);
    if (kind !== 'gun' && p.alive && this.rng.next() < 0.5) this._radio('r.gen.hit');
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    const e = this.enemies;
    const res = this.scoring.stageClear(e.killed, e.spawned);
    this.results = {
      stage: this.def,
      kills: this.scoring.kills,
      bestCombo: this.scoring.bestCombo,
      time: this.scoring.time,
      downRate: res.rate,
      starEarned: res.earned,
      stars: this.scoring.stars,
      score: this.scoring.stage,
      total: this.scoring.total,
      eo: this.director.eoResults
    };
    this.hud.message(t('ui.missionComplete'), { sub: `DOWN RATE ${res.rate.toFixed(1)}%`, dur: 4, color: '#7dffb0' });
    this.game.audio?.play('stageClear');
    this.finishT = 0;
  }

  // ------------------------------------------------------------------ steps
  fastForward(sec) {
    const steps = Math.floor(sec * 120);
    const input = { moveX: 0, moveY: 0, throttleAxis: 0, pressed: {}, hold: {} };
    for (let i = 0; i < steps; i++) {
      this.player.update(1 / 120, input, this.rail, this._limits());
    }
    this.director.seek(this.player.s);
  }

  _limits() {
    const def = this.def.rail;
    const p = this.player;
    const minAlt = def.minAltitude ?? 12;
    // altitude floor in rail-up units (rail up is ~world up)
    this.rail.frameAt(p.s, _frame);
    let ground = 0;
    if (this.stageLogic?.groundAt) ground = this.stageLogic.groundAt(p.s, p.x);
    this._lim = this._lim || { minY: 0 };
    this._lim.minY = ground + minAlt - _frame.pos.y;
    return this._lim;
  }

  update(dt, wdt) {
    const g = this.game;
    const input = g.input;
    const p = this.player;
    this.time += dt;

    if (this.paused) return;
    if (input.pressed.pause) {
      this.togglePause();
      return;
    }

    const logic = this.stageLogic;
    logic?.preUpdate?.(dt, wdt);
    const controls = !this.dead && !this.finished && !(logic?.lockControls);

    // Climax toggle (press to start, press again to end early)
    if (controls && input.pressed.climax) {
      if (this.climax.active) {
        this.climax.end();
        this._endClimax();
      } else if (this.climax.ready) this._activateClimax();
      else g.audio?.play('uiBack', { gain: 0.3 });
    }
    // barrel roll breaks enemy missile locks nearby
    if (controls && (input.pressed.rollL || input.pressed.rollR)) {
      if (p.startRoll(input.pressed.rollL ? -1 : 1)) {
        g.audio?.play('roll');
        const n = this.missiles.breakLocks(p.pos, 190);
        if (n) this.hud.popup(g.hudCanvas.width / 2, g.hudCanvas.height * 0.62, 'EVADED!', '#7dffb0');
      }
    }
    // flares
    this.flareCd -= wdt;
    if (controls && input.pressed.flare && this.flareCd <= 0) {
      this.flareCd = 6;
      this.missiles.flares(p.pos, p.velocity, 'player', 0.85);
      this.fx.flareBurst(p.pos, p.velocity);
      g.audio?.play('flare');
    }

    // player flight
    const lim = this._limits();
    p.controlLock = controls ? p.controlLock : Math.max(p.controlLock, 0.05);
    p.update(wdt, controls ? input : NO_INPUT, this.rail, lim);
    if (lim.minY > p.y - 0.01 && this.def.rail.minAltitude) {
      // skimming the floor
      this.pullUp = true;
    } else this.pullUp = false;

    // enemy throttle interplay: FAST throws off enemy aim/missiles
    this.ctx.enemyN = p.throttle > 0 ? 0.7 : p.throttle < 0 ? 1.15 : 1;
    this.enemyGuns.spreadMul = p.throttle > 0 ? 1.8 : p.throttle < 0 ? 0.8 : 1;

    this.director.update(wdt, p);
    this.enemies.update(wdt, this.ctx);
    logic?.update?.(dt, wdt);

    // lock-on (aiming at real time, not slowed by Climax)
    this.lockon.climax = this.climax.active;
    this.lockon.aspect = g.rig.camera.aspect;
    this.lockon.update(dt, this.enemies, g.rig.camera, p.pos);
    if (this.lockon.newLocks > 0) g.audio?.play('lockOn', { rate: 1 + Math.min(this.lockon.locks.length, 12) * 0.06 });

    // missiles
    if (controls) {
      if (this.climax.active) {
        if (input.pressed.missile) this.climax.mash();
      } else if (g.settings.missileMode === 'paint') {
        if (input.released.missile) {
          let n = this.lockon.locks.length || 1;
          while (n-- > 0) this._fireMissileButton();
        }
      } else if (input.pressed.missile) this._fireMissileButton();
    }
    // climax salvo ripple
    if (this.salvo.length) {
      this.salvoT -= dt;
      while (this.salvoT <= 0 && this.salvo.length) {
        const tgt = this.salvo.shift();
        if (tgt.active && !tgt.dead) this._firePlayerMissile(tgt, true);
        this.salvoT += 0.035;
      }
    }
    this.stock.update(wdt);

    // vulcan: auto-fire when a target is near the reticle
    const autoFire = g.settings.autoFire !== false;
    const at = this.lockon.assistTarget;
    const inGunRange = at != null && at.dist < 1500;
    const trigger = controls && (input.hold.fire || (autoFire && inGunRange) || (this.climax.active && inGunRange));
    this._aimDir(_v);
    this.vulcan.assistStrength = [0, 0.55, 0.9][this.lockon.assist] ?? 0.9;
    this.vulcan.assistCone = ([2, 4, 7][this.lockon.assist] ?? 7) * (Math.PI / 180);
    this.vulcan.update(wdt, p, _v, this.lockon.assistTarget, trigger, this.enemies);
    if (trigger && this.time - this.lastGunSfx > 0.05) {
      if (!this._gunLoop) g.audio?.startLoop?.('vulcan');
      this._gunLoop = true;
      this.lastGunSfx = this.time;
    } else if (!trigger && this._gunLoop) {
      g.audio?.stopLoop?.('vulcan');
      this._gunLoop = false;
    }

    this.missiles.update(wdt, this.ctx);
    this.enemyGuns.update(wdt, p, !!g.params.god);

    // collisions with enemy aircraft
    if (p.alive && !this.dead) {
      for (const e of this.enemies.list) {
        if (!e.active || e.dead || !e.def.air) continue;
        const r = e.radius * 0.6 + 4;
        if (e.pos.distanceToSquared(p.pos) < r * r) {
          this.enemies.damage(e, 999, 'collision');
          this._playerHit(this.difficulty.collision, 'collision', e.pos);
        }
      }
    }

    // climax timing (real time)
    this.climax.fill(dt, p.throttle);
    if (this.climax.update(dt)) this._endClimax();

    // scoring & timers
    if (!this.finished) this.scoring.update(wdt, p.throttle, p.speed * wdt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.5);

    // death / respawn
    if (!p.alive && !this.dead) this._die();
    if (this.dead) {
      this.deadT += dt;
      if (this.deadT > 2.8) this._respawn();
    }

    if (this.finished) {
      this.finishT += dt;
      if (this.finishT > 4.5 && !this._handedOff) {
        this._handedOff = true;
        g.onStageComplete?.(this.results);
      }
    }
    // end of rail safety
    if (!this.finished && p.s > this.rail.length - 50) this._finish();
  }

  _aimDir(out) {
    return out.copy(this.player.forward);
  }

  _die() {
    const g = this.game;
    const p = this.player;
    this.dead = true;
    this.deadT = 0;
    this.fx.explosion(p.pos, { size: 2.2, kind: 'big', vel: p.velocity });
    this.fx.debris(p.pos, p.velocity, 24);
    this.jet.setVisible(false);
    g.audio?.play('explosionLarge');
    g.rig.addTrauma(1);
    g.session.lives--;
    this.scoring.loseStar();
    this.scoring.hurt();
    if (this.climax.active) {
      this.climax.end();
      this._endClimax();
    }
    this.lockon.reset();
    this._radio('r.gen.down');
    this.hud.message(t('ui.shotDown'), { dur: 2.2, color: '#ff5a4a' });
  }

  _respawn() {
    const g = this.game;
    const p = this.player;
    if (g.session.lives < 0) {
      // arcade continue: keep going but reset the score chain
      g.session.lives = 2;
      g.session.continues++;
      this.hud.message(t('ui.continue'), { sub: 'CREDIT −1', dur: 2 });
    }
    this.dead = false;
    p.alive = true;
    p.armor = 100;
    p.invuln = 3;
    p.x = 0;
    p.y = Math.max(p.y, 10);
    p.vx = p.vy = 0;
    this.jet.setVisible(true);
    this.missiles.reset();
    for (const tr of this.trails.values()) tr.stop();
    this.trails.clear();
  }

  togglePause() {
    this.paused = !this.paused;
    const g = this.game;
    g.clock.paused = this.paused;
    if (this.paused) {
      g.audio?.suspend?.();
      g.showPause?.(true);
    } else {
      g.audio?.resume?.();
      g.showPause?.(false);
    }
  }

  onHidden() {
    if (!this.paused) this.togglePause();
  }

  // ----------------------------------------------------------------- render
  render(alpha, realDt) {
    const g = this.game;
    const p = this.player;
    const cam = g.rig.camera;
    const worldTime = g.clock.worldTime;

    this.jet.update(p, alpha, realDt, worldTime);
    this.enemyRenderer.update(this.enemies, alpha);
    this.missileRenderer.update(this.missiles, alpha);
    for (const [m, tr] of this.trails) {
      if (m.t > m.dropT) tr.push(_v.lerpVectors(m.prevPos, m.pos, alpha));
    }
    this._tracers();

    this.stageLogic?.render?.(alpha, realDt);
    if (!this.stageLogic?.cameraOverride) g.rig.update(p, this.rail, alpha, realDt, { climax: this.climax.active });
    g.world.update(realDt, cam);
    this.whiteout = this.stageLogic?.whiteout || 0;
    if (this.clouds) {
      this.clouds.update(realDt, cam, p.s);
      this.whiteout = Math.max(this.whiteout, this.clouds.whiteout);
    }

    // reticle: 600 m ahead of the jet, projected; eased toward the assist target
    _v.copy(this.jet.group.position).addScaledVector(p.forward, 600);
    if (projectPoint(cam, _v, _s)) {
      const at = this.lockon.assistTarget;
      let ox = 0, oy = 0;
      if (at && at.onScreen && this.lockon.assist > 0) {
        const k = 0.35 * (this.lockon.assist / 2);
        ox = clamp((at.sx - _s.x) * k, -0.1, 0.1);
        oy = clamp((at.sy - _s.y) * k, -0.1, 0.1);
      }
      this.reticleOffset.x = dampTo(this.reticleOffset.x, ox, 8, realDt);
      this.reticleOffset.y = dampTo(this.reticleOffset.y, oy, 8, realDt);
      this.lockon.reticle.x = _s.x + this.reticleOffset.x;
      this.lockon.reticle.y = _s.y + this.reticleOffset.y;
    }

    this._postParams(realDt);
    this.fx.update(realDt, worldTime, cam);
    g.renderWorld(realDt);
    this._hud(realDt);
  }

  _tracers() {
    const v = this.vulcan, eg = this.enemyGuns;
    const n = v.count + eg.count;
    if (!this._tracerPos || this._tracerPos.length < (v.max + eg.max) * 3) {
      this._tracerPos = new Float32Array((v.max + eg.max) * 3);
      this._tracerVel = new Float32Array((v.max + eg.max) * 3);
    }
    this._tracerPos.set(v.packedPos.subarray(0, v.count * 3), 0);
    this._tracerVel.set(v.packedVel.subarray(0, v.count * 3), 0);
    this._tracerPos.set(eg.packedPos.subarray(0, eg.count * 3), v.count * 3);
    this._tracerVel.set(eg.packedVel.subarray(0, eg.count * 3), v.count * 3);
    this.fx.tracers?.setData(this._tracerPos, this._tracerVel, n);
  }

  _postParams(realDt) {
    const g = this.game;
    const p = this.player;
    const post = g.post;
    const gf = post.gforce;
    const climaxK = this.climax.active ? 1 : 0;
    this._climaxFx = dampTo(this._climaxFx || 0, climaxK, 6, realDt);
    const grey = clamp((p.gLoad - 6.5) / 3, 0, 0.85);
    gf.set('uGrey', dampTo(gf.uniforms.get('uGrey').value, grey, 3, realDt));
    gf.set('uDamage', g.settings.reducedFlashing ? this.hitFlash * 0.4 : this.hitFlash);
    gf.set('uClimax', this._climaxFx);
    gf.set('uWarn', this.hudState.threat ? 0.6 : 0);
    gf.set('uWhite', this.whiteout);
    const cf = post.cameraFX.uniforms;
    const fast = p.throttle > 0 ? clamp((p.speed - p.baseSpeed) / (p.baseSpeed * 0.4), 0, 1) : 0;
    cf.get('uRadial').value = dampTo(cf.get('uRadial').value, fast * 0.9 + this._climaxFx * 0.3, 4, realDt);
    cf.get('uCA').value = 0.12 + fast * 0.25 + this.hitFlash * 0.6 + this._climaxFx * 0.3;
    // heat haze behind the nozzles
    if (g.preset.heatHaze && this.jet.nozzles.length) {
      const cam = g.rig.camera;
      this.jet.nozzleWorld(0, _v);
      _v.addScaledVector(p.forward, -4);
      if (projectPoint(cam, _v, _s)) {
        const r = clamp(6 / Math.max(_s.z, 1), 0.01, 0.2);
        cf.get('uHaze0').value.set(_s.x * 0.5 + 0.5, _s.y * 0.5 + 0.5, r * 0.6, r);
        cf.get('uHazeStrength').value = 0.4 + p.afterburner * 0.8;
      } else cf.get('uHazeStrength').value = 0;
    }
  }

  _makeHudState() {
    return {
      showCombatHud: true,
      showGauges: true,
      reticle: null,
      lockRadius: 0.1,
      climax: false,
      assistActive: false,
      lockCount: 0,
      targets: null,
      threat: null,
      score: 0,
      combo: 0,
      comboTimer: 0,
      stars: 0,
      shining: false,
      climaxGauge: 0,
      armor: 100,
      lives: 3,
      missiles: 50,
      throttle: 0,
      speedKt: 0,
      altFt: 0,
      gLoad: 1,
      eo: null,
      enemyBehind: false,
      pullUp: false,
      radarWarning: null,
      stageName: ''
    };
  }

  _hud(realDt) {
    const g = this.game;
    const s = this.hudState;
    const p = this.player;
    const logicHud = this.stageLogic?.hud;
    s.showCombatHud = !this.dead && !this.finished && !(logicHud && logicHud.hideCombat);
    s.showGauges = !(logicHud && logicHud.hideGauges);
    s.reticle = this.lockon.reticle;
    s.lockRadius = this.lockon.radius;
    s.climax = this.climax.active;
    s.assistActive = !!this.vulcan.aimTarget;
    s.lockCount = this.lockon.locks.length;
    s.targets = this.enemies.list;
    const th = this.missiles.threat(p.pos, p.velocity);
    if (th && th.tgo < 6) {
      const cam = g.rig.camera;
      const onScr = projectPoint(cam, th.m.pos, _s);
      s.threat = this._threat || (this._threat = {});
      s.threat.tgo = th.tgo;
      s.threat.sx = _s.x;
      s.threat.sy = _s.y;
      s.threat.behind = !onScr;
      this.warnT += realDt;
      if (!this._warnLoop) {
        g.audio?.startLoop?.('missileAlert');
        this._warnLoop = true;
      }
    } else {
      s.threat = null;
      if (this._warnLoop) {
        g.audio?.stopLoop?.('missileAlert');
        this._warnLoop = false;
      }
    }
    s.score = this.scoring.total;
    s.combo = this.scoring.combo;
    s.comboTimer = this.scoring.comboTimer;
    s.stars = this.scoring.stars;
    s.shining = this.scoring.shining;
    s.climaxGauge = this.climax.gauge;
    s.armor = p.armor;
    s.lives = Math.max(0, g.session.lives);
    s.missiles = this.stock.count;
    s.throttle = p.throttle;
    s.speedKt = p.speed * 1.944;
    s.altFt = p.pos.y * 3.28;
    s.gLoad = p.gLoad;
    s.eo = this.hud.eo;
    s.pullUp = this.pullUp && !this.dead;
    let behind = false;
    for (const e of this.enemies.list) {
      if (e.active && !e.dead && (e.behaviorName === 'chaser' || (e.behaviorName === 'ace' && e.b.phase === 2))) {
        behind = true;
        break;
      }
    }
    s.enemyBehind = behind;
    s.radarWarning = this.stageLogic?.radarWarning || null;
    s.timer = logicHud?.timer || null;
    s.stageName = `STAGE ${this.def.index}  ${this.def.name}`;
    this.hud.draw(realDt, s, g.hudScale);
  }

  debugText() {
    const p = this.player;
    const e = this.enemies;
    return (
      `s ${p.s.toFixed(0)}/${this.rail.length.toFixed(0)}  v ${p.speed.toFixed(0)}  x ${p.x.toFixed(1)} y ${p.y.toFixed(1)}  G ${p.gLoad.toFixed(1)}\n` +
      `enemies ${e.list.length} (k ${e.killed}/${e.spawned})  msl ${this.missiles.list.length}  bullets ${this.vulcan.count}/${this.enemyGuns.count}\n` +
      `fx ${JSON.stringify(this.fx.stats?.() || {})}`
    );
  }
}

const NO_INPUT = { moveX: 0, moveY: 0, throttleAxis: 0 };
