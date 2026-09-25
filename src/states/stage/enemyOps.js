import { Vector3 } from 'three';
import { projectPoint } from '../../sim/lockon.js';

const _v = new Vector3();
const _v2 = new Vector3();
const _s = new Vector3();

/**
 * Enemy-side glue for a stage: enemy missile launches, aircraft collisions
 * (and near misses), incoming-missile threat for HUD/post/audio.
 * See docs/overhaul/CONTRACTS.md.
 */
export class EnemyOps {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    /** Current threat snapshot or null: {tgo, sx, sy, behind, strong} */
    this.threat = null;
    this._threat = { tgo: 0, sx: 0, sy: 0, behind: false, strong: false };
    this._warnLoop = false;
  }

  /** ctx.fireMissile(e): an enemy launches a missile at the player. */
  enemyMissile(e) {
    const st = this.stage;
    const p = st.player;
    _v.subVectors(p.pos, e.pos).normalize();
    _v2.copy(e.vel).addScaledVector(_v, 60);
    _s.copy(e.pos).addScaledVector(_v, e.radius + 3);
    st.missiles.launch('enemy', _s, _v2, p, { speedBonus: this.game.session.stars * 15 });
  }

  /** Collisions between the player and enemy aircraft (sim step). */
  update(dt, wdt) {
    const st = this.stage;
    const p = st.player;
    if (!p.alive || st.dead) return;
    for (const e of st.enemies.list) {
      if (!e.active || e.dead || !e.def.air) continue;
      const r = e.radius * 0.6 + 4;
      if (e.pos.distanceToSquared(p.pos) < r * r) {
        st.enemies.damage(e, 999, 'collision');
        st.playerHit(st.difficulty.collision, 'collision', e.pos);
      }
    }
  }

  /** Render-time threat (closest incoming missile) + warning loop. */
  updateThreat(realDt) {
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    const th = st.missiles.threat(p.pos, p.velocity);
    if (th && th.tgo < 6 && !st.dead) {
      const onScr = projectPoint(g.rig.camera, th.m.pos, _s);
      const t = this._threat;
      t.tgo = th.tgo;
      t.sx = _s.x;
      t.sy = _s.y;
      t.behind = !onScr;
      t.strong = !!th.m.strong;
      this.threat = t;
      if (!this._warnLoop) this._warnLoop = !!g.audio?.startLoop?.('missileAlert');
    } else {
      this.threat = null;
      if (this._warnLoop) {
        g.audio?.stopLoop?.('missileAlert');
        this._warnLoop = false;
      }
    }
    return this.threat;
  }

  /** Is any enemy currently chasing from behind? (HUD "ENEMY BEHIND") */
  enemyBehind() {
    for (const e of this.stage.enemies.list) {
      if (e.active && !e.dead && (e.behaviorName === 'chaser' || (e.behaviorName === 'ace' && e.b.phase === 2))) return true;
    }
    return false;
  }

  dispose() {
    if (this._warnLoop) this.game.audio?.stopLoop?.('missileAlert');
    this._warnLoop = false;
  }
}
