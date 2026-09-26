import { Vector3, Color } from 'three';
import { Rail, makeFrame } from '../sim/rail.js';
import { Player } from '../sim/player.js';
import { EnemyManager } from '../sim/enemies.js';
import { MissileSystem } from '../sim/missiles.js';
import { Vulcan, MissileStock } from '../sim/weapons.js';
import { EnemyGuns } from '../sim/enemyGuns.js';
import { LockOn } from '../sim/lockon.js';
import { Climax } from '../sim/climax.js';
import { Director } from '../sim/director.js';
import { waveTypes, DEFAULT_WAVES } from '../sim/waves.js';
import { ENEMY_TYPES } from '../sim/enemyTypes.js';
import { rngStream } from '../core/rng.js';
import { Events } from '../core/events.js';
import { loadModels, loadFX } from '../render/assets.js';
import { FX_STUB } from '../render/fxStub.js';
import { PlayerJet } from '../render/playerJet.js';
import { EnemyRenderer } from '../render/enemyRenderer.js';
import { MissileRenderer } from '../render/missileRenderer.js';
import { EnemyTrails } from '../render/enemyTrails.js';
import { t } from '../ui/i18n.js';
import { Clouds } from '../world/clouds.js';
import { TouchSource } from '../input/touch.js';
import { Combat } from './stage/combat.js';
import { EnemyOps } from './stage/enemyOps.js';
import { FxHooks } from './stage/fxHooks.js';
import { HudBridge } from './stage/hudBridge.js';
import { PostBridge } from './stage/postBridge.js';
import { RadioDirector } from '../audio/radio.js';

const _v = new Vector3();
const _frame = makeFrame();
const _UP = new Vector3(0, 1, 0);

// Damage values (percent of armor). "arcade" mirrors the original's brutality.
export const DAMAGE = {
  normal: { missile: 30, gun: 3, collision: 35, terrain: 25 },
  arcade: { missile: 70, gun: 4, collision: 100, terrain: 40 },
  easy: { missile: 18, gun: 2, collision: 22, terrain: 15 }
};

/**
 * One stage of gameplay. Owns the simulation (player, enemies, weapons,
 * director) and orchestrates the stage modules:
 *   combat (player weapons, lock-on, Climax)      → ./stage/combat.js
 *   enemyOps (enemy launches, collisions, threat) → ./stage/enemyOps.js
 *   fxHooks (explosions, trails, shake, sfx)      → ./stage/fxHooks.js
 *   hudBridge (HUD snapshot)                      → ./stage/hudBridge.js
 *   postBridge (per-frame post params)            → ./stage/postBridge.js
 *   radio (chatter director)                      → ../audio/radio.js
 * Modules communicate through `this.events` (see docs/overhaul/CONTRACTS.md).
 */
export class StageState {
  constructor(game, stageDef, opts = {}) {
    this.game = game;
    this.kind = 'stage';
    this.def = stageDef;
    this.opts = opts;
    this.loading = true;
    this.time = 0;
    this.finished = false;
    this.paused = false;
    this.timers = []; // sim-time timers: {t, fn} — die with the state, respect pause
    this.events = new Events();
    /** Free-form HUD extras written by stage components: {routeSelect, caution, ...} */
    this.hudExtra = {};
    /** Autopilot steering hint written by stage components: rail-space {x, y} targets (null = none) */
    this.autopilotHint = { x: null, y: null };
  }

  /** Run fn after `delay` world seconds (paused/slowed with the game). */
  schedule(delay, fn) {
    this.timers.push({ t: delay, fn });
  }

  _runTimers(wdt) {
    const list = this.timers;
    for (let i = list.length - 1; i >= 0; i--) {
      const tm = list[i];
      tm.t -= wdt;
      if (tm.t <= 0) {
        list.splice(i, 1);
        tm.fn();
      }
    }
  }

  // ------------------------------------------------------------------ setup
  async enter() {
    const g = this.game;
    const def = this.def;
    const session = g.session;
    this.session = session;
    g.setLoading?.(0.05, 'BUILDING WORLD');
    this.rail = new Rail(def.rail);
    g.world.configure(def.env);
    this.postBridge = new PostBridge(this);
    this.postBridge.applyLook(def.env);

    const [models, fxMod] = await Promise.all([loadModels(), loadFX()]);
    this.models = models;
    g.setLoading?.(0.3, 'ASSEMBLING AIRCRAFT');
    const scene = g.world.scene;
    this.fx = fxMod?.FX ? new fxMod.FX({ scene, renderer: g.renderer, maxParticles: g.preset.particles, quality: g.preset.name }) : FX_STUB;
    this.fx.setLighting?.(g.world.sun.intensity, 0.55);
    this.jet = new PlayerJet({ models, fx: this.fx, jetId: session.jet, scheme: session.scheme, csm: g.world.csm });
    g.world.dynamic.add(this.jet.group);
    this.enemyRenderer = new EnemyRenderer(scene, models, { csm: g.world.csm });
    this.enemyTrails = new EnemyTrails(this.fx);
    this.missileRenderer = new MissileRenderer(scene, models, g.world.csm);
    this.enemyRenderer.prepare(this._modelsUsed());

    // ---- simulation
    const seed = g.params.seed || 1;
    this.rng = rngStream(seed, def.id);
    const p = (this.player = new Player());
    p.reset({ s: def.rail.startS ?? 150, baseSpeed: def.rail.baseSpeed, box: def.rail.box, y: def.rail.startY ?? 0 });
    p.noRoll = !!def.rail.noRoll;
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
    this.combat = new Combat(this);
    this.enemyOps = new EnemyOps(this);
    this.fxHooks = new FxHooks(this);
    this.hudBridge = new HudBridge(this);
    this.enemies = new EnemyManager({ max: 96, rng: this.rng, hooks: this._enemyHooks() });
    const rank = session.stars;
    this.enemies.difficulty.aggression = 1 + rank * 0.08;
    this.enemies.difficulty.fireRate = 1 + rank * 0.1;
    this.missiles = new MissileSystem({ max: 96, rng: this.rng, hooks: this._missileHooks() });
    this.vulcan = new Vulcan({ rng: this.rng, hooks: this._gunHooks() });
    this.enemyGuns = new EnemyGuns({ rng: this.rng, hooks: { onPlayerHit: (pos) => this.playerHit(this.difficulty.gun, 'gun', pos) } });
    this.stock = new MissileStock();
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
      fireMissile: (e) => this.enemyOps.enemyMissile(e),
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
    this.radio = new RadioDirector(g, this);
    this.hud = g.hud;
    this.dead = false;
    this.deadT = 0;
    this.hitFlash = 0;
    this.whiteout = 0;
    this.pullUp = false;

    // cloud banks
    const cdef = (g.world.env || def.env).clouds; // resolved env (honours ?look=)
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
    await this.radio.preload?.();

    if (g.params.t > 0) this.fastForward(g.params.t);
    if (g.params.climax) {
      this.climax.gauge = 1;
      this.combat.activateClimax();
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
    this.events.emit('stageStart', { def });
  }

  /** Enemy models the stage can spawn: timeline + EO spawns + wave types + def.preloadTypes. */
  _modelsUsed() {
    const def = this.def;
    const used = new Map();
    const add = (type) => {
      const d = ENEMY_TYPES[type];
      if (d) used.set(`${d.model}@${d.scale || 1}`, [d.model, d.scale || 1]);
    };
    const collect = (sp) => {
      if (!sp) return;
      for (const s of Array.isArray(sp) ? sp : [sp]) add(s.type);
    };
    for (const ev of def.timeline || []) {
      collect(ev.spawn);
      if (ev.eo) collect(ev.eo.spawn);
    }
    for (const ty of def.preloadTypes || []) add(ty);
    for (const ty of waveTypes(def.waves)) add(ty);
    if (!def.waves && this.game.params.waves) for (const ty of waveTypes(DEFAULT_WAVES)) add(ty);
    return [...used.values()];
  }

  async _precompile() {
    const g = this.game;
    this.enemyRenderer.warmup(true);
    this.missileRenderer.warmup(true);
    this.fx.warmup?.();
    this.fxHooks.warmup?.();
    this.fx.vaporCone?.(this.jet.group, 1); // lazily shown mesh: make it visible so the warm-up frame builds its programs
    this.fx.vapor?.update?.(1);
    const vaporMesh = this.fx.vapor?.mesh;
    if (vaporMesh) vaporMesh.frustumCulled = false; // the rig may not frame the jet yet
    g.rig.update(this.player, this.rail, 1, 1 / 60);
    g.world.update(0, g.rig.camera);
    // The scene is only ever drawn into the post chain's HalfFloat input buffer
    // (linear output), so compile every material for that target too — objects
    // outside the warm-up frame's view (obstacles, trees further down the rail)
    // would otherwise compile their linear variant mid-stage.
    const r = g.renderer;
    const input = g.post.composer?.inputBuffer;
    try {
      await r.compileAsync(g.world.scene, g.rig.camera);
      if (input) {
        const prev = r.getRenderTarget();
        r.setRenderTarget(input);
        const pending = r.compileAsync(g.world.scene, g.rig.camera); // programs are created synchronously here
        r.setRenderTarget(prev);
        await pending;
      }
    } catch (e) {
      console.warn('compileAsync failed', e);
    }
    g.renderWorld(1 / 60);
    this.fx.vaporCone?.(this.jet.group, 0);
    if (this.fx.vapor) {
      this.fx.vapor.value = 0;
      this.fx.vapor.update(0);
      if (vaporMesh) vaporMesh.frustumCulled = true;
    }
    this.enemyRenderer.warmup(false);
    this.missileRenderer.warmup(false);
  }

  _introMessage() {
    const d = this.def;
    const no = this.game.session.stageNo || d.index;
    this.hud.message(`${t('ui.stage')} ${no}`, { sub: `${d.name} — ${d.subtitle}`, dur: 3.2 });
    this.hud.message(t('hud.engage'), { style: 'callout', dur: 1.8, delay: 3.3 });
  }

  exit() {
    const g = this.game;
    this.events.emit('stageExit', {});
    g.world.dynamic.remove(this.jet.group);
    this.enemyRenderer.dispose();
    if (this.clouds) {
      g.world.scene.remove(this.clouds.mesh);
      this.clouds.dispose();
    }
    g.world.scene.remove(this.missileRenderer.mesh, this.missileRenderer.glow);
    this.missileRenderer.dispose?.();
    this.jet.dispose?.();
    this.enemyTrails.dispose();
    this.fxHooks.dispose();
    this.fx.dispose?.();
    this.stageLogic?.dispose?.();
    this.radio.dispose();
    this.combat.dispose();
    this.enemyOps.dispose();
    if (g.session === this.session) g.session.climaxGauge = this.climax.gauge;
    // leave global systems clean for the next state
    g.touch.setVisible(false);
    const h = this.hud;
    if (h.reset) h.reset();
    else {
      h.clearMessages();
      h.popups.length = 0;
      h.radioLines.length = 0;
      h.eo = null;
    }
    this.timers.length = 0;
    g.audio?.setTimeScale?.(1);
    g.clock.scaleTo(1, 0);
    g.clock.paused = false;
    g.dynres.locked = false;
    this.postBridge.reset();
    g.rig.cine = null;
    g.rig.fov = g.rig.baseFov;
    g.rig.camera.fov = g.rig.baseFov;
    g.rig.camera.updateProjectionMatrix();
    this.events.clear();
  }

  // ------------------------------------------------------------ hook tables
  // Game rules live here; presentation goes to fxHooks; everything is also
  // broadcast on this.events for radio/HUD/other listeners.
  _enemyHooks() {
    return {
      onHit: (e, amt, src) => this.fxHooks.onEnemyHit(e, amt, src),
      onKill: (e, src, mode) => {
        const res = this.scoring.kill(e);
        this.stageLogic?.onKill?.(e);
        this.climax.onKill(!!e.def.big, this.player.throttle);
        this.director.notify('killed', e.tag);
        this.fxHooks.onEnemyKill(e, src, mode, res);
        this.events.emit('kill', { e, src, mode, res });
      },
      onDyingTick: (e) => this.fxHooks.onEnemyDyingTick(e),
      onExplode: (e, kind) => {
        this.fxHooks.onEnemyExplode(e, kind);
        this.events.emit('explode', { e, kind, dist: e.pos.distanceTo(this.player.pos) });
      },
      onEscape: (e) => {
        this.director.notify('escaped', e.tag);
        this.events.emit('escape', { e });
      },
      onDespawn: (e) => this.fxHooks.onEnemyDespawn(e)
    };
  }

  _missileHooks() {
    return {
      onLaunch: (m) => {
        this.fxHooks.onMissileLaunch(m);
        this.events.emit('missileLaunch', m);
      },
      onHit: (m, tgt) => {
        this.fxHooks.onMissileHit(m, tgt);
        if (m.owner === 'player') this.enemies.damage(tgt, m.damage, 'missile');
        else this.playerHit(m.strong ? this.difficulty.missile * 1.3 : this.difficulty.missile, 'missile', m.pos);
      },
      onEnd: (m, reason) => {
        this.fxHooks.onMissileEnd(m, reason);
        this.events.emit('missileEnd', { m, reason });
      },
      onDecoyed: () => {}
    };
  }

  _gunHooks() {
    return {
      onFire: (pos, dir) => this.fxHooks.onGunFire(pos, dir),
      onBulletHit: (e, pos) => this.fxHooks.onBulletHit(e, pos)
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
      quality: () => g.preset.name,
      aliveCount: () => this.enemies.list.length,
      onScreenCount: () => {
        let n = 0;
        for (const e of this.enemies.list) if (e.onScreen && !e.dead) n++;
        return n;
      },
      forceWaves: () => !!g.params.waves,
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

  /** Scripted radio line (timelines, stage logic). */
  _radio(key, opts) {
    return this.radio.say(key, { priority: 1, ...opts });
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
    this._eoClearT = kind !== 'start' ? 4 : 0;
    this.events.emit('eo', { kind, eo });
  }

  // ------------------------------------------------- legacy aliases (stage logic)
  _activateClimax() {
    this.combat.activateClimax();
  }

  _endClimax() {
    this.combat.endClimax();
  }

  _playerHit(amount, kind, pos) {
    this.playerHit(amount, kind, pos);
  }

  // ------------------------------------------------------------ combat acts
  /** Apply damage to the player (percent of armor). */
  playerHit(amount, kind, pos) {
    const p = this.player;
    if (!p.alive || this.dead || this.finished || this.game.params.god) return;
    const applied = p.damage(amount);
    if (!applied) return;
    this.scoring.hurt();
    this.hitFlash = Math.min(1, this.hitFlash + (kind === 'gun' ? 0.25 : 0.9));
    this.fxHooks.onPlayerHit(kind, pos);
    this.events.emit('playerHit', { kind, amount, pos });
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
      eo: this.director.eoResults,
      route: this.routeChoice ?? null
    };
    this.hud.message(t('ui.missionComplete'), { sub: `DOWN RATE ${res.rate.toFixed(1)}%`, dur: 4, color: '#7dffb0' });
    this.game.audio?.play('stageClear');
    this.finishT = 0;
    this.events.emit('stageEnd', this.results);
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
    // floor under the jet (walls/obstacles are collisions, not an altitude floor)
    const logic = this.stageLogic;
    let ground = 0;
    if (logic?.floorAt) ground = logic.floorAt(p.s, p.x);
    else if (logic?.groundAt) ground = logic.groundAt(p.s, p.x);
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
    this._runTimers(wdt);
    if (this._eoClearT > 0 && (this._eoClearT -= dt) <= 0) this.hud.eo = null;
    logic?.preUpdate?.(dt, wdt);
    const controls = !this.dead && !this.finished && !(logic?.lockControls);

    this.combat.preUpdate(dt, wdt, input, controls);

    // player flight
    const lim = this._limits();
    p.controlLock = controls ? p.controlLock : Math.max(p.controlLock, 0.05);
    p.update(wdt, controls ? input : NO_INPUT, this.rail, lim);
    this.pullUp = lim.minY > p.y - 0.01 && !!this.def.rail.minAltitude;

    // enemy throttle interplay: FAST throws off enemy aim/missiles
    this.ctx.enemyN = p.throttle > 0 ? 0.7 : p.throttle < 0 ? 1.15 : 1;
    this.enemyGuns.spreadMul = p.throttle > 0 ? 1.8 : p.throttle < 0 ? 0.8 : 1;

    this.director.update(wdt, p);
    this.enemies.update(wdt, this.ctx);
    logic?.update?.(dt, wdt);

    this.combat.update(dt, wdt, input, controls);

    this.missiles.update(wdt, this.ctx);
    this.enemyGuns.update(wdt, p, !!g.params.god);
    this.enemyOps.update(dt, wdt);

    this.combat.postUpdate(dt);

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
      if (this.finishT > (this.def.finishDelay ?? 4.5) && !this._handedOff) {
        this._handedOff = true;
        g.onStageComplete?.(this.results);
      }
    }
    // end of rail safety
    if (!this.finished && p.s > this.rail.length - 50) this._finish();
  }

  _die() {
    const g = this.game;
    this.dead = true;
    this.deadT = 0;
    this.fxHooks.onPlayerDie();
    this.jet.setVisible(false);
    g.session.lives--;
    this.scoring.loseStar();
    this.scoring.hurt();
    this.combat.onPlayerDown();
    this.events.emit('playerDown', {});
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
    g.rig.snap?.();
    this.missiles.reset();
    this.fxHooks.clearTrails();
    this.enemyTrails.clear();
    this.events.emit('respawn', {});
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
    this.enemyRenderer.update(this.enemies, alpha, cam, realDt);
    this.enemyTrails.update(this.enemies, cam, alpha);
    this.missileRenderer.update(this.missiles, alpha, g.rig.camera);
    this.fxHooks.render(alpha);

    this.stageLogic?.render?.(alpha, realDt);
    if (!this.stageLogic?.cameraOverride) g.rig.update(p, this.rail, alpha, realDt, { climax: this.climax.active });
    g.world.update(realDt, cam);
    this.whiteout = this.stageLogic?.whiteout || 0;
    if (this.clouds) {
      this.clouds.update(realDt, cam, p.s);
      this.whiteout = Math.max(this.whiteout, this.clouds.whiteout);
    }

    this.combat.updateReticle(realDt);
    this.enemyOps.updateThreat(realDt);
    this.postBridge.update(realDt);
    this.radio.update(realDt);
    this.fx.update(realDt, worldTime, cam);
    g.renderWorld(realDt);
    this.hudBridge.update(realDt);
  }

  /** Current HUD snapshot (tests/tools). */
  get hudState() {
    return this.hudBridge?.state;
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
