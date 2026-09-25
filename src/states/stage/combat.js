import { Vector3 } from 'three';
import { makeFrame } from '../../sim/rail.js';
import { projectPoint } from '../../sim/lockon.js';
import { clamp, dampTo } from '../../core/math.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _s = new Vector3();
const _frame = makeFrame();

/**
 * Player-side combat for a stage: lock-on, missiles, Climax, vulcan, barrel
 * roll, reticle placement. Owned by the stage; talks to the rest of the game
 * through `stage.events` (see docs/overhaul/CONTRACTS.md).
 */
export class Combat {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.salvo = [];
    this.salvoT = 0;
    this.flareCd = 0;
    this.lastGunSfx = 0;
    this.reticleOffset = { x: 0, y: 0 };
    this._gunLoop = false;
  }

  /** Called once per sim step before the player moves. */
  preUpdate(dt, wdt, input, controls) {
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    // Climax toggle (press to start, press again to end early)
    if (controls && input.pressed.climax) {
      if (st.climax.active) {
        st.climax.end();
        this.endClimax();
      } else if (st.climax.ready) this.activateClimax();
      else g.audio?.play('uiBack', { gain: 0.3 });
    }
    // barrel roll breaks enemy missile locks nearby
    if (controls && (input.pressed.rollL || input.pressed.rollR)) {
      if (p.startRoll(input.pressed.rollL ? -1 : 1)) {
        g.audio?.play('roll');
        const n = st.missiles.breakLocks(p.pos, 190);
        if (n) st.events.emit('evade', { n });
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
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    const lockon = st.lockon;

    // lock-on (aiming at real time, not slowed by Climax)
    lockon.climax = st.climax.active;
    lockon.aspect = g.rig.camera.aspect;
    lockon.update(dt, st.enemies, g.rig.camera, p.pos);
    if (lockon.newLocks > 0) {
      g.audio?.play('lockOn', { rate: 1 + Math.min(lockon.locks.length, 12) * 0.06 });
      st.events.emit('lock', { n: lockon.newLocks });
    }

    // missiles
    if (controls) {
      if (st.climax.active) {
        if (input.pressed.missile) st.climax.mash();
      } else if (g.settings.missileMode === 'paint') {
        if (input.released.missile) {
          let n = lockon.locks.length || 1;
          while (n-- > 0) this.fireMissileButton();
        }
      } else if (input.pressed.missile) this.fireMissileButton();
    }
    // climax salvo ripple
    if (this.salvo.length) {
      this.salvoT -= dt;
      while (this.salvoT <= 0 && this.salvo.length) {
        const tgt = this.salvo.shift();
        if (tgt.e.id === tgt.id && tgt.e.active && !tgt.e.dead) this.firePlayerMissile(tgt.e, true);
        this.salvoT += 0.035;
      }
    }
    st.stock.update(wdt);

    // vulcan: auto-fire when a target is near the reticle
    const autoFire = g.settings.autoFire !== false;
    const at = lockon.assistTarget;
    const inGunRange = at != null && at.dist < 1500;
    const trigger = controls && (input.hold.fire || (autoFire && inGunRange) || (st.climax.active && inGunRange));
    this.aimDir(_v);
    st.vulcan.assistStrength = [0, 0.55, 0.9][lockon.assist] ?? 0.9;
    st.vulcan.assistCone = ([2, 4, 7][lockon.assist] ?? 7) * (Math.PI / 180);
    st.vulcan.update(wdt, p, _v, lockon.assistTarget, trigger, st.enemies);
    if (trigger && st.time - this.lastGunSfx > 0.05) {
      if (!this._gunLoop) this._gunLoop = !!g.audio?.startLoop?.('vulcan');
      this.lastGunSfx = st.time;
    } else if (!trigger && this._gunLoop) {
      g.audio?.stopLoop?.('vulcan');
      this._gunLoop = false;
    }
  }

  /** Climax gauge + timing (real time); after the sim step. */
  postUpdate(dt) {
    const st = this.stage;
    st.climax.fill(dt, st.player.throttle);
    if (st.climax.update(dt)) this.endClimax();
  }

  aimDir(out) {
    return out.copy(this.stage.player.forward);
  }

  firePlayerMissile(target, free = false) {
    const st = this.stage;
    if (!free && !st.stock.take()) {
      this.game.audio?.play('uiBack', { gain: 0.4 });
      return false;
    }
    const p = st.player;
    st.jet.nextHardpoint(_s);
    _v2.copy(p.velocity).addScaledVector(st.rail.frameAt(p.s, _frame).U, -7);
    const m = st.missiles.launch('player', _s, _v2, target, { damage: 12 * st.climax.damageMul });
    this.game.session.stats.missilesFired++;
    return !!m;
  }

  fireMissileButton() {
    const st = this.stage;
    const target = st.lockon.consume();
    if (target) this.firePlayerMissile(target);
    else {
      // unguided: seek the assist target if any, else fly straight
      this.firePlayerMissile(st.lockon.assistTarget || null);
    }
    st.events.emit('fox', { locked: !!target });
  }

  activateClimax() {
    const st = this.stage;
    if (!st.climax.activate()) return;
    const g = this.game;
    g.clock.scaleTo(st.climax.timeScale, 0.25);
    g.audio?.play('climaxStart');
    g.audio?.setTimeScale?.(st.climax.timeScale);
    g.rig.fovKick = 8;
    g.rig.addTrauma(0.2);
    g.dynres.locked = true;
    g.session.stats.climaxUsed++;
    st.events.emit('climax', { phase: 'start' });
  }

  endClimax() {
    const st = this.stage;
    const g = this.game;
    g.clock.scaleTo(1, 0.35);
    g.audio?.play('climaxEnd');
    g.audio?.setTimeScale?.(1);
    g.dynres.locked = false;
    // one missile per lock, rippled
    this.salvo = st.lockon.snapshot(this.salvo);
    st.lockon.reset();
    this.salvoT = 0;
    st.events.emit('climax', { phase: 'end', salvo: this.salvo.length });
  }

  /** Render-time: place the reticle (NDC) in front of the jet. */
  updateReticle(realDt) {
    const st = this.stage;
    const p = st.player;
    const cam = this.game.rig.camera;
    const lockon = st.lockon;
    // reticle: 600 m ahead of the jet, projected; eased toward the assist target
    _v.copy(st.jet.group.position).addScaledVector(p.forward, 600);
    if (projectPoint(cam, _v, _s)) {
      const at = lockon.assistTarget;
      let ox = 0, oy = 0;
      if (at && at.onScreen && lockon.assist > 0) {
        const k = 0.35 * (lockon.assist / 2);
        ox = clamp((at.sx - _s.x) * k, -0.1, 0.1);
        oy = clamp((at.sy - _s.y) * k, -0.1, 0.1);
      }
      this.reticleOffset.x = dampTo(this.reticleOffset.x, ox, 8, realDt);
      this.reticleOffset.y = dampTo(this.reticleOffset.y, oy, 8, realDt);
      lockon.reticle.x = _s.x + this.reticleOffset.x;
      lockon.reticle.y = _s.y + this.reticleOffset.y;
    }
  }

  /** Death / stage end: stop Climax and drop locks. */
  onPlayerDown() {
    const st = this.stage;
    if (st.climax.active) {
      st.climax.end();
      this.endClimax();
    }
    st.lockon.reset();
  }

  dispose() {
    if (this._gunLoop) this.game.audio?.stopLoop?.('vulcan');
    this._gunLoop = false;
  }
}
