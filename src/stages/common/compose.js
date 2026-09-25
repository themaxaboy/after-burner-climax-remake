/**
 * Merge stage components into one stage-logic object (CONTRACTS §2.2).
 *
 *   createLogic: compose(terrainRun(def.terrain), radarCeiling(), strikeRun({...}))
 *
 * Each argument is a factory `(stage) => component` (falsy entries are
 * skipped). Components use the same member names as a stage logic:
 * - lifecycle `init` (awaited in order), `preUpdate`, `update`, `render`,
 *   `dispose` (reverse order), hooks `cue`, `onKill` — all called in order;
 * - flags `lockControls`, `cameraOverride`, `handlesMusic`,
 *   `skipIntroMessage` — OR-ed, read live (components flip them over time);
 * - `hud` {hideCombat, hideGauges (OR-ed), timer (first non-null)},
 *   `radarWarning` (first non-null), `whiteout` (max);
 * - `groundAt(s, x)` from the first component that provides it.
 */
export function compose(...factories) {
  const list = factories.flat().filter(Boolean);
  return (stage) => new ComposedLogic(stage, list.map((f) => (typeof f === 'function' ? f(stage) : f)));
}

export class ComposedLogic {
  constructor(stage, parts) {
    this.stage = stage;
    this.parts = parts.filter(Boolean);
    this._hud = { hideCombat: false, hideGauges: false, timer: null };
    this.groundAt = undefined;
    this._resolveGround();
  }

  _resolveGround() {
    const g = this.parts.find((p) => typeof p.groundAt === 'function');
    this.groundAt = g ? (s, x) => g.groundAt(s, x) : undefined;
  }

  /** First component that is an instance of `Class` (cross-component access). */
  part(Class) {
    return this.parts.find((p) => p instanceof Class) || null;
  }

  async init() {
    for (const p of this.parts) await p.init?.();
    this._resolveGround();
  }

  preUpdate(dt, wdt) {
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) ps[i].preUpdate?.(dt, wdt);
  }

  update(dt, wdt) {
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) ps[i].update?.(dt, wdt);
  }

  render(alpha, realDt) {
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) ps[i].render?.(alpha, realDt);
  }

  cue(name, ev) {
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) ps[i].cue?.(name, ev);
  }

  onKill(e) {
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) ps[i].onKill?.(e);
  }

  dispose() {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].dispose?.();
  }

  _any(flag) {
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) if (ps[i][flag]) return true;
    return false;
  }

  get lockControls() {
    return this._any('lockControls');
  }

  get cameraOverride() {
    return this._any('cameraOverride');
  }

  get handlesMusic() {
    return this._any('handlesMusic');
  }

  get skipIntroMessage() {
    return this._any('skipIntroMessage');
  }

  get hud() {
    const h = this._hud;
    h.hideCombat = false;
    h.hideGauges = false;
    h.timer = null;
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) {
      const ph = ps[i].hud;
      if (!ph) continue;
      if (ph.hideCombat) h.hideCombat = true;
      if (ph.hideGauges) h.hideGauges = true;
      if (!h.timer && ph.timer) h.timer = ph.timer;
    }
    return h;
  }

  get radarWarning() {
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) if (ps[i].radarWarning) return ps[i].radarWarning;
    return null;
  }

  get whiteout() {
    let w = 0;
    const ps = this.parts;
    for (let i = 0; i < ps.length; i++) w = Math.max(w, ps[i].whiteout || 0);
    return w;
  }
}

/** Ground height under a rail-space point through the stage's logic (0 = sea level). */
export function groundAt(stage, s, x) {
  const fn = stage.stageLogic?.groundAt;
  return fn ? fn(s, x) : 0;
}
