// Fixed-step simulation with render interpolation.
//
//   frame(realDt):
//     acc += realDt
//     while acc >= STEP: update(STEP_real, STEP_real * timeScale); acc -= STEP
//     render(alpha = acc / STEP, realDt)
//
// The sim always advances in STEP real-seconds slices so Climax slow-mo
// (timeScale < 1) just shrinks worldDt while keeping input sampling at 120 Hz.
export const SIM_HZ = 120;
export const STEP = 1 / SIM_HZ;

export class Loop {
  constructor({ update, render, clock, maxSteps = 8, fixedDt = 0, turbo = 1 }) {
    this.update = update;
    this.render = render;
    this.clock = clock;
    this.maxSteps = maxSteps;
    this.fixedDt = fixedDt; // when >0, every frame advances exactly this much real time
    this.turbo = turbo; // sim-speed multiplier for automated tests
    this.acc = 0;
    this.last = -1;
    this.running = false;
    this.frame = 0;
    this.alpha = 0;
    this.onFrameEnd = null; // (realDt, now, workMs) after every rendered frame, same task
    this.minFrameMs = 0; // optional frame-rate cap
    this._raf = 0;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
  }

  /** Advance one frame of `realDt` seconds. Exposed for tests. */
  step(realDt) {
    const clock = this.clock;
    let steps = 0;
    this.acc += realDt * this.turbo;
    const maxSteps = this.maxSteps * this.turbo;
    while (this.acc >= STEP && steps < maxSteps) {
      if (!clock.paused) {
        clock.advanceReal(STEP);
        const worldDt = STEP * clock.timeScale;
        clock.advanceWorld(worldDt);
        this.update(STEP, worldDt);
      } else {
        // paused: menus still need input, but no time passes
        this.update(STEP, 0);
      }
      this.acc -= STEP;
      steps++;
    }
    if (steps >= maxSteps) this.acc = Math.min(this.acc, STEP); // drop backlog (hitch)
    this.alpha = this.acc / STEP;
    this.render(this.alpha, realDt);
    this.frame++;
    return steps;
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    if (this.minFrameMs > 0 && this.last >= 0 && now - this.last < this.minFrameMs) return;
    let realDt;
    if (this.fixedDt > 0) realDt = this.fixedDt;
    else {
      realDt = this.last < 0 ? 1 / 60 : (now - this.last) / 1000;
      if (realDt > 0.1) realDt = 0.1;
      if (realDt < 0) realDt = 0;
    }
    this.last = now;
    const t0 = performance.now();
    this.step(realDt);
    // workMs: CPU time of this frame's update + render submission (realDt also
    // contains vsync waits and GPU back-pressure)
    if (this.onFrameEnd) this.onFrameEnd(realDt, now, performance.now() - t0);
  }
}
