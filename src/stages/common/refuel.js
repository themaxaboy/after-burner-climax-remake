import { Matrix4, Vector3 } from 'three';
import { makeFrame } from '../../sim/rail.js';
import { clamp, dampTo, lerp } from '../../core/math.js';

const _f = makeFrame();
const _v = new Vector3();
const _m = new Matrix4();

/**
 * Aerial refuelling interlude (cue 'refuel'): the sky is cleared, the jet
 * slides into pre-contact behind the tanker's boom under letterbox with the
 * anthem, then the screen fades out. The tanker is built in init (hidden) so
 * its shaders compile with the stage. Put it near the end of a stage: the
 * stage ends ~9 s after the cue (rail end or an `end` event).
 *
 * opts: { radio: key spoken on contact }
 */
export class Refuel {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = opts;
    this.active = false;
    this.t = 0;
    this.lockControls = false;
    this.hud = { hideCombat: false, hideGauges: false };
  }

  async init() {
    const st = this.stage;
    const g = this.game;
    const models = st.models;
    if (!models?.buildAircraft) return;
    try {
      this.tanker = models.buildAircraft('kc10', { lod: 0, scheme: 'standard' });
      for (const m of Object.values(this.tanker.materials)) {
        if (m && !m.userData.worldFog) {
          m.userData.worldFog = true;
          g.world.csm?.setupMaterial(m);
        }
      }
      this.tanker.root.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      // stays in view ahead of the jet until the first rendered frame so the
      // stage precompile also renders it (render-target and shadow programs)
      this.warm = true;
      this._placeAhead(160, 30);
      g.world.dynamic.add(this.tanker.root);
    } catch (e) {
      console.warn('tanker failed', e);
      this.tanker = null;
    }
  }

  _placeAhead(ds, y) {
    const st = this.stage;
    st.rail.frameAt(st.player.s + ds, _f);
    const root = this.tanker.root;
    root.position.copy(_f.pos).addScaledVector(_f.U, y);
    _m.makeBasis(_f.R, _f.U, _v.copy(_f.T).negate());
    root.quaternion.setFromRotationMatrix(_m);
  }

  render() {
    if (this.warm && this.tanker) {
      this.warm = false;
      if (!this.active) this.tanker.root.visible = false;
    }
  }

  cue(name) {
    if (name === 'refuel') this._start();
  }

  _start() {
    const st = this.stage;
    if (this.active) return;
    this.active = true;
    this.t = 0;
    this.lockControls = true;
    this.hud.hideCombat = true;
    this.game.post.gforce.set('uLetterbox', 1);
    for (const e of st.enemies.list.slice()) st.enemies.despawn(e);
    st.missiles.reset?.();
    if (this.tanker) this.tanker.root.visible = true;
    this.rel = { ds: 420, y: 38 };
    this.game.audio?.music?.play('anthem', { fadeIn: 2 });
  }

  preUpdate(dt) {
    if (!this.active) {
      if (this.warm && this.tanker) this._placeAhead(160, 30); // (warp) keep it in view for the precompile
      return;
    }
    const st = this.stage;
    const p = st.player;
    this.t += dt;
    p.controlLock = 1;
    // fly into the pre-contact position behind the tanker's boom
    this.rel.ds = dampTo(this.rel.ds, 55, 0.45, dt);
    p.x = dampTo(p.x, 0, 1.5, dt);
    p.y = dampTo(p.y, 20, 1.2, dt);
    p.vx = p.vy = 0;
    p.throttle = 0;
    if (this.tanker) {
      st.rail.frameAt(p.s + this.rel.ds, _f);
      const root = this.tanker.root;
      root.position.copy(_f.pos).addScaledVector(_f.U, this.rel.y + Math.sin(this.t * 0.8) * 0.6);
      _m.makeBasis(_f.R, _f.U, _v.copy(_f.T).negate());
      root.quaternion.setFromRotationMatrix(_m);
      this.tanker.animate?.({ roll: 0, pitch: 0, yaw: 0, speed01: 0.5, time: this.t, boom: clamp(this.t / 4, 0, 1) });
      const boom = root.getObjectByName('boom');
      if (boom) boom.rotation.x = lerp(0, -0.55, clamp((this.t - 1) / 3, 0, 1));
    }
    if (this.t > 2.5 && !this._contact) {
      this._contact = true;
      if (this.opts.radio) st._radio(this.opts.radio);
    }
    if (this.t > 8.5) this.game.post.gforce.set('uFade', clamp((this.t - 8.5) / 1.2, 0, 1));
  }

  dispose() {
    const g = this.game;
    if (this.tanker) g.world.dynamic.remove(this.tanker.root);
    g.post.gforce.set('uLetterbox', 0);
    g.post.gforce.set('uFade', 0);
  }
}

export const refuel = (opts) => (stage) => new Refuel(stage, opts);
