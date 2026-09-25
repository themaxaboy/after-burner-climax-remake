import { clamp, dampTo } from '../core/math.js';

/**
 * Screen-anchored reticle placement (NDC). The reticle rides a fixed height
 * above the projected nose of the jet, leads a little with the lateral /
 * vertical velocity and is pulled (≤ `maxPull`, in half-height units) toward
 * the aim-assist target. Pure math so it can be unit-tested; Combat feeds it
 * the projected nose each rendered frame and copies the result into
 * `lockon.reticle`.
 */
export const RETICLE = {
  lift: 0.3, // NDC-Y above the projected nose
  leadX: 0.07, // NDC-X at full lateral speed
  leadY: 0.04, // NDC-Y at full vertical speed
  maxPull: 0.06, // aim-assist pull (half-height units) at assist 2
  follow: 14, // screen-anchor response (1/s)
  pullRate: 7
};

export class Reticle {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.baseX = 0;
    this.baseY = 0;
    this.pullX = 0;
    this.pullY = 0;
    this.primed = false;
  }

  reset() {
    this.primed = false;
    this.pullX = this.pullY = 0;
  }

  /**
   * @param {number} dt real seconds
   * @param {number} noseX projected nose NDC x
   * @param {number} noseY projected nose NDC y
   * @param {number} vx01 lateral velocity / lateralSpeed (-1..1)
   * @param {number} vy01 vertical velocity / verticalSpeed (-1..1)
   * @param {object|null} target assist target with sx/sy (NDC) and onScreen
   * @param {number} assist 0..2
   * @param {number} aspect camera aspect (x distances are scaled by it)
   * @param {object} out {x, y} receives the reticle centre
   */
  update(dt, noseX, noseY, vx01, vy01, target, assist, aspect, out) {
    const R = RETICLE;
    const bx = clamp(noseX + clamp(vx01, -1, 1) * R.leadX, -0.92, 0.92);
    const by = clamp(noseY + R.lift + clamp(vy01, -1, 1) * R.leadY, -0.85, 0.85);
    if (!this.primed) {
      this.baseX = bx;
      this.baseY = by;
      this.primed = true;
    } else {
      this.baseX = dampTo(this.baseX, bx, R.follow, dt);
      this.baseY = dampTo(this.baseY, by, R.follow, dt);
    }
    let px = 0, py = 0;
    if (target && target.onScreen && assist > 0) {
      // pull in half-height units (x scaled by the aspect), clamped to a disc
      const max = R.maxPull * (assist / 2);
      let dx = (target.sx - this.baseX) * aspect, dy = target.sy - this.baseY;
      const d = Math.hypot(dx, dy);
      if (d > max) {
        dx *= max / d;
        dy *= max / d;
      }
      px = dx / aspect;
      py = dy;
    }
    this.pullX = dampTo(this.pullX, px, R.pullRate, dt);
    this.pullY = dampTo(this.pullY, py, R.pullRate, dt);
    this.x = this.baseX + this.pullX;
    this.y = this.baseY + this.pullY;
    if (out) {
      out.x = this.x;
      out.y = this.y;
    }
    return out;
  }
}
