import { Quaternion, Vector3, Matrix4 } from 'three';
import { clamp, dampTo, DEG } from '../core/math.js';
import { makeFrame } from './rail.js';

export const THROTTLE = { SLOW: -1, NEUTRAL: 0, FAST: 1 };
const SPEED_MUL = { '-1': 0.72, 0: 1.0, 1: 1.4 };

/** Tunables of the arcade flight model (rail-space metres, seconds). */
export const FLIGHT = {
  lateralSpeed: 150, // m/s at full stick
  verticalSpeed: 100,
  response: 4.5, // velocity chase rate (1/s)
  bankMax: 70 * DEG, // bank at full lateral speed
  pitchMax: 16 * DEG,
  yawGain: 0.4,
  yawMax: 0.18, // rad
  edgeSoft: 0.2, // soft zone as a fraction of the box half extent
  edgeSoftMin: 14, // m
  rollTime: 0.55, // s, full 360
  rollEvade: 0.5, // s, missile-break window from the roll start
  rollPush: 0.75, // sideways drift during a roll (× lateralSpeed)
  rollCooldown: 0.2,
  jinkTime: 0.38, // s, noRoll stages: quick sideways dash instead
  jinkEvade: 0.42,
  jinkPush: 1.55,
  gPerMs2: 1 / 110, // displayed G per m/s² of achieved rail-space acceleration (reversal ≈ 5 G)
  gMax: 9
};

const _m = new Matrix4();
const _qr = new Quaternion();
const _ax = new Vector3();
const _T = new Vector3();
const _R = new Vector3();
const _U = new Vector3();

/**
 * Maximum outward speed with `room` metres left before the box edge: a
 * constant-deceleration braking curve that reaches `vmax` at the start of the
 * soft zone (so full-stick flight brakes gently and stops exactly at the edge).
 */
function edgeLimit(room, soft, vmax) {
  if (room <= 0) return 0;
  return room >= soft ? Infinity : vmax * Math.sqrt(room / soft);
}

/**
 * Player jet flight model for an on-rails arcade shooter:
 * rail distance `s` + screen-space offset (x, y) inside a movement box.
 * The box edges are soft (outward speed fades to zero across the last
 * `edgeSoft` of the box), barrel rolls drift sideways and open a missile-evade
 * window; on `noRoll` stages the roll input becomes a quick sideways jink.
 * `gLoad` is the displayed G from the actually achieved rail-space
 * acceleration (≤ 9); scripted greyout uses `gOverride` (0..1).
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
    this.noRoll = false;
    this.reset({});
  }

  reset({ s = 0, baseSpeed = 230, box = { x: 240, y: 100 }, y = 0, x = 0 }) {
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
    this.turnBank = 0; // part of `bank` that comes from the rail turn
    this.rollAngle = 0; // barrel roll extra angle
    this.rollDir = 0;
    this.rollT = 0;
    this.rollCooldown = 0;
    this.jinkT = 0; // noRoll stages: sideways jink progress 0..1
    this.jinkDir = 0;
    this.evadeWindow = 0; // > 0: enemy missiles can be shaken off
    this.afterburner = 0;
    this.boost = 0; // forced afterburner (Climax afterburn), 0..1
    this.gLoad = 1;
    this.gOverride = 0; // scripted greyout 0..1 (post reads this, not gLoad)
    this.armor = 100;
    this.invuln = 0;
    this.alive = true;
    this.controlLock = 0; // >0 disables input (cinematics)
    this.autoSpeed = null; // forced speed (cinematics)
    this.lateralSpeed = FLIGHT.lateralSpeed;
    this.verticalSpeed = FLIGHT.verticalSpeed;
    this.response = FLIGHT.response;
    this.surfaces = { roll: 0, pitch: 0, yaw: 0 };
    this.stickX = 0;
    this.stickY = 0;
    this.distanceFlown = 0;
    this.gear = 0;
    this.accel = 0; // smoothed |a| in rail space (m/s²)
    this.edgeX = 0; // -1..1 how deep into the soft edge (sign = side)
  }

  setThrottle(state) {
    this.throttle = state;
  }

  /** Barrel roll (or a jink on noRoll stages). Returns true when it started. */
  startRoll(dir) {
    if (this.rollT > 0 || this.jinkT > 0 || this.rollCooldown > 0) return false;
    if (this.noRoll) return this.startJink(dir);
    this.rollDir = dir;
    this.rollT = 1e-4;
    this.evadeWindow = FLIGHT.rollEvade;
    return true;
  }

  /** Quick sideways dash with a hard bank (terrain stages, no barrel roll). */
  startJink(dir) {
    if (this.jinkT > 0 || this.rollT > 0 || this.rollCooldown > 0) return false;
    this.jinkDir = dir;
    this.jinkT = 1e-4;
    this.evadeWindow = FLIGHT.jinkEvade;
    return true;
  }

  get rolling() {
    return this.rollT > 0;
  }

  get jinking() {
    return this.jinkT > 0;
  }

  /**
   * @param {number} dt world dt
   * @param {object} input {moveX, moveY, throttleAxis}
   * @param {import('./rail.js').Rail} rail
   * @param {object} limits optional {minY} rail-space floor (terrain clearance)
   */
  update(dt, input, rail, limits) {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    if (dt <= 0) return;

    const locked = this.controlLock > 0;
    if (locked) this.controlLock -= dt;
    const mx = locked ? 0 : input.moveX;
    const my = locked ? 0 : input.moveY;
    this.stickX = mx;
    this.stickY = my;
    if (!locked) this.throttle = input.throttleAxis;

    // --- speed / throttle
    const boosting = this.boost > 0;
    const targetSpeed = this.autoSpeed != null ? this.autoSpeed : this.baseSpeed * SPEED_MUL[boosting ? 1 : this.throttle];
    const accel = targetSpeed > this.speed ? 1.4 : 1.8;
    this.speed = dampTo(this.speed, targetSpeed, accel, dt);
    const abTarget = boosting ? 1 : this.throttle === 1 ? 1 : this.throttle === 0 ? 0.35 : 0.05;
    this.afterburner = dampTo(this.afterburner, abTarget, boosting ? 10 : 4, dt);
    const ds = this.speed * dt;
    this.s += ds;
    this.distanceFlown += ds;

    // --- barrel roll / jink timing
    const F = FLIGHT;
    let push = 0; // extra lateral target speed (× lateralSpeed)
    let jinkBank = 0;
    if (this.rollT > 0) {
      this.rollT += dt / F.rollTime;
      const t = Math.min(this.rollT, 1);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.rollAngle = this.rollDir * e * Math.PI * 2;
      push = this.rollDir * F.rollPush * Math.sin(Math.PI * t);
      if (this.rollT >= 1) {
        this.rollT = 0;
        this.rollAngle = 0;
        this.rollCooldown = F.rollCooldown;
      }
    } else if (this.jinkT > 0) {
      this.jinkT += dt / F.jinkTime;
      const t = Math.min(this.jinkT, 1);
      push = this.jinkDir * F.jinkPush * Math.sin(Math.PI * Math.min(1, t * 1.25));
      jinkBank = this.jinkDir * 1.35 * Math.sin(Math.PI * t); // snap to ~77° and back
      if (this.jinkT >= 1) {
        this.jinkT = 0;
        this.rollCooldown = F.rollCooldown;
      }
    } else if (this.rollCooldown > 0) this.rollCooldown -= dt;
    if (this.evadeWindow > 0) this.evadeWindow = Math.max(0, this.evadeWindow - dt);
    if (this.invuln > 0) this.invuln -= dt;

    // --- movement inside the box: velocity chases the stick, soft edges
    const lat = this.lateralSpeed, vert = this.verticalSpeed;
    const resp = this.response;
    const tvx = (push !== 0 ? clamp(mx + push, -2, 2) : mx) * lat;
    const tvy = my * vert;
    const vx0 = this.vx, vy0 = this.vy; // (external resets, e.g. respawn, don't count as G)
    this.vx = dampTo(this.vx, tvx, push !== 0 ? resp * 1.6 : resp, dt);
    this.vy = dampTo(this.vy, tvy, resp, dt);
    const bx = this.box.x, by = this.box.y;
    const softX = Math.max(F.edgeSoftMin, bx * F.edgeSoft);
    const softY = Math.max(F.edgeSoftMin * 0.7, by * F.edgeSoft);
    const cy = this.boxCenterY;
    let minY = cy - by;
    if (limits && limits.minY != null) minY = Math.max(minY, limits.minY);
    const maxY = cy + by;
    const vxMax = lat, vyMax = vert;
    if (this.vx > 0) this.vx = Math.min(this.vx, edgeLimit(bx - this.x, softX, vxMax));
    else if (this.vx < 0) this.vx = Math.max(this.vx, -edgeLimit(this.x + bx, softX, vxMax));
    if (this.vy > 0) this.vy = Math.min(this.vy, edgeLimit(maxY - this.y, softY, vyMax));
    else if (this.vy < 0) this.vy = Math.max(this.vy, -edgeLimit(this.y - minY, softY, vyMax));
    // achieved rail-space acceleration this step (stick response + soft-edge braking)
    const ax = (this.vx - vx0) / dt;
    const ay = (this.vy - vy0) / dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // hard safety clamp (box shrinking, terrain floor rising): positions only,
    // velocity changes caused by the clamp don't count as G
    if (this.x > bx) this.x = bx;
    else if (this.x < -bx) this.x = -bx;
    if (this.y > maxY) this.y = maxY;
    if (this.y < minY) {
      this.y = minY;
      if (this.vy < 0) this.vy = 0;
    }
    this.edgeX = this.x > bx - softX ? (this.x - (bx - softX)) / softX : this.x < -bx + softX ? (this.x + bx - softX) / softX : 0;

    // --- G load from the achieved acceleration (rail space) + rail turn
    this.accel = dampTo(this.accel, Math.hypot(ax, ay * 1.15), 8, dt);
    const curv = rail.curvatureAt(this.s);
    const turnG = Math.min(3, (Math.abs(curv) * this.speed * this.speed) / 9.81);
    this.gLoad = Math.min(F.gMax, dampTo(this.gLoad, 1 + this.accel * F.gPerMs2 + turnG, 5, dt));

    // --- visual attitude
    this.turnBank = clamp(curv * this.speed * 8, -0.6, 0.6);
    const bankTarget = clamp(clamp(this.vx / lat, -1.15, 1.15) * F.bankMax + this.turnBank + jinkBank, -1.66, 1.66); // ≤ ~95°
    this.bank = dampTo(this.bank, bankTarget, this.jinkT > 0 ? 14 : 7, dt);
    const pitchTarget = clamp(this.vy / vert, -1, 1) * F.pitchMax;
    this.pitch = dampTo(this.pitch, pitchTarget, 6, dt);
    const yawTarget = clamp((this.vx / Math.max(this.speed, 40)) * F.yawGain, -F.yawMax, F.yawMax);
    this.yaw = dampTo(this.yaw, yawTarget, 6, dt);

    // control surface deflections for the model animation
    this.surfaces.roll = dampTo(this.surfaces.roll, clamp((bankTarget - this.bank) * 3, -1, 1), 12, dt);
    this.surfaces.pitch = dampTo(this.surfaces.pitch, clamp(-my * 0.8, -1, 1), 10, dt);
    this.surfaces.yaw = dampTo(this.surfaces.yaw, clamp(mx * 0.4, -1, 1), 10, dt);

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
