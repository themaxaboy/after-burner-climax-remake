import { clamp01, easeInOutCubic } from './math.js';

// Two time bases:
//   real  — wall clock (UI, aiming, lock dwell, HUD)
//   world — real * timeScale (entities, particles, rail, physics)
// timeScale is animated with small tweens (Climax slow-mo, kill-cam).
export class Clock {
  constructor() {
    this.realTime = 0;
    this.worldTime = 0;
    this.timeScale = 1;
    this.paused = false;
    this._tween = null; // {from, to, t, dur}
    this._holdUntil = -1;
    this._after = null;
  }

  /** Tween timeScale to `to` over `dur` real seconds. */
  scaleTo(to, dur = 0.25) {
    if (dur <= 0) {
      this.timeScale = to;
      this._tween = null;
      return;
    }
    this._tween = { from: this.timeScale, to, t: 0, dur };
  }

  /**
   * Slow down to `scale` for `hold` real seconds then return to 1.
   */
  pulse(scale, hold, easeIn = 0.15, easeOut = 0.35) {
    this.scaleTo(scale, easeIn);
    this._holdUntil = this.realTime + easeIn + hold;
    this._after = easeOut;
  }

  cancelPulse(easeOut = 0.3) {
    this._holdUntil = -1;
    this._after = null;
    this.scaleTo(1, easeOut);
  }

  advanceReal(dt) {
    this.realTime += dt;
    if (this._tween) {
      const tw = this._tween;
      tw.t += dt;
      const k = easeInOutCubic(clamp01(tw.t / tw.dur));
      this.timeScale = tw.from + (tw.to - tw.from) * k;
      if (tw.t >= tw.dur) this._tween = null;
    }
    if (this._holdUntil >= 0 && this.realTime >= this._holdUntil) {
      this._holdUntil = -1;
      this.scaleTo(1, this._after ?? 0.3);
      this._after = null;
    }
  }

  advanceWorld(dt) {
    this.worldTime += dt;
  }
}
