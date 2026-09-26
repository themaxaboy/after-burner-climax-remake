/**
 * loopGates.js - tiny pure state machines that decide when a looping sound
 * (or an auto-fire burst) is on. No Web Audio, no allocations per update;
 * unit-tested in node (tests/unit/audio.test.js).
 *
 *   LoopGate  - debounced loop on/off: minimum on-time, release delay after
 *               the last request, and a "resume" window in which a restart
 *               continues at the loop start (no intro / spin-up replay).
 *   BurstGate - auto-fire bursts: `on` s of fire, then `off` s of pause.
 */

/** Missile warning tone: ≥ 0.8 s on, off 0.4 s after the last threat, resume within 1.5 s. */
export const ALARM_GATE = Object.freeze({ minOn: 0.8, release: 0.4, resume: 1.5 });
/** Vulcan loop: ≥ 0.35 s on, off 0.25 s after the last trigger, resume within 0.4 s. */
export const GUN_GATE = Object.freeze({ minOn: 0.35, release: 0.25, resume: 0.4 });
/** Auto-fire (not the fire button): 1.4 s bursts, 0.3 s pauses. */
export const AUTO_BURST = Object.freeze({ on: 1.4, off: 0.3 });

export class LoopGate {
  constructor({ minOn = 0, release = 0, resume = 0 } = {}) {
    this.minOn = minOn;
    this.release = release;
    this.resume = resume;
    this.reset();
  }

  /** Back to "off, long ago" (the next start is a fresh start, not a resume). */
  reset() {
    this.on = false;
    this.onT = 0; // s since the loop started
    this.idleT = 0; // s since the last request while on
    this.offT = Infinity; // s since the loop stopped
  }

  /**
   * Advance by dt with the current request.
   * cut = stop as soon as the minimum on-time allows (deliberate pause, no release delay).
   * Returns 'start' | 'resume' | 'stop' | null (what the caller should do this step).
   */
  update(dt, want, cut = false) {
    const d = dt > 0 ? dt : 0;
    if (!this.on) {
      this.offT += d;
      if (!want) return null;
      this.on = true;
      this.onT = 0;
      this.idleT = 0;
      return this.offT < this.resume ? 'resume' : 'start';
    }
    this.onT += d;
    if (want) {
      this.idleT = 0;
      return null;
    }
    this.idleT += d;
    if (this.onT >= this.minOn && (cut || this.idleT >= this.release)) {
      this.on = false;
      this.offT = 0;
      return 'stop';
    }
    return null;
  }
}

export class BurstGate {
  constructor({ on = 1.4, off = 0.3 } = {}) {
    this.onDur = on;
    this.offDur = off;
    this.reset();
  }

  reset() {
    this.phase = 0; // 0 idle, 1 firing, 2 pause
    this.t = 0; // s into the current burst / pause
    this.gap = 0; // s without a request inside a burst
  }

  /** True while in the deliberate pause between two bursts. */
  get pausing() {
    return this.phase === 2;
  }

  /** Advance by dt with the current auto-fire request; returns whether to fire this step. */
  update(dt, want) {
    const d = dt > 0 ? dt : 0;
    if (this.phase === 0) {
      if (!want) return false;
      this.phase = 1;
      this.t = 0;
      this.gap = 0;
      return true;
    }
    this.t += d;
    if (this.phase === 1) {
      this.gap = want ? 0 : this.gap + d;
      if (this.t >= this.onDur) {
        this.phase = 2;
        this.t = 0;
        return false;
      }
      // a natural gap as long as a pause counts as one: the next burst is a full one
      if (this.gap >= this.offDur) {
        this.phase = 0;
        return false;
      }
      return want;
    }
    // pause
    if (this.t < this.offDur) return false;
    if (!want) {
      this.phase = 0;
      return false;
    }
    this.phase = 1;
    this.t = 0;
    this.gap = 0;
    return true;
  }
}
