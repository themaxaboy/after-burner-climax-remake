import { Matrix4, Quaternion, Vector3 } from 'three';
import { loadModels, loadFX } from '../render/assets.js';
import { FX_STUB } from '../render/fxStub.js';
import { PlayerJet } from '../render/playerJet.js';

const _m = new Matrix4();
const _q = new Quaternion();
const _ax = new Vector3();
const _upv = new Vector3();
const _back = new Vector3();
const _Y = new Vector3(0, 1, 0);
const _Z = new Vector3(0, 0, 1);

/**
 * Minimal "pilot" object that PlayerJet can render without the flight sim:
 * used for the title flyby and the hangar turntable.
 */
export class ShowcasePilot {
  constructor() {
    this.pos = new Vector3();
    this.prevPos = new Vector3();
    this.quat = new Quaternion();
    this.prevQuat = new Quaternion();
    this.velocity = new Vector3();
    this.forward = new Vector3(0, 0, -1);
    this.surfaces = { roll: 0, pitch: 0, yaw: 0 };
    this.speed = 230;
    this.baseSpeed = 230;
    this.throttle = 0;
    this.afterburner = 0.35;
    this.gLoad = 1;
    this.bank = 0;
    this.gear = 0;
  }

  /** Pose from position, forward direction and bank (rad). */
  setPose(pos, fwd, bank) {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
    this.pos.copy(pos);
    this.forward.copy(fwd).normalize();
    const right = _ax.crossVectors(this.forward, _Y).normalize();
    const up = _upv.crossVectors(right, this.forward);
    _m.makeBasis(right, up, _back.copy(this.forward).negate());
    this.quat.setFromRotationMatrix(_m);
    _q.setFromAxisAngle(_Z, -bank);
    this.quat.multiply(_q);
    this.bank = bank;
  }

  snap() {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }
}

/** Load models + FX and build a showcase jet in the world. */
export async function buildShowcaseJet(game, jetId, scheme) {
  const [models, fxMod] = await Promise.all([loadModels(), loadFX()]);
  const g = game;
  const fx = fxMod?.FX ? new fxMod.FX({ scene: g.world.scene, renderer: g.renderer, maxParticles: 2048, quality: g.preset.name }) : FX_STUB;
  fx.setLighting?.(g.world.sun.intensity, 0.55);
  const jet = new PlayerJet({ models, fx, jetId, scheme, csm: g.world.csm });
  g.world.dynamic.add(jet.group);
  return { models, fx, jet };
}
