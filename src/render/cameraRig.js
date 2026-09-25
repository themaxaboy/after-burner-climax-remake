import { PerspectiveCamera, Vector3, Quaternion, Matrix4 } from 'three';
import { clamp, dampTo, noise1, lerp, DEG } from '../core/math.js';
import { makeFrame } from '../sim/rail.js';

const _v = new Vector3();
const _look = new Vector3();
const _up = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();

/**
 * Chase camera in the After Burner style: sits behind and above the jet,
 * tracks most (not all) of the jet's lateral offset so the plane slides across
 * the screen while the horizon tilts with the bank. Supports trauma-based shake,
 * FOV kick at FAST throttle, and cinematic overrides.
 */
export class CameraRig {
  constructor(aspect = 16 / 9) {
    this.camera = new PerspectiveCamera(62, aspect, 1.2, 32000);
    this.frame = makeFrame();
    this.mode = 'chase';
    this.track = 0.8;
    this.back = 17;
    this.up = 4.2;
    this.lookAhead = 90;
    this.baseFov = 62;
    this.fov = 62;
    this.fovKick = 0;
    this.roll = 0;
    this.trauma = 0;
    this.time = 0;
    this.offX = 0;
    this.offY = 0;
    this.lagX = { x: 0 };
    this.cine = null; // {update(camera, dt)}
    this.shakeScale = 1;
  }

  addTrauma(t) {
    this.trauma = Math.min(1, this.trauma + t);
  }

  /**
   * @param {object} p player with pos/prevPos/quat/s/x/y/bank/speed
   * @param {Rail} rail
   * @param {number} alpha interpolation factor
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
    // interpolated player state
    const px = lerp(p.prevPos.x, p.pos.x, alpha);
    const py = lerp(p.prevPos.y, p.pos.y, alpha);
    const pz = lerp(p.prevPos.z, p.pos.z, alpha);
    const f = rail.frameAt(p.s - p.speed * (1 - alpha) / 120, this.frame);

    // smooth follow of the offsets (slight lag gives weight)
    this.offX = dampTo(this.offX, p.x, 7, dt);
    this.offY = dampTo(this.offY, p.y, 7, dt);
    const k = this.track;
    const speed01 = clamp((p.speed - p.baseSpeed * 0.7) / (p.baseSpeed * 0.7), 0, 1);
    const back = this.back + speed01 * 3.5 + (extra.climax ? 4 : 0);

    // camera position = rail frame + tracked offsets - back + up
    _v.copy(f.pos)
      .addScaledVector(f.R, this.offX * k)
      .addScaledVector(f.U, this.offY * k + this.up)
      .addScaledVector(f.T, -back);
    // keep the plane in view: bias toward actual plane position on the lateral axis
    const dxPlane = px - _v.x, dyPlane = py - _v.y, dzPlane = pz - _v.z;
    cam.position.copy(_v);

    // look slightly ahead of the jet along the rail
    _look.set(px, py, pz).addScaledVector(f.T, this.lookAhead).addScaledVector(f.U, 1.5);
    _look.addScaledVector(f.R, (p.x - this.offX) * 0.25);
    void dxPlane; void dyPlane; void dzPlane;

    // roll the camera partially with the jet bank + rail bank
    const targetRoll = p.bank * 0.32;
    this.roll = dampTo(this.roll, targetRoll, 4, dt);
    _up.copy(f.U).multiplyScalar(Math.cos(this.roll)).addScaledVector(f.R, Math.sin(this.roll));
    _m.lookAt(cam.position, _look, _up);
    cam.quaternion.setFromRotationMatrix(_m);

    // FOV: widen at speed
    const targetFov = this.baseFov + speed01 * 9 + this.fovKick + (extra.climax ? 6 : 0);
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
