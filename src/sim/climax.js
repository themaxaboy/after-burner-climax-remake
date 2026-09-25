/**
 * CLIMAX mode: fill the gauge (time + kills, faster at FAST throttle),
 * activate for slow motion with a huge lock circle and unlimited locks;
 * when it ends one missile is fired at every lock. Mashing the missile
 * button during Climax raises the damage multiplier up to 2x.
 */
export class Climax {
  constructor() {
    this.reset();
    this.passiveRate = 1 / 75; // full in ~75 s of flying
    this.killGain = 0.045;
    this.bigKillGain = 0.2;
    this.duration = 4.6; // real seconds
    this.timeScale = 0.3;
    this.infinite = false;
  }

  reset() {
    this.gauge = 0;
    this.active = false;
    this.t = 0;
    this.damageMul = 1;
    this.presses = 0;
    this.uses = 0;
  }

  get ready() {
    return this.gauge >= 1 && !this.active;
  }

  fill(realDt, throttle) {
    if (this.active) return;
    const k = throttle > 0 ? 1.5 : throttle < 0 ? 0.8 : 1;
    this.gauge = Math.min(1, this.gauge + this.passiveRate * realDt * k);
  }

  onKill(big, throttle) {
    if (this.active) return;
    const k = throttle > 0 ? 1.5 : 1;
    this.gauge = Math.min(1, this.gauge + (big ? this.bigKillGain : this.killGain) * k);
  }

  activate() {
    if (!this.ready && !this.infinite) return false;
    this.active = true;
    this.t = 0;
    this.damageMul = 1;
    this.presses = 0;
    this.uses++;
    return true;
  }

  mash() {
    if (!this.active) return;
    this.presses++;
    this.damageMul = Math.min(2, 1 + this.presses * 0.1);
  }

  /** Returns true on the step Climax ends. */
  update(realDt) {
    if (!this.active) return false;
    this.t += realDt;
    this.gauge = Math.max(0, 1 - this.t / this.duration);
    if (this.t >= this.duration) return this.end();
    return false;
  }

  end() {
    if (!this.active) return false;
    this.active = false;
    this.gauge = this.infinite ? 1 : 0;
    return true;
  }
}
