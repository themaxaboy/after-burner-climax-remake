import { clamp, dampTo } from '../../core/math.js';
import { t } from '../../ui/i18n.js';
import { forkOf, plannedChoice } from '../routes.js';

/**
 * ROUTE SELECT at the end of a fork stage (CONTRACTS §2, §10): for the last
 * `duration` seconds the sky is cleared and hazes up, and the player steers
 * toward the big left / right arrows drawn by the HUD from
 * `stage.hudExtra.routeSelect`. Holding |x| > 0.35·box.x for `hold` seconds
 * commits; at the timeout the side of the jet decides (left when centred).
 * `?route=a,b,…` (params.route) pre-selects and forces the choice (autopilot
 * hint + commit), for tests. After the commit the jet banks away, the screen
 * whites out and the stage finishes with `stage.routeChoice` set.
 *
 * Opens `duration + outro` seconds of cruise before the end of the rail
 * (or on cue 'routeSelect'). Emits `routeSelect` events {phase, side, left, right}.
 *
 * opts: { duration = 7, hold = 1, outro = 1.6, radio: key spoken at open }
 */
export class RouteSelect {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = { duration: 7, hold: 1, outro: 1.6, ...opts };
    this.phase = 'idle'; // idle → open → commit → done
    this.t = 0;
    this.holdT = 0;
    this.side = 0;
    this.commitSide = 0;
    this.whiteout = 0;
    this.lockControls = false;
    this.hud = { hideCombat: false, hideGauges: false };
    const opts2 = forkOf(stage.def.id) || [];
    const left = opts2.find((o) => o.side < 0);
    const right = opts2.find((o) => o.side > 0);
    this.left = left ? { id: left.id, name: stageName(left.id) } : null;
    this.right = right ? { id: right.id, name: stageName(right.id) } : null;
    const planned = plannedChoice(stage.def.id, this.game.params?.route);
    this.forced = planned ? (planned === this.left?.id ? -1 : 1) : 0;
    this.ev = { phase: 'open', side: 0, left: this.left, right: this.right };
  }

  init() {
    const st = this.stage;
    // keep ~2.4 s of rail after the outro for the stage's finish delay
    const lead = (this.opts.duration + this.opts.outro + 2.4) * st.player.baseSpeed;
    this.openS = this.opts.at ?? Math.max(0, st.rail.length - lead);
  }

  cue(name) {
    if (name === 'routeSelect') this._open();
  }

  _open() {
    const st = this.stage;
    if (this.phase !== 'idle' || !this.left || !this.right || st.finished) return;
    this.phase = 'open';
    this.t = 0;
    this.hud.hideCombat = true;
    // clear the sky: enemies off-screen go (order targets count as escaped),
    // missiles in flight are dropped
    for (const e of st.enemies.list.slice()) if (!e.onScreen && !e.dying) st.enemies.despawn(e, !!e.tag && !e.dead);
    st.missiles.reset?.();
    if (st.climax.active) {
      st.climax.end();
      st._endClimax();
    }
    this._publish();
    this.ev.phase = 'open';
    this.ev.side = this.side;
    st.events.emit('routeSelect', this.ev);
    if (this.opts.radio) st._radio(this.opts.radio, { priority: 0 });
  }

  _publish() {
    const rs = this.stage.hudExtra.routeSelect || (this.stage.hudExtra.routeSelect = { left: this.left, right: this.right, side: 0, t: 0, commit: 0 });
    rs.side = this.side;
    rs.t = this.phase === 'open' ? clamp(this.t / this.opts.duration, 0, 1) : 1;
    rs.commit = this.commitSide;
  }

  _commit(side) {
    const st = this.stage;
    this.phase = 'commit';
    this.commitSide = side;
    this.t = 0;
    this.lockControls = true;
    st.routeChoice = side < 0 ? this.left.id : this.right.id;
    this._publish();
    this.ev.phase = 'commit';
    this.ev.side = side;
    st.events.emit('routeSelect', this.ev);
    this.game.audio?.play('uiSelect');
  }

  preUpdate(dt) {
    const st = this.stage;
    const p = st.player;
    if (this.phase === 'idle') {
      if (p.s >= this.openS && !st.finished) this._open();
      if (this.phase === 'idle') return;
    }
    if (this.phase === 'done') return;
    // cruise speed while choosing so the rail cannot run out
    p.autoSpeed = p.baseSpeed;
    const box = p.box.x;
    if (this.phase === 'open') {
      this.t += dt;
      this.whiteout = dampTo(this.whiteout, 0.32, 1.2, dt);
      const lean = Math.abs(p.x) > 0.1 * box ? Math.sign(p.x) : 0;
      this.side = lean;
      if (this.forced) st.autopilotHint.x = this.forced * 0.6 * box;
      const over = Math.abs(p.x) > 0.35 * box;
      this.holdT = over ? this.holdT + dt : 0;
      if (this.forced) {
        if ((over && Math.sign(p.x) === this.forced && this.holdT >= this.opts.hold) || this.t >= this.opts.duration) this._commit(this.forced);
      } else if (this.holdT >= this.opts.hold) this._commit(Math.sign(p.x));
      else if (this.t >= this.opts.duration) this._commit(lean || -1);
      this._publish();
    } else if (this.phase === 'commit') {
      // bank away toward the chosen arrow, then white out into the next stage
      this.t += dt;
      p.controlLock = Math.max(p.controlLock, 0.1);
      p.x = dampTo(p.x, this.commitSide * box * 0.9, 1.6, dt);
      p.vx = this.commitSide * 60;
      st.autopilotHint.x = this.commitSide * box * 0.9;
      this.whiteout = clamp(0.32 + (this.t / this.opts.outro) * 0.68, 0, 1);
      this._publish();
      if (this.t >= this.opts.outro) {
        this.phase = 'done';
        st._finish();
      }
    }
  }

  dispose() {
    this.stage.hudExtra.routeSelect = null;
  }
}

function stageName(id) {
  const v = t(`stage.${id}.name`);
  return typeof v === 'string' && v !== `stage.${id}.name` ? v : id.toUpperCase();
}

export const routeSelect = (opts) => (stage) => new RouteSelect(stage, opts);
