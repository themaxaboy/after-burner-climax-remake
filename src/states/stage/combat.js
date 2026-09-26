import { Vector3 } from 'three';
import { makeFrame } from '../../sim/rail.js';
import { projectPoint } from '../../sim/lockon.js';
import { Reticle } from '../../sim/reticle.js';
import { clamp } from '../../core/math.js';
import { LoopGate, BurstGate, GUN_GATE, AUTO_BURST } from '../../audio/loopGates.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _s = new Vector3();
const _aim = new Vector3();
const _ray = new Vector3();
const _mz = new Vector3();
const _frame = makeFrame();
const ASSIST_STRENGTH = [0, 0.55, 0.9]; // vulcan magnetism per assist level
const ASSIST_CONE = [2, 4, 7].map((d) => (d * Math.PI) / 180);
const RESUME = Object.freeze({ resume: true });

/** Player weapon tuning. */
export const COMBAT = {
  missileDamage: 12,
  stockMax: 8, // ready missiles (HUD icon row) …
  stockRegen: 3, // … reloaded per second from an infinite reserve
  holdRipple: 0.25, // s holding MISSILE before the auto-ripple starts
  rippleRate: 8, // Hz, auto-ripple at new locks
  gunRange: 1200, // m, vulcan auto-fire range
  aimRange: 700, // m, bullet convergence without a target
  climaxClearTimeout: 6 // s after the salvo to destroy every Climax target
};

/**
 * Player-side combat for a stage: lock-on, missiles (one per press at the
 * oldest lock; targets covered by missiles in flight are never fired at
 * again), hold-to-ripple, Climax (hold to sustain → salvo → afterburn),
 * vulcan, barrel roll / jink, reticle placement. Owned by the stage; talks to
 * the rest of the game through `stage.events` (see docs/overhaul/CONTRACTS.md).
 */
export class Combat {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.flareCd = 0;
    this._gunLoop = false;
    this.gunGate = new LoopGate(GUN_GATE); // vulcan loop debounce
    this.burst = new BurstGate(AUTO_BURST); // auto-fire bursts
    this.reticle = new Reticle();
    this.holdT = 0; // s the MISSILE button has been held
    this.rippleT = 0;
    this.salvoT = 0;
    this.salvoN = 0;
    this._endedUse = -1;
    this._wasReady = false;
    this._setup = false;
    this._shoot = [];
    // Climax clear bonus bookkeeping
    this._clxIds = new Set();
    this._clxN = 0;
    this._clxKilled = 0;
    this._clxFailed = false;
    this._clxOpen = false;
    this._clxT = 0;
    // reused event payloads
    this._evLock = { n: 0 };
    this._evFox = { locked: false };
    this._evClimax = { phase: 'idle', salvo: 0 };
    this._evCombo = { n: 0, bonus: 0, climax: false };
    this._evEvade = { n: 0 };
    this._onShootDown = (m) => this.stage.missiles.shootDown?.(m);
    stage.events.on('kill', (ev) => this._onKill(ev));
    stage.events.on('escape', (ev) => this._onEscape(ev));
  }

  /** Lazy wiring once the stage's sim objects exist (they are built after Combat). */
  _ensureSetup() {
    if (this._setup) return;
    const st = this.stage;
    if (!st.stock || !st.lockon) return;
    this._setup = true;
    const s = st.stock;
    if (s.max !== COMBAT.stockMax || s.regen !== COMBAT.stockRegen) {
      if (s.configure) s.configure(COMBAT.stockMax, COMBAT.stockRegen);
      else {
        s.max = COMBAT.stockMax;
        s.regen = COMBAT.stockRegen;
        s.count = s.max;
      }
    }
    const jets = st.models?.PLAYER_JETS;
    const jet = jets && jets.find((j) => j.id === this.game.session?.jet);
    st.lockon.max = jet?.lockCap ?? 6;
    st.lockon.missileDamage = COMBAT.missileDamage;
  }

  _emitClimax(phase, salvo = 0) {
    const ev = this._evClimax;
    ev.phase = phase;
    ev.salvo = salvo;
    this.stage.events.emit('climax', ev);
  }

  _emitCombo(n, bonus, climax) {
    const ev = this._evCombo;
    ev.n = n;
    ev.bonus = bonus;
    ev.climax = climax;
    this.stage.events.emit('combo', ev);
  }

  /** Climax button semantics: toggle (setting / touch) or hold-to-sustain. */
  _toggleMode(input) {
    return !!this.game.settings.climaxToggle || !!this.stage.touchMode || input.lastDevice === 'touch';
  }

  _autoMissile() {
    const s = this.game.settings;
    return s.autoMissile ?? s.difficulty === 'easy';
  }

  /** Called once per sim step before the player moves. */
  preUpdate(dt, wdt, input, controls) {
    this._ensureSetup();
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    const c = st.climax;
    // Climax: hold to sustain (or press to toggle)
    if (controls && input.pressed.climax) {
      const toggle = this._toggleMode(input);
      if (c.active) {
        if (toggle || !c.held) this.endClimax();
      } else if (c.ready) this.activateClimax(!toggle && !!input.hold.climax);
      else if (!c.busy) g.audio?.play('uiBack', { gain: 0.3 });
    }
    // barrel roll (jink on noRoll stages) shakes off enemy missiles nearby
    if (controls && (input.pressed.rollL || input.pressed.rollR)) {
      if (p.startRoll(input.pressed.rollL ? -1 : 1)) {
        g.audio?.play('roll');
        const n = st.missiles.breakLocks ? st.missiles.breakLocks(p.pos, 190) : 0;
        if (n) {
          this._evEvade.n = n;
          st.events.emit('evade', this._evEvade);
        }
      }
    }
    // flares
    this.flareCd -= wdt;
    if (controls && input.pressed.flare && this.flareCd <= 0) {
      this.flareCd = 6;
      st.missiles.flares(p.pos, p.velocity, 'player', 0.85);
      st.fx.flareBurst(p.pos, p.velocity);
      g.audio?.play('flare');
    }
  }

  /** Called once per sim step after enemies moved. */
  update(dt, wdt, input, controls) {
    this._ensureSetup();
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    const lockon = st.lockon;
    const c = st.climax;

    // lock-on (aiming at real time, not slowed by Climax)
    lockon.climax = c.active;
    lockon.aspect = g.rig.camera.aspect;
    lockon.update(dt, st.enemies, g.rig.camera, p.pos);
    if (lockon.newLocks > 0) {
      g.audio?.play('lockOn', { rate: 1 + Math.min(lockon.locks.length, 12) * 0.06 });
      this._evLock.n = lockon.newLocks;
      st.events.emit('lock', this._evLock);
    }

    // missiles
    if (c.active) {
      // Climax: locks only; mashing raises the salvo damage
      if (controls && input.pressed.missile) c.mash();
      this.holdT = 0;
    } else if (controls && c.phase !== 'salvo') {
      if (g.settings.missileMode === 'paint') {
        if (input.released.missile) {
          let n = Math.max(1, lockon.locks.length);
          while (n-- > 0 && st.stock.ready > 0) this.fireMissileButton();
        }
      } else {
        if (input.pressed.missile) {
          this.fireMissileButton();
          this.holdT = 0;
          this.rippleT = 1 / COMBAT.rippleRate;
        }
        if (input.hold.missile) {
          // hold: ripple one missile per new lock at 8 Hz
          this.holdT += dt;
          if (this.holdT >= COMBAT.holdRipple && this._autoMissile()) {
            if (this.rippleT > 0) this.rippleT -= dt;
            if (this.rippleT <= 0 && lockon.locks.length && st.stock.ready > 0) {
              this.fireAtLock();
              this.rippleT = 1 / COMBAT.rippleRate;
            }
          }
        } else this.holdT = 0;
      }
    }
    // Climax salvo: one missile per lock, 0.02 s apart
    if (c.phase === 'salvo') this._salvoStep(dt);
    st.stock.infinite = c.active || c.phase === 'salvo';
    st.stock.update(wdt);
    st.scoring.frozen = c.active || c.phase === 'salvo';
    p.boost = c.phase === 'afterburn' ? 1 : 0;

    // vulcan: along the camera ray through the reticle; auto-fires at a target near it.
    // The fire button is continuous; auto-fire alone (setting, or Climax) fires 1.4 s bursts
    // with 0.3 s pauses.
    const autoFire = g.settings.autoFire !== false;
    const at = lockon.assistTarget;
    const inGunRange = at != null && at.dist < COMBAT.gunRange;
    const manual = controls && !!input.hold.fire;
    const autoWant = controls && !manual && inGunRange && (autoFire || c.active);
    const trigger = manual || this.burst.update(dt, autoWant);
    this.aimDir(_aim);
    st.vulcan.assistStrength = ASSIST_STRENGTH[lockon.assist] ?? ASSIST_STRENGTH[2];
    st.vulcan.assistCone = ASSIST_CONE[lockon.assist] ?? ASSIST_CONE[2];
    const ms = st.missiles;
    const extra = typeof ms.shootables === 'function' ? ms.shootables(this._shoot) : null;
    st.vulcan.update(wdt, p, _aim, at, trigger, st.enemies, extra, this._onShootDown);
    this._gunSound(dt, trigger, !manual && this.burst.pausing);
  }

  /**
   * Vulcan loop debounce (see GUN_GATE): once started it runs ≥ 0.35 s and stops 0.25 s after
   * the last trigger (right away at a deliberate burst pause); a restart within 0.4 s resumes
   * at the loop start instead of replaying the spin-up.
   */
  _gunSound(dt, trigger, pause) {
    const a = this.game.audio;
    const act = this.gunGate.update(dt, trigger, pause);
    if (act === 'stop') {
      if (this._gunLoop) a?.stopLoop?.('vulcan');
      this._gunLoop = false;
    } else if (this.gunGate.on && (act || (trigger && !a?.isLooping?.('vulcan')))) {
      // (re)start; also retries while firing when audio was not ready or a stopAll cut the loop
      this._gunLoop = !!a?.startLoop?.('vulcan', act === 'start' ? undefined : RESUME);
    }
  }

  /** Climax gauge + timing (real time); after the sim step. */
  postUpdate(dt) {
    const st = this.stage;
    const c = st.climax;
    c.fill(dt, st.player.throttle);
    if (c.update(dt, !!this.game.input?.hold?.climax)) this.endClimax();
    const ready = c.ready;
    if (ready && !this._wasReady) this._emitClimax('ready');
    this._wasReady = ready;
    c.becameReady = false;
    if (this._clxOpen) {
      this._clxT += dt;
      if (this._clxT > COMBAT.climaxClearTimeout) this._clxOpen = false;
      else this._checkClimaxClear();
    }
  }

  /**
   * Vulcan aim: from the gun muzzle toward the point where the camera ray
   * through the reticle is `D` metres out (target distance or aimRange), so
   * the stream goes where the cursor is.
   */
  aimDir(out) {
    const st = this.stage;
    const p = st.player;
    const cam = this.game.rig.camera;
    const r = st.lockon.reticle;
    _ray.set(r.x, r.y, 0.5).unproject(cam).sub(cam.position).normalize();
    const at = st.lockon.assistTarget;
    const D = at ? clamp(at.dist || COMBAT.aimRange, 200, 1500) : COMBAT.aimRange;
    _mz.copy(p.pos).addScaledVector(p.forward, 7);
    out.copy(cam.position).addScaledVector(_ray, D).sub(_mz);
    if (out.lengthSq() < 1e-6) return out.copy(p.forward);
    return out.normalize();
  }

  firePlayerMissile(target, free = false, damage = COMBAT.missileDamage) {
    const st = this.stage;
    if (!free && !st.stock.take()) {
      this.game.audio?.play('uiBack', { gain: 0.4 });
      return false;
    }
    const p = st.player;
    st.jet.nextHardpoint(_s);
    _v2.copy(p.velocity).addScaledVector(st.rail.frameAt(p.s, _frame).U, -7);
    const m = st.missiles.launch('player', _s, _v2, target, { damage });
    if (target) st.lockon.refresh?.(target);
    this.game.session.stats.missilesFired++;
    return !!m;
  }

  /** One missile per press: oldest lock; else the assist target if it still needs one; else straight. */
  fireMissileButton() {
    const st = this.stage;
    const lockon = st.lockon;
    if (st.stock.ready <= 0 && !st.stock.infinite) {
      this.game.audio?.play('uiBack', { gain: 0.4 });
      return false;
    }
    let target = lockon.consume();
    const locked = !!target;
    if (!target) {
      const at = lockon.assistTarget;
      target = at && lockon.canTarget(at) ? at : null;
    }
    const ok = this.firePlayerMissile(target);
    this._evFox.locked = locked;
    st.events.emit('fox', this._evFox);
    return ok;
  }

  /** Ripple: one missile at the oldest lock. */
  fireAtLock() {
    const st = this.stage;
    const e = st.lockon.consume();
    if (!e) return false;
    const ok = this.firePlayerMissile(e);
    this._evFox.locked = true;
    st.events.emit('fox', this._evFox);
    return ok;
  }

  /** @param {boolean} hold sustain only while the Climax button is held */
  activateClimax(hold = false) {
    const st = this.stage;
    const c = st.climax;
    if (!c.activate(hold)) return false;
    const g = this.game;
    g.clock.scaleTo(c.timeScale, c.ramp);
    g.audio?.play('climaxStart');
    g.audio?.setTimeScale?.(c.timeScale);
    g.rig.fovKick = 6;
    g.rig.addTrauma(0.25);
    g.dynres.locked = true;
    g.session.stats.climaxUsed++;
    st.scoring.frozen = true;
    st.stock.infinite = true;
    this.holdT = 0;
    this._wasReady = false;
    this._emitClimax('start');
    return true;
  }

  /** End the slow-mo and start the salvo (safe to call after climax.end()). */
  endClimax() {
    const st = this.stage;
    const g = this.game;
    const c = st.climax;
    if (c.active) c.end();
    if (this._endedUse === c.uses || c.phase !== 'salvo') return;
    this._endedUse = c.uses;
    g.clock.scaleTo(1, 0.3);
    g.audio?.play('climaxEnd');
    g.audio?.setTimeScale?.(1);
    g.dynres.locked = false;
    g.rig.addTrauma(0.15);
    this.salvoT = 0;
    this.salvoN = 0;
    this._clxIds.clear();
    this._clxN = 0;
    this._clxKilled = 0;
    this._clxFailed = false;
    this._clxOpen = false;
    this._emitClimax('end', st.lockon.locks.length);
  }

  _salvoStep(dt) {
    const st = this.stage;
    const c = st.climax;
    this.salvoT -= dt;
    while (this.salvoT <= 0) {
      const e = st.lockon.consume();
      if (!e) {
        c.salvoDone();
        this._clxOpen = this._clxN > 0;
        this._clxT = 0;
        return;
      }
      this.firePlayerMissile(e, true, COMBAT.missileDamage * c.damageMul);
      if (!this._clxIds.has(e.id)) {
        this._clxIds.add(e.id);
        this._clxN++;
      }
      this.salvoN++;
      this.salvoT += c.salvoGap;
    }
  }

  _onKill(ev) {
    const st = this.stage;
    const res = ev.res;
    if (res && res.bonus > 0) this._emitCombo(st.scoring.combo, res.bonus, false);
    const id = ev.e?.id;
    if (this._clxIds.size && this._clxIds.has(id)) {
      this._clxIds.delete(id);
      this._clxKilled++;
      this._checkClimaxClear();
    }
  }

  _onEscape(ev) {
    const id = ev.e?.id;
    if (this._clxIds.has(id)) {
      this._clxIds.delete(id);
      this._clxFailed = true;
    }
  }

  /** All Climax targets destroyed → bonus. */
  _checkClimaxClear() {
    if (!this._clxOpen || this._clxIds.size) return;
    this._clxOpen = false;
    const n = this._clxN;
    if (this._clxFailed || this._clxKilled < n || n <= 0) return;
    const st = this.stage;
    const bonus = st.scoring.climaxClear ? st.scoring.climaxClear(n) : 0;
    if (!bonus) return;
    st.hudBridge?.popupAtScreen?.(0.5, 0.36, `CLIMAX CLEAR +${bonus}`, '#5fd4ff');
    this._emitCombo(n, bonus, true);
  }

  /** Render-time: place the reticle (NDC) just above the jet's nose. */
  updateReticle(realDt) {
    this._ensureSetup();
    const st = this.stage;
    const p = st.player;
    const cam = this.game.rig.camera;
    const lockon = st.lockon;
    _v.copy(st.jet.group.position).addScaledVector(p.forward, 6);
    if (projectPoint(cam, _v, _s)) {
      this.reticle.update(realDt, _s.x, _s.y, p.vx / (p.lateralSpeed || 150), p.vy / (p.verticalSpeed || 100), lockon.assistTarget, lockon.assist, cam.aspect, lockon.reticle);
    }
  }

  /** Death / stage end: stop Climax and drop locks. */
  onPlayerDown() {
    const st = this.stage;
    const c = st.climax;
    if (c.active) this.endClimax();
    if (c.phase === 'salvo' || c.phase === 'afterburn') c.cancel();
    st.lockon.reset();
    st.player.boost = 0;
    st.scoring.frozen = false;
    st.stock.infinite = false;
    this._clxOpen = false;
    this._clxIds.clear();
    this.holdT = 0;
  }

  dispose() {
    if (this._gunLoop) this.game.audio?.stopLoop?.('vulcan');
    this._gunLoop = false;
    this.gunGate.reset();
    this.burst.reset();
  }
}
