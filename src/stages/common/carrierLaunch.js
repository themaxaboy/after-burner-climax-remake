import { Matrix4, Vector3 } from 'three';
import { Carrier, CARRIER } from '../../world/carrier.js';
import { makeFrame } from '../../sim/rail.js';
import { easeInOutCubic } from '../../core/math.js';

const _f = makeFrame();
const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

/**
 * Catapult launch from the carrier at the start of the rail: cinematic deck
 * cameras, steam, letterbox, anthem; hands over to the chase camera and the
 * stage music once airborne. The rail must start on the bow catapult at deck
 * height (start y 21.7) with `rail.startS: 0`.
 *
 * opts: { radio: key spoken on the deck, hideAfter: rail metres after which
 *         the carrier is hidden }
 */
export class CarrierLaunch {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = opts;
    this.phase = 'deck';
    this.t = 0;
    this.lockControls = true;
    this.cameraOverride = false;
    this.handlesMusic = false;
    this.hud = { hideCombat: true, hideGauges: true };
    this.skipIntroMessage = true;
  }

  async init() {
    const st = this.stage;
    const g = this.game;
    const rail = st.rail;
    // bow (launch point) lies catLen metres down the rail from the jet's start
    this.catLen = Math.abs(CARRIER.catEnd - CARRIER.catStart);
    rail.frameAt(this.catLen, _f);
    const bow = _f.pos.clone().setY(0);
    const dir = _f.T.clone().setY(0).normalize();
    this.carrier = new Carrier({ models: st.models, fx: st.fx, csm: g.world.csm });
    this.carrier.placeAt(bow, dir);
    g.world.scene.add(this.carrier.group);
    // wake behind the carrier on the ocean
    const stern = this.carrier.deckPoint(0, 170);
    g.world.ocean?.setWake(0, stern.x, stern.z, 70, 1);
    const mid = this.carrier.deckPoint(0, 60);
    g.world.ocean?.setWake(1, mid.x, mid.z, 55, 0.6);
    const bowW = this.carrier.deckPoint(0, -150);
    g.world.ocean?.setWake(2, bowW.x, bowW.z, 30, 0.5);

    const p = st.player;
    if (g.params.skipIntro || g.params.t > 0 || g.params.bench) {
      this._skip();
      return;
    }
    p.s = 0;
    p.x = 0;
    p.y = 0;
    p.speed = 0;
    p.autoSpeed = 0;
    p.controlLock = 999;
    p.gear = 1;
    p.computePose(rail);
    p.prevPos.copy(p.pos);
    p.prevQuat.copy(p.quat);
    this.cameraOverride = true;
    this.handlesMusic = true;
    g.post.gforce.set('uLetterbox', 1);
    g.audio?.music?.play('anthem', { fadeIn: 1 });
    if (this.opts.radio) st._radio(this.opts.radio);
  }

  _skip() {
    const st = this.stage;
    const p = st.player;
    p.s = Math.max(p.s, this.catLen + 500);
    p.autoSpeed = null;
    p.speed = p.baseSpeed;
    p.controlLock = 0;
    p.gear = 0;
    p.computePose(st.rail);
    p.prevPos.copy(p.pos);
    p.prevQuat.copy(p.quat);
    this.phase = 'flight';
    this.lockControls = false;
    this.cameraOverride = false;
    this.handlesMusic = false;
    this.hud.hideCombat = false;
    this.hud.hideGauges = false;
    this.skipIntroMessage = false;
  }

  preUpdate(dt) {
    const st = this.stage;
    const p = st.player;
    if (this.phase === 'flight') return;
    this.t += dt;
    if (this.phase === 'deck') {
      p.autoSpeed = 0;
      p.speed = 0;
      p.afterburner = Math.min(1, this.t / 2.5);
      if (this.t > 4.2) {
        this.phase = 'cat';
        this.t = 0;
        this.game.audio?.play('catapult');
        this.game.rig.addTrauma(0.35);
      }
    } else if (this.phase === 'cat') {
      // ~3.5 g catapult stroke to 75 m/s
      p.autoSpeed = null;
      p.speed = Math.min(78, p.speed + 34 * dt);
      p.afterburner = 1;
      if (p.s > this.catLen) {
        this.phase = 'climb';
        this.t = 0;
        this.game.post.gforce.set('uLetterbox', 0.6);
      }
    } else if (this.phase === 'climb') {
      p.autoSpeed = null;
      p.gear = Math.max(0, 1 - Math.max(0, this.t - 0.4) / 1.6);
      p.speed = Math.min(p.baseSpeed, p.speed + 38 * dt);
      p.afterburner = 1;
      if (this.t > 1.2 && this.cameraOverride) {
        this.cameraOverride = false; // cut to the chase camera
        this.game.rig.offX = p.x;
        this.game.rig.offY = p.y;
      }
      if (this.t > 2.2) {
        this.phase = 'flight';
        this.lockControls = false;
        p.controlLock = 0;
        this.hud.hideCombat = false;
        this.hud.hideGauges = false;
        this.game.post.gforce.set('uLetterbox', 0);
        this.game.audio?.music?.play(st.def.music, { fadeIn: 2 });
        this.handlesMusic = false;
        this.skipIntroMessage = false;
        st._introMessage();
      }
    }
  }

  update(dt) {
    const deckPhase = this.phase === 'deck' || this.phase === 'cat';
    if (this.carrier.group.visible) this.carrier.update(dt, deckPhase ? 1 : this.phase === 'climb' ? 0.4 : 0);
    // hide the carrier once far behind
    if (this.phase === 'flight' && this.stage.player.s > (this.opts.hideAfter ?? 6000)) this.carrier.group.visible = false;
  }

  /** Cinematic cameras for the deck + launch. */
  render(alpha, realDt) {
    if (!this.cameraOverride) return;
    const st = this.stage;
    const cam = this.game.rig.camera;
    const jp = st.jet.group.position;
    const t = this.phase === 'deck' ? this.t : 4.2 + this.t;
    if (t < 2.1) {
      // front quarter, low on the deck, slow push in
      const k = easeInOutCubic(t / 2.1);
      this.carrier.deckPoint(CARRIER.catX + 14 - k * 3, CARRIER.catStart - 24 + k * 4, _v);
      _v.y += 1.6;
      cam.position.copy(_v);
      _v2.copy(jp).add(_v.set(0, 1.2, 2));
    } else if (t < 4.2) {
      // rear three-quarter looking forward along the catapult
      const k = (t - 2.1) / 2.1;
      this.carrier.deckPoint(CARRIER.catX - 10 + k * 2, CARRIER.catStart + 26, _v);
      _v.y += 4.5;
      cam.position.copy(_v);
      _v2.copy(jp).add(_v.set(0, 1.5, -25));
    } else {
      // fixed camera beside the bow as the jet rockets past
      this.carrier.deckPoint(CARRIER.catX + 16, CARRIER.catEnd + 30, _v);
      _v.y += 3;
      cam.position.copy(_v);
      _v2.copy(jp);
    }
    _m.lookAt(cam.position, _v2, _up);
    cam.quaternion.setFromRotationMatrix(_m);
    if (cam.fov !== 50) {
      cam.fov = 50;
      cam.updateProjectionMatrix();
    }
    this.game.rig.fov = 50;
    this.game.rig._applyShake(realDt);
    cam.updateMatrixWorld();
  }

  dispose() {
    const g = this.game;
    g.world.scene.remove(this.carrier.group);
    this.carrier.dispose();
    for (let i = 0; i < 3; i++) g.world.ocean?.setWake(i, 0, 0, 0, 0);
    g.post.gforce.set('uLetterbox', 0);
  }
}

export const carrierLaunch = (opts) => (stage) => new CarrierLaunch(stage, opts);
