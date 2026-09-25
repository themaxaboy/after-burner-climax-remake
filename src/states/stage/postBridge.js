import { Vector3 } from 'three';
import { projectPoint } from '../../sim/lockon.js';
import { clamp, dampTo } from '../../core/math.js';

const _v = new Vector3();
const _s = new Vector3();

/**
 * Per-frame post-processing parameters for a stage (G effects, damage flash,
 * Climax look, missile warning, whiteout, radial blur, CA, heat haze).
 * See docs/overhaul/CONTRACTS.md.
 */
export class PostBridge {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.climaxFx = 0;
  }

  /** Stage enter: apply the stage look (exposure, grade, bloom). */
  applyLook(env) {
    const g = this.game;
    g.renderer.toneMappingExposure = env.toneExposure ?? 0.6;
    g.post.grade.setGrade(env.grade || 'neutral');
    const bl = env.bloom || {};
    g.post.bloom.luminanceMaterial.threshold = bl.threshold ?? 1.0;
    g.post.bloom.intensity = bl.intensity ?? 0.9;
  }

  update(realDt) {
    const st = this.stage;
    const g = this.game;
    const p = st.player;
    const post = g.post;
    const gf = post.gforce;
    const climaxK = st.climax.active ? 1 : 0;
    this.climaxFx = dampTo(this.climaxFx, climaxK, 6, realDt);
    const grey = clamp((p.gLoad - 6.5) / 3, 0, 0.85);
    gf.set('uGrey', dampTo(gf.uniforms.get('uGrey').value, grey, 3, realDt));
    gf.set('uDamage', g.settings.reducedFlashing ? st.hitFlash * 0.4 : st.hitFlash);
    gf.set('uClimax', this.climaxFx);
    gf.set('uWarn', st.enemyOps.threat ? 0.6 : 0);
    gf.set('uWhite', st.whiteout);
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
    for (const [k, v] of [['uLetterbox', 0], ['uFade', 0], ['uWhite', 0], ['uGrey', 0], ['uDamage', 0], ['uClimax', 0], ['uWarn', 0]]) gf.set(k, v);
    const cf = g.post.cameraFX.uniforms;
    cf.get('uRadial').value = 0;
    cf.get('uHazeStrength').value = 0;
    g.post.cameraFX.resetHistory();
  }
}
