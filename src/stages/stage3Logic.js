import { Matrix4, Vector3 } from 'three';
import { CloudDeck } from '../world/cloudDeck.js';
import { Carrier, CARRIER } from '../world/carrier.js';
import { makeFrame } from '../sim/rail.js';
import { clamp, dampTo, lerp, easeInOutCubic } from '../core/math.js';

const _f = makeFrame();
const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

// B-52-style engine pod positions (local, metres) — fallback when the model
// does not expose its engine nodes.
const POD_FALLBACK = [[-11, -2.2, 1], [11, -2.2, 1], [-22, -1.4, 5], [22, -1.4, 5]];

/**
 * Stage 3: cloud deck at dusk, the ace, the multi-part bomber boss with a
 * slow-motion kill-cam, and the descent through the clouds to a carrier
 * landing (trap) at last light.
 */
export class Stage3Logic {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.hud = { hideCombat: false, hideGauges: false, timer: null };
    this.phase = 'combat';
    this.cameraOverride = false;
    this.lockControls = false;
    this.pods = [];
    this.podSmoke = [];
    this.t = 0;
  }

  async init() {
    const st = this.stage;
    const g = this.game;
    const env = st.def.env;
    this.deck = new CloudDeck({ y: env.deck.y, cover: env.deck.cover });
    const sky = g.world.sky;
    const sunI = (sky.params.sunIntensity * sky.params.exposure) / Math.PI;
    const top = sky.radiance(_v.set(0, 1, 0));
    this.deck.setLighting({ sunI: sunI * (env.deck.sun ?? 0.9), ambient: top.multiplyScalar(1.3) });
    g.world.scene.add(this.deck.mesh);

    // carrier waiting at the end of the rail (angled-deck landing)
    const rail = st.rail;
    let sTouch = rail.length - 320;
    for (let s = rail.length - 5000; s < rail.length; s += 5) {
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

    // engine pod positions from the model if available
    this.podLocal = POD_FALLBACK;
    try {
      const info = st.models?.buildAircraftGeometry?.('bomberB52', 1);
      const nodes = info?.nodes;
      if (nodes && nodes.engine0) {
        this.podLocal = [0, 1, 2, 3].map((i) => {
          const n = nodes[`engine${i}`];
          return Array.isArray(n) ? n : [n.x, n.y, n.z];
        });
      }
    } catch {
      /* fallback */
    }
  }

  _placeForLanding(touchPoint, dir) {
    // align the 9° angled deck with the approach direction
    const c = this.carrier;
    const yaw = Math.atan2(-dir.x, -dir.z) - (9 * Math.PI) / 180;
    c.group.rotation.set(0, yaw, 0);
    this.touchLocal = new Vector3(-7, 0, 112);
    const off = this.touchLocal.clone().applyEuler(c.group.rotation);
    c.group.position.set(touchPoint.x - off.x, 0, touchPoint.z - off.z);
    c.group.updateMatrixWorld(true);
  }

  cue(name) {
    const st = this.stage;
    const g = this.game;
    if (name === 'boss') {
      const boss = st.enemies.spawn('bomberB52', { behavior: 'bossBomber', rs: st.player.s - 700, rx: 0, ry: 40, tag: 'boss', invuln: true, params: { y: 55 } });
      this.boss = boss;
      if (!boss) return;
      boss.lockable = false; // lock the engines first
      this.pods = this.podLocal.map((local, i) =>
        st.enemies.spawn('bossPod', { behavior: 'attached', tag: `pod${i}`, params: { parent: boss, local } })
      );
      st.director._eoStart({ id: 's3_boss', title: 'DESTROY THE STRATEGIC BOMBER', kind: 'destroy', tags: ['boss'], count: 1, bonus: 200000 }, st.player);
      st.hud.message('WARNING', { sub: 'HEAVY BOMBER APPROACHING — TARGET THE ENGINES', dur: 3, color: '#ff5a4a', style: 'center' });
      g.audio?.play('eoAlert');
      g.audio?.music?.setIntensity?.(1);
    } else if (name === 'bossEscape') {
      if (this.boss && this.boss.active && !this.boss.dead) {
        this.boss.behavior = () => {};
        this.escaping = true;
        st.hud.message('THE BOMBER IS ESCAPING', { dur: 2.5, color: '#ff5a4a' });
      }
    } else if (name === 'descend') {
      this._startDescent();
    }
  }

  /** Called by the stage when an enemy dies. */
  onKill(e) {
    const st = this.stage;
    const g = this.game;
    if (e.tag && e.tag.startsWith('pod')) {
      st.fx.explosion(e.pos, { size: 1.6, kind: 'air', vel: e.vel });
      const smoke = st.fx.createSmokeEmitter({ fire: true });
      this.podSmoke.push({ smoke, local: e.params.local });
      const alive = this.pods.filter((p) => p && p.active && !p.dead).length;
      if (alive === 0 && this.boss) {
        this.boss.invuln = false;
        this.boss.lockable = true;
        st.hud.message('ENGINES DOWN', { sub: 'FINISH IT!', dur: 2.2, color: '#ffd27a', style: 'center' });
      } else st.hud.message(`ENGINE HIT`, { sub: `${alive} REMAINING`, dur: 1.4, color: '#ffd27a' });
    }
    if (e === this.boss) {
      // slow-motion kill-cam
      g.clock.pulse(0.14, 1.8, 0.1, 0.5);
      this.killCam = { t: 0, pos: e.pos.clone(), vel: e.vel.clone() };
      this.cameraOverride = true;
      g.post.gforce.set('uLetterbox', 1);
      for (let i = 0; i < 6; i++) {
        setTimeout(() => {
          _v.copy(this.killCam?.pos || e.pos).add(_v2.set((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 30));
          st.fx.explosion(_v, { size: 2.4, kind: 'big' });
        }, 120 + i * 180);
      }
      st._radio('r.s3.win');
    }
  }

  _startDescent() {
    const st = this.stage;
    const g = this.game;
    this.phase = 'descent';
    this.lockControls = true;
    this.hud.hideCombat = true;
    for (const e of st.enemies.list.slice()) if (e !== this.boss) st.enemies.despawn(e);
    if (this.boss && this.boss.active && !this.boss.dead) st.enemies.despawn(this.boss, true);
    g.post.gforce.set('uLetterbox', 0.8);
    g.audio?.music?.play('anthem', { fadeIn: 3 });
    st.hud.message('RETURN TO BASE', { sub: 'BRING IT HOME', dur: 3.5, color: '#ffd27a' });
  }

  preUpdate(dt) {
    const st = this.stage;
    const p = st.player;
    this.t += dt;
    if (this.phase === 'descent' || this.phase === 'approach' || this.phase === 'trap') {
      p.controlLock = 1;
      p.x = dampTo(p.x, 0, 0.8, dt);
      p.y = dampTo(p.y, 0, 0.8, dt);
      p.vx = p.vy = 0;
      p.throttle = 0;
      const toTouch = this.sTouch - p.s;
      if (this.phase === 'descent' && toTouch < 5200) this.phase = 'approach';
      if (this.phase !== 'trap') {
        // slow down along the approach: 245 -> 72 m/s at touchdown
        const k = clamp(1 - toTouch / 5200, 0, 1);
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
          setTimeout(() => st._finish(), 2600);
        }
      }
    }
  }

  update(dt) {
    const st = this.stage;
    const g = this.game;
    // escaping boss climbs away
    if (this.escaping && this.boss && this.boss.active && !this.boss.dead) {
      this.boss.rs += 120 * dt;
      this.boss.ry += 40 * dt;
      if (this.boss.rs - st.player.s > 3000) st.enemies.despawn(this.boss, true);
    }
    // burning engines trail smoke
    if (this.boss && this.boss.active) {
      for (const ps of this.podSmoke) {
        _v.set(ps.local[0], ps.local[1], ps.local[2]).applyQuaternion(this.boss.quat).add(this.boss.pos);
        ps.smoke.update(_v, this.boss.vel, 1);
      }
    } else {
      for (const ps of this.podSmoke) ps.smoke.stop();
      this.podSmoke.length = 0;
    }
    // whiteout while crossing the cloud deck
    const camY = g.rig.camera.position.y;
    const dy = Math.abs(camY - this.deck.y);
    this.deckWhite = dy < 90 ? (1 - dy / 90) * 0.9 : 0;
    if (this.killCam) {
      this.killCam.t += dt;
      if (this.killCam.t > 3.2) {
        this.killCam = null;
        this.cameraOverride = false;
        g.post.gforce.set('uLetterbox', 0);
      }
    }
    // landing camera: LSO view from the deck in the last seconds
    if (this.phase === 'approach' && this.sTouch - st.player.s < 900) this.cameraOverride = true;
  }

  render(alpha, realDt) {
    const st = this.stage;
    const g = this.game;
    this.deck.update(realDt, g.rig.camera);
    this.whiteout = this.deckWhite || 0;
    if (!this.cameraOverride) return;
    const cam = g.rig.camera;
    if (this.killCam) {
      // orbit around the dying bomber
      const kc = this.killCam;
      kc.pos.addScaledVector(kc.vel, realDt * g.clock.timeScale);
      const a = 0.6 + kc.t * 0.45;
      cam.position.set(kc.pos.x + Math.sin(a) * 140, kc.pos.y + 30, kc.pos.z + Math.cos(a) * 140);
      _m.lookAt(cam.position, kc.pos, _up);
    } else {
      // off the port quarter near the fantail, looking up the glide path
      this.carrier.deckPoint(-58, 235, cam.position);
      cam.position.y -= 4;
      _v.copy(st.jet.group.position);
      _m.lookAt(cam.position, _v, _up);
    }
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
    g.world.scene.remove(this.deck.mesh);
    this.deck.dispose();
    g.world.scene.remove(this.carrier.group);
    for (const ps of this.podSmoke) ps.smoke.stop();
    for (let i = 0; i < 3; i++) g.world.ocean?.setWake(i, 0, 0, 0, 0);
    g.post.gforce.set('uLetterbox', 0);
  }
}

export { CARRIER };
