import { Quaternion, Vector3, Matrix4 } from 'three';
import { clamp, dampTo, DEG } from '../core/math.js';
import { makeFrame } from './rail.js';

export const THROTTLE = { SLOW: -1, NEUTRAL: 0, FAST: 1 };
const SPEED_MUL = { '-1': 0.72, 0: 1.0, 1: 1.4 };

const _m = new Matrix4();
const _qr = new Quaternion();
const _ax = new Vector3();
const _T = new Vector3();
const _R = new Vector3();
const _U = new Vector3();

/**
 * Player jet flight model for an on-rails arcade shooter:
 * rail distance `s` + screen-space offset (x, y) inside a movement box.
 */
export class Player {
  constructor() {
    this.frame = makeFrame();
    this.pos = new Vector3();
    this.prevPos = new Vector3();
    this.quat = new Quaternion();
    this.prevQuat = new Quaternion();
    this.forward = new Vector3(0, 0, -1);
    this.velocity = new Vector3();
    this.reset({});
  }

  reset({ s = 0, baseSpeed = 230, box = { x: 70, y: 38 }, y = 0, x = 0 }) {
    this.s = s;
    this.baseSpeed = baseSpeed;
    this.speed = baseSpeed;
    this.throttle = 0;
    this.box = { x: box.x, y: box.y };
    this.boxCenterY = 0;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.bank = 0; // visual roll (rad), + = right wing down
    this.pitch = 0;
    this.yaw = 0;
    this.rollAngle = 0; // barrel roll extra angle
    this.rollDir = 0;
    this.rollT = 0;
    this.rollCooldown = 0;
    this.evadeWindow = 0; // missile-break window after a roll
    this.afterburner = 0;
    this.gLoad = 1;
    this.armor = 100;
    this.invuln = 0;
    this.alive = true;
    this.controlLock = 0; // >0 disables input (cinematics)
    this.autoSpeed = null; // forced speed (cinematics)
    this.lateralSpeed = 62;
    this.verticalSpeed = 46;
    this.surfaces = { roll: 0, pitch: 0, yaw: 0 };
    this.stickX = 0;
    this.stickY = 0;
    this.distanceFlown = 0;
    this.gear = 0;
  }

  setThrottle(state) {
    this.throttle = state;
  }

  startRoll(dir) {
    if (this.rollT > 0 || this.rollCooldown > 0) return false;
    this.rollDir = dir;
    this.rollT = 0.0001;
    this.evadeWindow = 0.45;
    this.vx += dir * 38;
    return true;
  }

  /**
   * @param {number} dt world dt
   * @param {object} input {moveX, moveY, throttleAxis}
   * @param {import('./rail.js').Rail} rail
   * @param {object} limits optional {minY(x) fn for terrain clearance}
   */
  update(dt, input, rail, limits) {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);

    const locked = this.controlLock > 0;
    if (locked) this.controlLock -= dt;
    const mx = locked ? 0 : input.moveX;
    const my = locked ? 0 : input.moveY;
    this.stickX = mx;
    this.stickY = my;
    if (!locked) this.throttle = input.throttleAxis;

    // --- speed / throttle
    const targetSpeed = this.autoSpeed != null ? this.autoSpeed : this.baseSpeed * SPEED_MUL[this.throttle];
    const accel = targetSpeed > this.speed ? 1.4 : 1.8;
    this.speed = dampTo(this.speed, targetSpeed, accel, dt);
    this.afterburner = dampTo(this.afterburner, this.throttle === 1 ? 1 : this.throttle === 0 ? 0.35 : 0.05, 4, dt);
    const ds = this.speed * dt;
    this.s += ds;
    this.distanceFlown += ds;

    // --- lateral movement inside the box (velocity chases stick)
    const tvx = mx * this.lateralSpeed;
    const tvy = my * this.verticalSpeed;
    const resp = 5.5;
    this.vx = dampTo(this.vx, tvx, resp, dt);
    this.vy = dampTo(this.vy, tvy, resp, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const bx = this.box.x, by = this.box.y;
    if (this.x > bx) { this.x = bx; if (this.vx > 0) this.vx *= 0.3; }
    if (this.x < -bx) { this.x = -bx; if (this.vx < 0) this.vx *= 0.3; }
    const cy = this.boxCenterY;
    let minY = cy - by;
    if (limits && limits.minY != null) minY = Math.max(minY, limits.minY);
    if (this.y > cy + by) { this.y = cy + by; if (this.vy > 0) this.vy *= 0.3; }
    if (this.y < minY) { this.y = minY; if (this.vy < 0) this.vy *= 0.3; }

    // --- barrel roll
    if (this.rollT > 0) {
      this.rollT += dt / 0.62;
      const t = Math.min(this.rollT, 1);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.rollAngle = this.rollDir * e * Math.PI * 2;
      if (this.rollT >= 1) {
        this.rollT = 0;
        this.rollAngle = 0;
        this.rollCooldown = 0.25;
      }
    } else if (this.rollCooldown > 0) this.rollCooldown -= dt;
    if (this.evadeWindow > 0) this.evadeWindow -= dt;
    if (this.invuln > 0) this.invuln -= dt;

    // --- visual attitude
    const curv = rail.curvatureAt(this.s);
    const bankTarget = clamp(this.vx / this.lateralSpeed, -1.2, 1.2) * 62 * DEG + clamp(curv * this.speed * 8, -0.6, 0.6);
    this.bank = dampTo(this.bank, bankTarget, 6, dt);
    const pitchTarget = clamp(this.vy / this.verticalSpeed, -1, 1) * 16 * DEG;
    this.pitch = dampTo(this.pitch, pitchTarget, 6, dt);
    const yawTarget = clamp(this.vx / Math.max(this.speed, 40), -0.35, 0.35) * 0.9;
    this.yaw = dampTo(this.yaw, yawTarget, 6, dt);

    // control surface deflections for the model animation
    this.surfaces.roll = dampTo(this.surfaces.roll, clamp((bankTarget - this.bank) * 3, -1, 1), 12, dt);
    this.surfaces.pitch = dampTo(this.surfaces.pitch, clamp(-my * 0.8, -1, 1), 10, dt);
    this.surfaces.yaw = dampTo(this.surfaces.yaw, clamp(mx * 0.4, -1, 1), 10, dt);

    // approximate G load from lateral/vertical acceleration + turn
    const ay = (tvy - this.vy) * resp;
    const ax = (tvx - this.vx) * resp;
    const turnG = Math.abs(curv) * this.speed * this.speed / 9.81;
    this.gLoad = dampTo(this.gLoad, 1 + Math.hypot(ax, ay) / 9.81 * 0.9 + turnG, 3, dt);

    this.computePose(rail);
  }

  /** World position + orientation from rail frame and offsets. */
  computePose(rail) {
    const f = rail.frameAt(this.s, this.frame);
    this.pos.copy(f.pos).addScaledVector(f.R, this.x).addScaledVector(f.U, this.y);
    // base orientation from the rail frame: columns = R, U, -T (three's forward is -Z)
    _T.copy(f.T);
    _R.copy(f.R);
    _U.copy(f.U);
    _m.makeBasis(_R, _U, _ax.copy(_T).negate());
    this.quat.setFromRotationMatrix(_m);
    // yaw (around local up), pitch (around local right), roll (around local forward -Z)
    _qr.setFromAxisAngle(_ax.set(0, 1, 0), -this.yaw);
    this.quat.multiply(_qr);
    _qr.setFromAxisAngle(_ax.set(1, 0, 0), this.pitch);
    this.quat.multiply(_qr);
    _qr.setFromAxisAngle(_ax.set(0, 0, 1), -(this.bank + this.rollAngle));
    this.quat.multiply(_qr);
    this.forward.set(0, 0, -1).applyQuaternion(this.quat);
    this.velocity.copy(f.T).multiplyScalar(this.speed).addScaledVector(f.R, this.vx).addScaledVector(f.U, this.vy);
  }

  damage(amount) {
    if (this.invuln > 0 || !this.alive) return 0;
    this.armor = Math.max(0, this.armor - amount);
    this.invuln = 0.25;
    if (this.armor <= 0) this.alive = false;
    return amount;
  }
}

