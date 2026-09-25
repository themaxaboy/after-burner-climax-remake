import { clamp } from '../core/math.js';

/**
 * Deterministic bot pilot used by automated tests and the benchmark:
 * - follows `stage.autopilotHint` ({x, y} rail-space targets, e.g. the safe
 *   terrain corridor or the chosen route) when it is set,
 * - otherwise sweeps the reticle over the best target that still needs a
 *   missile, or cruises back toward the middle of the (wide) box,
 * - taps MISSILE at pending locks, holds CLIMAX ~3 s when the gauge is full
 *   and there is a crowd, then releases (salvo),
 * - rolls (or jinks on noRoll stages) against incoming
 *   missiles, and keeps clear of the floor.
 */
export class Autopilot {
  constructor(game) {
    this.game = game;
    this.enabled = true;
    this.t = 0;
    this.fireCd = 0;
    this.rollCd = 0;
    this.climaxT = 0; // > 0 while holding the Climax button
    this.climaxHold = 3;
  }

  _release(input) {
    if (this.climaxT > 0) input.setHold('climax', false);
    this.climaxT = 0;
  }

  poll(input, dt) {
    if (!this.enabled) return;
    const st = this.game.state;
    if (!st || st.loading || !st.player || !st.lockon) {
      this.climaxT = 0;
      return;
    }
    this.t += dt;
    const p = st.player;
    const lo = st.lockon;
    const box = p.box || { x: 200, y: 80 };
    const hint = st.autopilotHint;
    const hx = hint && hint.x != null ? hint.x : null;
    const hy = hint && hint.y != null ? hint.y : null;

    // choose the on-screen target closest to the reticle that still needs a missile
    let best = null, bestD = Infinity, visible = 0;
    for (const e of st.enemies.list) {
      if (!e.active || e.dead || e.dying || !e.onScreen || !e.lockable) continue;
      visible++;
      if (lo.canTarget ? !lo.canTarget(e) : e.locks > 0) continue;
      const d = Math.hypot((e.sx - lo.reticle.x) * (lo.aspect || 1.78), e.sy - lo.reticle.y) + (e.dist || 0) / 8000;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    let tx, ty;
    if (best) {
      tx = clamp((best.sx - lo.reticle.x) * 3.2, -1, 1);
      ty = clamp((best.sy - lo.reticle.y) * 3.2, -1, 1);
    } else {
      // cruise: back toward the middle with a slow weave across the wide box
      const gx = Math.sin(this.t * 0.31) * box.x * 0.3;
      const gy = (p.boxCenterY || 0) + 10 + Math.sin(this.t * 0.23) * box.y * 0.2;
      tx = clamp((gx - p.x) / 45, -1, 1) * 0.7;
      ty = clamp((gy - p.y) / 25, -1, 1) * 0.6;
    }
    // stage hint (terrain corridor, route choice) wins when we are off it
    if (hx != null) {
      const ex = hx - p.x;
      const k = clamp((Math.abs(ex) - 8) / 30, 0, 1);
      tx = tx * (1 - k) + clamp(ex / 22 - p.vx / 260, -1, 1) * k;
    }
    if (hy != null) {
      const ey = hy - p.y;
      const k = clamp((Math.abs(ey) - 6) / 20, 0, 1);
      ty = ty * (1 - k) + clamp(ey / 20 - p.vy / 200, -1, 1) * k;
    }
    // floor safety
    const lim = st._lim;
    if (st.pullUp || (lim && p.y < lim.minY + 12)) ty = Math.max(ty, 0.85);
    else if (lim && p.y < lim.minY + 25) ty = Math.max(ty, 0.2);
    input.moveX += tx;
    input.moveY += ty;

    // missiles: one tap per pending lock
    this.fireCd -= dt;
    if (!st.climax.active && lo.locks.length && this.fireCd <= 0) {
      input.press('missile');
      this.fireCd = 0.14;
    }

    // Climax: hold ~3 s when the gauge is full and there's a crowd, then release
    if (this.climaxT > 0) {
      this.climaxT += dt;
      if (!st.climax.active || this.climaxT > this.climaxHold) this._release(input);
    } else if (st.climax.ready && visible >= 3 && !st.dead) {
      input.setHold('climax', true);
      this.climaxT = dt;
    }

    // evade missiles: roll (jink on noRoll stages) inside the missile's evade window
    // (no flares, so the missiles' cinematic arcs stay visible in demo/bench runs)
    this.rollCd -= dt;
    const th = st.enemyOps?.threat ?? st.hudState?.threat;
    if (th && th.tgo < 0.75 && this.rollCd <= 0) {
      const dir = p.x > box.x * 0.5 ? -1 : p.x < -box.x * 0.5 ? 1 : Math.sin(this.t) > 0 ? -1 : 1;
      input.press(dir < 0 ? 'rollL' : 'rollR');
      this.rollCd = 1.2;
    }
    input.throttleAxis = th ? 1 : visible > 4 ? -1 : 0;
  }
}
