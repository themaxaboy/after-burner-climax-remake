import { Vector3 } from 'three';
import { projectPoint } from '../../sim/lockon.js';
import { clamp, dampTo } from '../../core/math.js';

const _v = new Vector3();
const _s = new Vector3();

/**
 * Per-frame post-processing parameters for a stage (G effects, damage flash,
 * Climax look, missile warning, whiteout, radial blur, CA, heat haze).
 * See docs/overhaul/CONTRACTS.md.
 *
 * Flicker rules: every screen-wide term is eased (no 0↔1 steps), greyout only
 * comes from the scripted `player.gOverride` (0..1), and "reduced flashing"
 * scales the damage flash and the warning pulse down.
 */
export class PostBridge {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.climaxFx = 0;
    this.warn = 0;
    this.grey = 0;
    this.burst = 0; // Climax activation burst progress (0 = off)
    stage.events.on('climax', (e) => {
      if (e.phase === 'start') this.burst = 0.001;
    });
  }

  /** Stage enter: apply the stage look (exposure, grade, bloom), honouring `?look=`. */
  applyLook(env) {
    const g = this.game;
    g.post.applyLook(g.world.resolveEnv(env), g.renderer);
  }

  update(realDt) {
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    const post = g.post;
    const gf = post.gforce;
    const reduced = !!g.settings.reducedFlashing;
    const climaxK = st.climax.active ? 1 : 0;
    this.climaxFx = dampTo(this.climaxFx, climaxK, 6, realDt);
    // greyout / tunnel vision: scripted only (gLoad is a display value)
    const grey = clamp(p.gOverride || 0, 0, 1) * 0.85;
    this.grey = dampTo(this.grey, grey, 3, realDt);
    gf.set('uGrey', this.grey);
    gf.set('uDamage', st.hitFlash * (reduced ? 0.35 : 0.8));
    gf.set('uClimax', this.climaxFx);
    // missile warning eases in fast and out slowly; the pulse is shallow
    const warn = st.enemyOps.threat ? (reduced ? 0.3 : 0.6) : 0;
    this.warn = dampTo(this.warn, warn, warn > this.warn ? 8 : 3, realDt);
    gf.set('uWarn', this.warn);
    gf.set('uPulse', reduced ? 0.15 : 0.6);
    gf.set('uWhite', st.whiteout);
    if (this.burst > 0) {
      this.burst += realDt / 0.85;
      if (this.burst >= 1) this.burst = 0;
      if (projectPoint(g.rig.camera, st.jet.group.position, _s)) gf.uniforms.get('uBurstC').value.set(_s.x * 0.5 + 0.5, _s.y * 0.5 + 0.5);
    }
    gf.set('uBurst', this.burst);
    const cf = post.cameraFX.uniforms;
    const fast = p.throttle > 0 ? clamp((p.speed - p.baseSpeed) / (p.baseSpeed * 0.4), 0, 1) : 0;
    cf.get('uRadial').value = dampTo(cf.get('uRadial').value, fast * 0.9 + this.climaxFx * 0.3, 4, realDt);
    cf.get('uCA').value = 0.12 + fast * 0.25 + st.hitFlash * 0.6 + this.climaxFx * 0.3;
    // heat haze behind the nozzles
    if (g.preset.heatHaze && st.jet.nozzles.length) {
      const cam = g.rig.camera;
      st.jet.nozzleWorld(0, _v);
      _v.addScaledVector(p.forward, -4);
      if (projectPoint(cam, _v, _s)) {
        const r = clamp(6 / Math.max(_s.z, 1), 0.01, 0.2);
        cf.get('uHaze0').value.set(_s.x * 0.5 + 0.5, _s.y * 0.5 + 0.5, r * 0.6, r);
        cf.get('uHazeStrength').value = 0.4 + p.afterburner * 0.8;
      } else cf.get('uHazeStrength').value = 0;
    }
  }

  /** Stage exit: leave the post chain neutral for the next state. */
  reset() {
    const g = this.game;
    const gf = g.post.gforce;
    for (const [k, v] of [['uLetterbox', 0], ['uFade', 0], ['uWhite', 0], ['uGrey', 0], ['uDamage', 0], ['uClimax', 0], ['uWarn', 0], ['uBurst', 0]]) gf.set(k, v);
    const cf = g.post.cameraFX.uniforms;
    cf.get('uRadial').value = 0;
    cf.get('uHazeStrength').value = 0;
    g.post.resetHistory({ sun: true });
  }
}
