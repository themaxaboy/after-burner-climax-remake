import { Matrix4, Vector3 } from 'three';
import { Carrier } from '../../world/carrier.js';
import { makeFrame } from '../../sim/rail.js';
import { clamp, dampTo, lerp, easeInOutCubic } from '../../core/math.js';

const _f = makeFrame();
const _v = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

/**
 * Return to the boat at the end of the rail: the carrier waits where the rail
 * reaches deck height (21.7 m). Cue 'descend' clears the sky and takes the
 * controls; the jet slows along the approach (`approach` metres before the
 * touchdown), an LSO camera takes over for the last ~900 m, the wire traps it
 * and the stage finishes.
 *
 * opts: { approach = 5200, radio {descend, approach}, message: {text, sub} }
 */
export class CarrierLanding {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = { approach: 5200, ...opts };
    this.phase = 'combat';
    this.cameraOverride = false;
    this.lockControls = false;
    this.hud = { hideCombat: false, hideGauges: false };
  }

  async init() {
    const st = this.stage;
    const g = this.game;
    const rail = st.rail;
    let sTouch = rail.length - 320;
    for (let s = Math.max(0, rail.length - 6000); s < rail.length; s += 5) {
      if (rail.positionAt(s, _v).y <= 22.5) {
        sTouch = s;
        break;
      }
    }
    this.sTouch = sTouch;
    this.carrier = new Carrier({ models: st.models, fx: st.fx, csm: g.world.csm, seed: 17 });
    rail.frameAt(sTouch, _f);
    const dir = _f.T.clone().setY(0).normalize();
    this._placeForLanding(_f.pos.clone().setY(0), dir);
    g.world.scene.add(this.carrier.group);
    const stern = this.carrier.deckPoint(0, 180);
    g.world.ocean?.setWake(0, stern.x, stern.z, 80, 1);
    const mid = this.carrier.deckPoint(0, 60);
    g.world.ocean?.setWake(1, mid.x, mid.z, 55, 0.6);
  }

  _placeForLanding(touchPoint, dir) {
    // align the 9° angled deck with the approach direction
    const c = this.carrier;
    const yaw = Math.atan2(-dir.x, -dir.z) - (9 * Math.PI) / 180;
    c.group.rotation.set(0, yaw, 0);
    const touchLocal = new Vector3(-7, 0, 112);
    const off = touchLocal.applyEuler(c.group.rotation);
    c.group.position.set(touchPoint.x - off.x, 0, touchPoint.z - off.z);
    c.group.updateMatrixWorld(true);
  }

  cue(name) {
    if (name === 'descend') this._startDescent();
  }

  _startDescent() {
    const st = this.stage;
    const g = this.game;
    if (this.phase !== 'combat') return;
    this.phase = 'descent';
    this.lockControls = true;
    this.hud.hideCombat = true;
    if (st.climax.active) {
      st.climax.end();
      st._endClimax();
    }
    for (const e of st.enemies.list.slice()) st.enemies.despawn(e, !!e.def?.big && !e.dead && !e.dying);
    g.post.gforce.set('uLetterbox', 0.8);
    g.audio?.music?.play('anthem', { fadeIn: 3 });
    const msg = this.opts.message || { text: 'RETURN TO BASE', sub: 'BRING IT HOME' };
    st.hud.message(msg.text, { sub: msg.sub, dur: 3.5, color: '#ffd27a' });
    if (this.opts.radio?.descend) st._radio(this.opts.radio.descend);
  }

  preUpdate(dt) {
    const st = this.stage;
    const p = st.player;
    if (this.phase === 'combat') return;
    const A = this.opts.approach;
    p.controlLock = 1;
    p.x = dampTo(p.x, 0, 0.8, dt);
    p.y = dampTo(p.y, 0, 0.8, dt);
    p.vx = p.vy = 0;
    p.throttle = 0;
    const toTouch = this.sTouch - p.s;
    if (this.phase === 'descent' && toTouch < A) {
      this.phase = 'approach';
      if (this.opts.radio?.approach) st._radio(this.opts.radio.approach);
    }
    if (this.phase !== 'trap') {
      // slow down along the approach: cruise -> 72 m/s at touchdown
      const k = clamp(1 - toTouch / A, 0, 1);
      p.autoSpeed = lerp(p.baseSpeed, 72, easeInOutCubic(k));
      p.gear = toTouch < 3200 ? Math.min(1, (3200 - toTouch) / 500) : 0;
    }
    if (this.phase === 'approach' && toTouch <= 0) {
      this.phase = 'trap';
      this.trapV = p.speed;
      this.game.rig.addTrauma(0.7);
      this.game.audio?.play('catapult', { rate: 0.8 });
      st.fx.hitSparks(p.pos, p.velocity, 30);
    }
    if (this.phase === 'trap') {
      // arresting wire: ~3.2 g deceleration
      this.trapV = Math.max(0, this.trapV - 31 * dt);
      p.autoSpeed = this.trapV;
      p.speed = this.trapV;
      if (this.trapV <= 0 && !this._landed) {
        this._landed = true;
        st.hud.message('WELCOME HOME', { sub: 'MISSION ACCOMPLISHED', dur: 4, color: '#7dffb0', style: 'center' });
        st.schedule(2.6, () => st._finish());
      }
    }
  }

  update(dt) {
    this.carrier.update(dt, 0);
    // landing camera: LSO view from the deck in the last seconds
    if (this.phase === 'approach' && this.sTouch - this.stage.player.s < 900) this.cameraOverride = true;
  }

  render(alpha, realDt) {
    if (!this.cameraOverride) return;
    const g = this.game;
    const cam = g.rig.camera;
    // off the port quarter near the fantail, looking up the glide path
    this.carrier.deckPoint(-58, 235, cam.position);
    cam.position.y -= 4;
    _v.copy(this.stage.jet.group.position);
    _m.lookAt(cam.position, _v, _up);
    cam.quaternion.setFromRotationMatrix(_m);
    if (Math.abs(cam.fov - 45) > 0.01) {
      cam.fov = 45;
      cam.updateProjectionMatrix();
    }
    g.rig._applyShake(realDt);
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

export const carrierLanding = (opts) => (stage) => new CarrierLanding(stage, opts);
