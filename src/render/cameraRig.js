import { PerspectiveCamera, Vector3, Quaternion, Matrix4 } from 'three';
import { clamp, dampTo, noise1, DEG } from '../core/math.js';
import { makeFrame } from '../sim/rail.js';

const _v = new Vector3();
const _p = new Vector3();
const _a = new Vector3();
const _look = new Vector3();
const _up = new Vector3();
const _rt = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

const BOX_DEFAULT = { x: 200, y: 80 };

/** Chase framing (metres / degrees). */
export const CHASE = {
  back: 20, // behind the jet origin along the rail (≈18 m to the wings: jet spans ~37 % of the width)
  up: 3.4, // above the jet
  lookAhead: 120, // look-at point ahead of the jet …
  lookUp: -0.8, // … at about the jet's height: the jet sits ~68 % down, horizon ~47 %
  lookLead: 10, // look-at lateral lead at full lateral speed (world swings into turns)
  fov: 58,
  fovFast: 6,
  fovSlow: -2,
  fovClimax: 8,
  fovBoost: 4,
  backFast: 2,
  backClimax: 2.5,
  // The jet travels across the screen with its position in the movement box
  // (arcade style: it can reach toward the corners, so the reticle can aim at
  // enemies near the screen edges) plus a short lead in the direction it moves.
  slideX: 9, // jet offset from the camera axis at the box's side edge (m) ≈ 45 % of the half-width
  slideYUp: 3.5, // … at the top of the box (the jet stays in the lower two thirds)
  slideYDown: 2.5, // … at the bottom
  slideLeadX: 3, // transient lead at full lateral speed
  slideLeadY: 1.5,
  slideOmega: 4.2, // spring toward that target
  slideZeta: 0.62,
  rollGain: 0.45, // camera roll = gain · stick bank + rail-turn bank …
  rollMax: 30 * DEG, // … clamped
  rollRate: 3.6
};
const SLIDE_MAX_X = (CHASE.slideX + CHASE.slideLeadX) * 1.15;
const SLIDE_MAX_UP = (CHASE.slideYUp + CHASE.slideLeadY) * 1.15;
const SLIDE_MAX_DOWN = (CHASE.slideYDown + CHASE.slideLeadY) * 1.15;
export const SLIDE_LIMITS = { x: SLIDE_MAX_X, up: SLIDE_MAX_UP, down: SLIDE_MAX_DOWN };

/**
 * Chase camera in the After Burner Climax style: close behind the jet, which
 * sits large in the lower centre of the screen; the camera follows the jet
 * fully but lets it slide a few metres off-axis with a springy catch-up, rolls
 * hard with the bank (horizon tilts up to 30°) around the jet's axis so the
 * jet stays put while the world swings. Supports trauma-based shake, FOV kicks
 * and cinematic overrides (`cine`).
 */
export class CameraRig {
  constructor(aspect = 16 / 9) {
    this.camera = new PerspectiveCamera(CHASE.fov, aspect, 1.2, 32000);
    this.frame = makeFrame();
    this.mode = 'chase';
    this.back = CHASE.back;
    this.up = CHASE.up;
    this.lookAhead = CHASE.lookAhead;
    this.lookUp = CHASE.lookUp;
    this.baseFov = CHASE.fov;
    this.fov = CHASE.fov;
    this.fovKick = 0;
    this.roll = 0;
    this.trauma = 0;
    this.time = 0;
    this.offX = 0; // camera axis in rail space (jet offset minus slide)
    this.offY = 0;
    this.slide = { x: 0, vx: 0, y: 0, vy: 0 }; // jet offset from the camera axis (m)
    this.lead = 0;
    this.pull = 0; // extra pull-back (m), eased
    this.cine = null; // {update(camera, dt, rig)}
    this.shakeScale = 1;
  }

  addTrauma(t) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  /** Snap the chase state (after cinematics / respawn). */
  snap() {
    const s = this.slide;
    s.x = s.vx = s.y = s.vy = 0;
  }

  _slideStep(dt, tx, ty) {
    const C = CHASE;
    const s = this.slide;
    const w = C.slideOmega, z = C.slideZeta;
    // semi-implicit damped spring, sub-stepped for large frame times
    let rem = Math.min(dt, 0.25);
    while (rem > 0) {
      const h = Math.min(rem, 1 / 60);
      rem -= h;
      s.vx += (w * w * (tx - s.x) - 2 * z * w * s.vx) * h;
      s.vy += (w * w * (ty - s.y) - 2 * z * w * s.vy) * h;
      s.x += s.vx * h;
      s.y += s.vy * h;
    }
    const bx = SLIDE_MAX_X, byUp = SLIDE_MAX_UP, byDown = SLIDE_MAX_DOWN;
    if (s.x > bx) { s.x = bx; if (s.vx > 0) s.vx = 0; }
    if (s.x < -bx) { s.x = -bx; if (s.vx < 0) s.vx = 0; }
    if (s.y > byUp) { s.y = byUp; if (s.vy > 0) s.vy = 0; }
    if (s.y < -byDown) { s.y = -byDown; if (s.vy < 0) s.vy = 0; }
  }

  /**
   * @param {object} p player with pos/prevPos/s/x/y/vx/vy/bank/turnBank/speed
   * @param {Rail} rail
   * @param {number} alpha interpolation factor
   * @param {number} dt real seconds
   * @param {object} extra {climax}
   */
  update(p, rail, alpha, dt, extra = {}) {
    this.time += dt;
    const cam = this.camera;
    if (this.cine) {
      this.cine.update(cam, dt, this);
      this._applyShake(dt);
      cam.updateMatrixWorld();
      return;
    }
    const C = CHASE;
    // interpolated jet position and rail frame
    _p.lerpVectors(p.prevPos, p.pos, alpha);
    const f = rail.frameAt(p.s - (p.speed * (1 - alpha)) / 120, this.frame);
    const lat = p.lateralSpeed || 150, vert = p.verticalSpeed || 100;
    const vx01 = clamp((p.vx || 0) / lat, -1, 1);
    const vy01 = clamp((p.vy || 0) / vert, -1, 1);

    // the jet sits off the camera axis in proportion to where it is in the box,
    // plus a springy lead in the direction it moves
    const box = p.box || BOX_DEFAULT;
    const bx01 = clamp((p.x || 0) / (box.x || 200), -1, 1);
    const by01 = clamp(((p.y || 0) - (p.boxCenterY || 0)) / (box.y || 80), -1, 1);
    const tx = bx01 * C.slideX + vx01 * C.slideLeadX;
    const ty = (by01 > 0 ? by01 * C.slideYUp : by01 * C.slideYDown) + vy01 * C.slideLeadY;
    this._slideStep(dt, tx, ty);
    const s = this.slide;
    this.offX = p.x - s.x;
    this.offY = p.y - s.y;

    // speed / mode factors
    const base = p.baseSpeed || 230;
    const fast01 = clamp((p.speed - base) / (base * 0.4), 0, 1);
    const slow01 = clamp((base - p.speed) / (base * 0.28), 0, 1);
    const boost = p.boost > 0 ? 1 : 0;
    this.pull = dampTo(this.pull, (extra.climax ? C.backClimax : 0) + boost * 1.2, 2.5, dt);
    const back = this.back + fast01 * C.backFast + this.pull;

    // roll around the jet's axis: stick bank scaled, rail-turn bank in full
    const turn = p.turnBank || 0;
    const targetRoll = clamp(C.rollGain * ((p.bank || 0) - turn) + turn, -C.rollMax, C.rollMax);
    this.roll = dampTo(this.roll, targetRoll, C.rollRate, dt);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    _up.copy(f.U).multiplyScalar(cr).addScaledVector(f.R, sr);
    _rt.copy(f.R).multiplyScalar(cr).addScaledVector(f.U, -sr);

    // camera axis point (where the jet would be without the slide)
    _a.copy(_p).addScaledVector(f.R, -s.x).addScaledVector(f.U, -s.y);
    cam.position.copy(_a).addScaledVector(f.T, -back).addScaledVector(_up, this.up);
    this.lead = dampTo(this.lead, vx01 * C.lookLead, 3, dt);
    _look.copy(_a).addScaledVector(f.T, this.lookAhead).addScaledVector(_up, this.lookUp).addScaledVector(_rt, this.lead);
    _m.lookAt(cam.position, _look, _up);
    cam.quaternion.setFromRotationMatrix(_m);

    // FOV: widen at speed / Climax, kicks decay
    const targetFov = this.baseFov + fast01 * C.fovFast + slow01 * C.fovSlow + (extra.climax ? C.fovClimax : 0) + boost * C.fovBoost + this.fovKick;
    this.fov = dampTo(this.fov, targetFov, 3, dt);
    this.fovKick = dampTo(this.fovKick, 0, 2, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    this._applyShake(dt);
    cam.updateMatrixWorld();
  }

  _applyShake(dt) {
    const cam = this.camera;
    const tr = this.trauma * this.trauma * this.shakeScale;
    if (tr > 0.0001) {
      const t = this.time * 22;
      const yaw = noise1(t, 1) * 0.04 * tr;
      const pitch = noise1(t, 2) * 0.04 * tr;
      const roll = noise1(t, 3) * 0.06 * tr;
      _q.setFromAxisAngle(_v.set(0, 1, 0), yaw);
      cam.quaternion.multiply(_q);
      _q.setFromAxisAngle(_v.set(1, 0, 0), pitch);
      cam.quaternion.multiply(_q);
      _q.setFromAxisAngle(_v.set(0, 0, 1), roll);
      cam.quaternion.multiply(_q);
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.2);
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}

export { DEG };
