import { Vector3 } from 'three';
import { projectPoint } from '../../sim/lockon.js';
import { LoopGate, ALARM_GATE } from '../../audio/loopGates.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _s = new Vector3();

/** Player core radius added to an enemy's collision radius (m). */
export const PLAYER_CORE = 3;
/** Closest approach below this without contact is a near miss (m). */
export const NEAR_MISS = 35;
const NEAR_TRACK = 90;
/** Incoming-missile snapshot horizon (s): HUD edge arrow, autopilot. */
const THREAT_TGO = 6;
/** Warning (tone, MISSILE plate, post pulse) only when the closest missile is terminal or this close (s). */
export const WARN_TGO = 2.2;
/** Faster MISSILE plate blink below this time-to-go (s). */
export const URGENT_TGO = 1.2;
const RESUME = Object.freeze({ resume: true });

/**
 * Does an incoming missile call for the warning? Its terminal phase (m.phase === 1, after the
 * cinematic arc) or a short time-to-go; the arc itself stays quiet.
 */
export function warnQualifies(m, tgo) {
  return !!m && (m.phase === 1 || tgo < WARN_TGO);
}

/**
 * Enemy-side glue for a stage: enemy missile launches, aircraft collisions
 * and near misses, evade events, incoming-missile threat for HUD/post/audio.
 * See docs/overhaul/CONTRACTS.md §5.
 */
export class EnemyOps {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    /**
     * Current threat snapshot or null: {tgo, sx, sy, behind, strong, warn, urgent}.
     * warn = the missile warning is on (see warnActive); urgent = warn and tgo < URGENT_TGO.
     */
    this.threat = null;
    this._threat = { tgo: 0, sx: 0, sy: 0, behind: false, strong: false, warn: false, urgent: false };
    /** Missile warning on (hysteresis: ≥ 0.8 s on, off 0.4 s after the last qualifying threat). */
    this.warnActive = false;
    this._alarm = new LoopGate(ALARM_GATE);
    this._warnLoop = false;
    this._launch = { speedBonus: 0, strong: false, shooter: null, rs: undefined };
    this._evadeEv = { n: 0 };
    this._nearEv = { e: null, d: 0 };
  }

  /**
   * ctx.fireMissile(e): an enemy launches a missile at the player.
   * Returns false when the global enemy-missile caps say no (the caller may fire the gun instead).
   * The missile flies the cinematic arc (src/sim/missiles.js): from behind it overtakes and curls
   * back, from ahead it swings wide, from below it climbs out — always across the view.
   */
  enemyMissile(e) {
    const st = this.stage;
    const ms = st.missiles;
    ms.enemyCap = this.game.preset?.name === 'low' ? 4 : 6;
    if (!ms.canLaunchEnemy()) return false;
    const p = st.player;
    const stars = this.game.session?.stars || 0;
    _v.subVectors(p.pos, e.pos).normalize();
    _v2.copy(e.vel).addScaledVector(_v, 60);
    _s.copy(e.pos).addScaledVector(_v, e.radius + 3);
    const o = this._launch;
    o.speedBonus = stars * 15;
    o.strong = st.rng.next() < (e.def.missileStrong || 0) * (1 + stars * 0.15);
    o.shooter = e.id;
    o.rs = e.anchor === 'rail' ? e.rs : undefined;
    return !!ms.launch('enemy', _s, _v2, p, o);
  }

  /** Collisions, near misses and evade events (sim step, after missiles/guns). */
  update(dt, wdt) {
    const st = this.stage;
    const ms = st.missiles;
    if (ms.evaded > 0) {
      this._evadeEv.n = ms.evaded;
      ms.evaded = 0;
      st.events.emit('evade', this._evadeEv);
    }
    const p = st.player;
    if (!p.alive || st.dead) return;
    const list = st.enemies.list;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (!e.active || e.dead || e.dying > 0 || !e.def.air || !e.visible || e.behaviorName === 'attached') continue;
      const dx = e.pos.x - p.pos.x, dy = e.pos.y - p.pos.y, dz = e.pos.z - p.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > NEAR_TRACK * NEAR_TRACK) {
        if (e.nearD < NEAR_MISS && !e.nearDone) this._nearMiss(e);
        continue;
      }
      const d = Math.sqrt(d2);
      const r = e.radius + PLAYER_CORE;
      if (d < r) {
        e.nearDone = true;
        st.enemies.damage(e, 999, 'collision');
        st.playerHit(st.difficulty.collision, 'collision', e.pos);
        continue;
      }
      if (d < e.nearD) e.nearD = d;
      else if (!e.nearDone && e.nearD < NEAR_MISS && d > e.nearD + 0.5) this._nearMiss(e);
    }
  }

  _nearMiss(e) {
    const st = this.stage;
    e.nearDone = true;
    st.scoring.nearMiss?.();
    this.game.rig?.addTrauma?.(0.35);
    const ev = this._nearEv;
    ev.e = e;
    ev.d = e.nearD;
    st.events.emit('nearMiss', ev);
  }

  /**
   * Render-time threat (closest incoming missile) + missile warning. The snapshot covers the
   * whole approach (tgo < 6 s, edge arrow), the warning only the dangerous end of it
   * (warnQualifies) with hysteresis; the tone honours settings.missileTone ('soft' | 'off').
   */
  updateThreat(realDt) {
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    const th = st.missiles.threat(p.pos, p.velocity);
    let qualifies = false;
    if (th && th.tgo < THREAT_TGO && !st.dead) {
      const onScr = projectPoint(g.rig.camera, th.m.pos, _s);
      const t = this._threat;
      t.tgo = th.tgo;
      t.sx = _s.x;
      t.sy = _s.y;
      t.behind = !onScr;
      t.strong = !!th.m.strong;
      this.threat = t;
      qualifies = warnQualifies(th.m, th.tgo);
    } else this.threat = null;
    const act = this._alarm.update(realDt, qualifies);
    this.warnActive = this._alarm.on;
    if (this.threat) {
      this.threat.warn = this.warnActive;
      this.threat.urgent = this.warnActive && this.threat.tgo < URGENT_TGO;
    }
    // tone: follows the warning; a restart within the resume window continues at the loop start
    const tone = this.warnActive && g.settings?.missileTone !== 'off';
    // (a stopAll or an audio engine that was not ready yet leaves the tone to be (re)started)
    const playing = this._warnLoop && g.audio?.isLooping?.('missileAlert') !== false;
    if (tone && !playing) {
      this._warnLoop = !!g.audio?.startLoop?.('missileAlert', act === 'start' ? undefined : RESUME);
    } else if (!tone && this._warnLoop) {
      g.audio?.stopLoop?.('missileAlert');
      this._warnLoop = false;
    }
    return this.threat;
  }

  /** Is any enemy currently chasing from behind? (HUD "ENEMY BEHIND") */
  enemyBehind() {
    const st = this.stage;
    const ps = st.player.s;
    for (const e of st.enemies.list) {
      if (!e.active || e.dead) continue;
      const n = e.behaviorName;
      if (n === 'chaser' || (n === 'ace' && e.b.phase === 2)) return true;
      if ((n === 'overtakeClose' || (n === 'overtake' && e.b.phase === 0)) && e.anchor === 'rail' && e.rs < ps - 20) return true;
    }
    return false;
  }

  dispose() {
    if (this._warnLoop) this.game.audio?.stopLoop?.('missileAlert');
    this._warnLoop = false;
    this._alarm.reset();
    this.warnActive = false;
    this.threat = null;
  }
}
