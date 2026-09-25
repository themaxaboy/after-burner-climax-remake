import { clamp } from '../core/math.js';

/**
 * Deterministic bot pilot used by automated tests and the benchmark:
 * steers the reticle toward the best target, fires missiles on locks,
 * triggers Climax when crowded, rolls/flares against incoming missiles and
 * keeps clear of the floor.
 */
export class Autopilot {
  constructor(game) {
    this.game = game;
    this.enabled = true;
    this.t = 0;
    this.fireCd = 0;
    this.rollCd = 0;
  }

  poll(input, dt) {
    if (!this.enabled) return;
    const st = this.game.state;
    if (!st || st.loading || !st.player) return;
    this.t += dt;
    const p = st.player;
    const lo = st.lockon;
    let tx = 0, ty = 0;
    // choose the on-screen target closest to the reticle
    let best = null, bestD = Infinity;
    for (const e of st.enemies.list) {
      if (!e.active || e.dead || !e.onScreen || !e.lockable) continue;
      const d = Math.hypot(e.sx - lo.reticle.x, e.sy - lo.reticle.y) + (e.dist || 0) / 8000;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) {
      tx = clamp((best.sx - lo.reticle.x) * 4, -1, 1);
      ty = clamp((best.sy - lo.reticle.y) * 4, -1, 1);
    } else {
      // drift back to centre with a gentle weave
      tx = clamp(-p.x / 40, -1, 1) * 0.6 + Math.sin(this.t * 0.7) * 0.2;
      ty = clamp(-(p.y - 5) / 25, -1, 1) * 0.6;
    }
    if (st.pullUp) ty = Math.max(ty, 0.8);
    input.moveX += tx;
    input.moveY += ty;
    // missiles: fire at locks
    this.fireCd -= dt;
    if (lo.locks.length && this.fireCd <= 0) {
      input.press('missile');
      input.setHold('missile', true);
      this.fireCd = 0.18;
    } else if (this.fireCd < 0.1) input.setHold('missile', false);
    // climax when there's a crowd
    let visible = 0;
    for (const e of st.enemies.list) if (e.onScreen && !e.dead) visible++;
    if (st.climax.ready && visible >= 3) input.press('climax');
    // evade missiles
    this.rollCd -= dt;
    const th = st.hudState?.threat;
    if (th && th.tgo < 1.6 && this.rollCd <= 0) {
      input.press(Math.sin(this.t) > 0 ? 'rollL' : 'rollR');
      input.press('flare');
      this.rollCd = 1.2;
    }
    input.throttleAxis = th ? 1 : visible > 4 ? -1 : 0;
  }
}
