/**
 * CLIMAX mode state machine (all times are real seconds):
 *
 *   idle ──gauge full──▶ ready ──activate()──▶ active ──end()──▶ salvo ──salvoDone()──▶ afterburn ──2 s──▶ idle/ready
 *
 * - The gauge fills passively (1/45 per s, ×1.5 at FAST) and with kills.
 * - Activation needs a FULL gauge. While active, time slows (`timeScale`),
 *   the lock circle becomes huge, locks are unlimited, missiles are free and
 *   the combo is frozen; mashing the missile button raises `damageMul` (≤ 2).
 * - Hold mode (`activate(true)`, the button): Climax lasts while the button is
 *   held, up to `duration`; the gauge drains meanwhile. Releasing early (after
 *   `minHold`) ends it and KEEPS the remainder, but re-activation still needs a
 *   full gauge.
 *   Timed mode (`activate(false)`: toggle setting, touch, scripts) runs until
 *   `end()` or the gauge runs out.
 * - `end()` → `salvo`: the caller fires one missile at every lock, then calls
 *   `salvoDone()` → `afterburn` (forced afterburner look) → back to idle.
 */
export class Climax {
  constructor() {
    this.passiveRate = 1 / 45; // full in ~45 s of flying
    this.fastMul = 1.5;
    this.killGain = 0.035;
    this.bigKillGain = 0.15;
    this.duration = 5.5; // real seconds of a full gauge
    this.minHold = 0.5; // s: a quick tap still gives a short Climax
    this.timeScale = 0.25;
    this.ramp = 0.2; // s, time-scale ease in
    this.salvoGap = 0.02; // s between salvo missiles
    this.afterburnTime = 2;
    this.mashStep = 0.1;
    this.maxDamageMul = 2;
    this.infinite = false;
    this.uses = 0;
    this.reset();
  }

  reset() {
    this.gauge = 0;
    this.phase = 'idle';
    this.active = false;
    this.held = false;
    this.t = 0;
    this.phaseT = 0;
    this.damageMul = 1;
    this.presses = 0;
    this.becameReady = false; // edge flag: gauge just filled (consumer clears it)
  }

  get ready() {
    return (this.gauge >= 1 || this.infinite) && (this.phase === 'idle' || this.phase === 'ready');
  }

  /** Busy phases where the gauge doesn't fill. */
  get busy() {
    return this.phase === 'active' || this.phase === 'salvo' || this.phase === 'afterburn';
  }

  _add(v) {
    if (this.busy) return;
    const was = this.gauge;
    this.gauge = Math.min(1, this.gauge + v);
    if (this.gauge >= 1 && was < 1) {
      this.phase = 'ready';
      this.becameReady = true;
    }
  }

  fill(realDt, throttle) {
    this._add(this.passiveRate * realDt * (throttle > 0 ? this.fastMul : 1));
  }

  onKill(big, throttle) {
    this._add((big ? this.bigKillGain : this.killGain) * (throttle > 0 ? this.fastMul : 1));
  }

  /** Start Climax. `hold`: sustain only while the button stays held. */
  activate(hold = false) {
    if (!this.ready) return false;
    if (this.infinite) this.gauge = 1;
    this.phase = 'active';
    this.active = true;
    this.held = !!hold;
    this.t = 0;
    this.phaseT = 0;
    this.damageMul = 1;
    this.presses = 0;
    this.becameReady = false;
    this.uses++;
    return true;
  }

  mash() {
    if (!this.active) return;
    this.presses++;
    this.damageMul = Math.min(this.maxDamageMul, 1 + this.presses * this.mashStep);
  }

  /**
   * @param {number} realDt
   * @param {boolean} holding current state of the Climax button (hold mode)
   * @returns {boolean} true on the step Climax ends (active → salvo)
   */
  update(realDt, holding = true) {
    if (this.phase === 'active') {
      this.t += realDt;
      this.gauge = Math.max(0, this.gauge - realDt / this.duration);
      if (this.infinite) this.gauge = Math.max(this.gauge, 0.001);
      if ((this.held && !holding && this.t >= this.minHold) || this.gauge <= 0) return this.end();
      return false;
    }
    if (this.phase === 'afterburn') {
      this.phaseT += realDt;
      if (this.phaseT >= this.afterburnTime) this.phase = this.gauge >= 1 ? 'ready' : 'idle';
    } else if (this.phase === 'idle' && this.gauge >= 1) this.phase = 'ready'; // gauge set directly
    else if (this.phase === 'ready' && this.gauge < 1) this.phase = 'idle';
    return false;
  }

  /** Stop the slow-mo; the caller fires the salvo, then calls salvoDone(). */
  end() {
    if (!this.active) return false;
    this.active = false;
    this.held = false;
    this.phase = 'salvo';
    this.phaseT = 0;
    if (this.infinite) this.gauge = 1;
    return true;
  }

  salvoDone() {
    if (this.phase !== 'salvo') return;
    this.phase = 'afterburn';
    this.phaseT = 0;
    this.damageMul = 1;
  }

  /** Abort without salvo/afterburn (player down, stage exit). */
  cancel() {
    this.active = false;
    this.held = false;
    this.damageMul = 1;
    this.phase = this.gauge >= 1 ? 'ready' : 'idle';
  }
}
