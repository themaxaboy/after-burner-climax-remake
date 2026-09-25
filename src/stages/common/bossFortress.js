import { Matrix4, Vector3 } from 'three';

const _v = new Vector3();
const _v2 = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

// B-52-style engine pod positions (local, metres) — fallback when the model
// does not expose its engine nodes.
const POD_FALLBACK = [[-11, -2.2, 1], [11, -2.2, 1], [-22, -1.4, 5], [22, -1.4, 5]];

/**
 * Multi-part flying fortress boss (cue 'boss'): an invulnerable heavy bomber
 * with four engine pods to lock first, burning pods trail smoke, then the
 * body becomes lockable; a slow-motion orbiting kill-cam when it dies.
 * Cue 'bossEscape' makes a surviving boss climb away.
 *
 * opts: { type = 'bomberB52', eo {id, title, bonus}, radio {win}, y = 55 }
 * The stage def must preload `type` and 'bossPod'.
 */
export class BossFortress {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = { type: 'bomberB52', y: 55, ...opts };
    this.cameraOverride = false;
    this.pods = [];
    this.podSmoke = [];
    this.podLocal = POD_FALLBACK;
  }

  async init() {
    const st = this.stage;
    try {
      const info = st.models?.buildAircraftGeometry?.(this.opts.type, 1);
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

  cue(name) {
    const st = this.stage;
    const g = this.game;
    if (name === 'boss') {
      const o = this.opts;
      const boss = st.enemies.spawn(o.type, { behavior: 'bossBomber', rs: st.player.s - 700, rx: 0, ry: 40, tag: 'boss', invuln: true, params: { y: o.y } });
      this.boss = boss;
      if (!boss) return;
      this.bossId = boss.id;
      boss.lockable = false; // lock the engines first
      this.podsLeft = 0;
      this.pods = this.podLocal.map((local, i) => {
        const pod = st.enemies.spawn('bossPod', { behavior: 'attached', tag: `pod${i}`, params: { parent: boss, local } });
        if (pod) this.podsLeft++;
        return pod;
      });
      const eo = o.eo || {};
      st.director._eoStart({ id: eo.id || 'boss', title: eo.title || 'DESTROY THE FORTRESS', kind: 'destroy', tags: ['boss'], count: 1, bonus: eo.bonus ?? 200000 }, st.player);
      st.hud.message('WARNING', { sub: eo.warning || 'HEAVY BOMBER APPROACHING — TARGET THE ENGINES', dur: 3, color: '#ff5a4a', style: 'center' });
      g.audio?.play('eoAlert');
      g.audio?.music?.setIntensity?.(1);
    } else if (name === 'bossEscape') {
      if (this._bossAlive()) {
        this.boss.behavior = () => {};
        this.escaping = true;
        st.hud.message('THE BOMBER IS ESCAPING', { dur: 2.5, color: '#ff5a4a' });
      }
    }
  }

  _bossAlive() {
    const b = this.boss;
    return !!b && b.id === this.bossId && b.active && !b.dead;
  }

  onKill(e) {
    const st = this.stage;
    const g = this.game;
    if (e.tag && e.tag.startsWith('pod') && e.params?.parent?.id === this.bossId) {
      st.fx.explosion(e.pos, { size: 1.6, kind: 'air', vel: e.vel });
      const smoke = st.fx.createSmokeEmitter({ fire: true });
      this.podSmoke.push({ smoke, local: e.params.local });
      const alive = --this.podsLeft;
      if (alive <= 0 && this._bossAlive()) {
        this.boss.invuln = false;
        this.boss.lockable = true;
        st.hud.message('ENGINES DOWN', { sub: 'FINISH IT!', dur: 2.2, color: '#ffd27a', style: 'center' });
      } else st.hud.message('ENGINE HIT', { sub: `${alive} REMAINING`, dur: 1.4, color: '#ffd27a' });
    }
    if (e.id === this.bossId && e.tag === 'boss') {
      // end Climax first so its time scale doesn't fight the kill-cam
      if (st.climax.active) {
        st.climax.end();
        st._endClimax();
      }
      g.clock.pulse(0.14, 1.8, 0.1, 0.5);
      this.killCam = { t: 0, pos: e.pos.clone(), vel: e.vel.clone() };
      this.cameraOverride = true;
      g.post.gforce.set('uLetterbox', 1);
      const at = e.pos.clone();
      for (let i = 0; i < 6; i++) {
        st.schedule(0.03 + i * 0.05, () => {
          _v.copy(this.killCam?.pos || at).add(_v2.set(st.rng.range(-25, 25), st.rng.range(-6, 6), st.rng.range(-15, 15)));
          st.fx.explosion(_v, { size: 3.6, kind: 'big' });
        });
      }
      if (this.opts.radio?.win) st._radio(this.opts.radio.win);
    }
  }

  update(dt) {
    const st = this.stage;
    const g = this.game;
    if (this.escaping && this._bossAlive()) {
      this.boss.rs += 120 * dt;
      this.boss.ry += 40 * dt;
      if (this.boss.rs - st.player.s > 3000) st.enemies.despawn(this.boss, true);
    }
    // burning engines trail smoke
    if (this._bossAlive()) {
      for (const ps of this.podSmoke) {
        _v.set(ps.local[0], ps.local[1], ps.local[2]).applyQuaternion(this.boss.quat).add(this.boss.pos);
        ps.smoke.update(_v, this.boss.vel, 1);
      }
    } else if (this.podSmoke.length) {
      for (const ps of this.podSmoke) ps.smoke.stop();
      this.podSmoke.length = 0;
    }
    if (this.killCam) {
      this.killCam.t += dt;
      if (this.killCam.t > 3.2) {
        this.killCam = null;
        this.cameraOverride = false;
        g.post.gforce.set('uLetterbox', 0);
      }
    }
  }

  /** Remove the boss (e.g. when a landing sequence starts). */
  clear() {
    if (this._bossAlive()) this.stage.enemies.despawn(this.boss, true);
  }

  render(alpha, realDt) {
    if (!this.killCam) return;
    const g = this.game;
    const cam = g.rig.camera;
    // orbit around the dying bomber
    const kc = this.killCam;
    kc.pos.addScaledVector(kc.vel, realDt * g.clock.timeScale);
    const a = 0.6 + kc.t * 0.45;
    cam.position.set(kc.pos.x + Math.sin(a) * 140, kc.pos.y + 30, kc.pos.z + Math.cos(a) * 140);
    _m.lookAt(cam.position, kc.pos, _up);
    cam.quaternion.setFromRotationMatrix(_m);
    if (Math.abs(cam.fov - 45) > 0.01) {
      cam.fov = 45;
      cam.updateProjectionMatrix();
    }
    g.rig._applyShake(realDt);
    cam.updateMatrixWorld();
  }

  dispose() {
    for (const ps of this.podSmoke) ps.smoke.stop();
    this.podSmoke.length = 0;
    this.game.post.gforce.set('uLetterbox', 0);
  }
}

export const bossFortress = (opts) => (stage) => new BossFortress(stage, opts);
