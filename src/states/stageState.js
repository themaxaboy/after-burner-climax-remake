import { BoxGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Rail } from '../sim/rail.js';
import { Player } from '../sim/player.js';
import { applyWorldFog } from '../render/worldUniforms.js';

/**
 * Gameplay state for one stage. M1: flight over the world with the chase cam.
 */
export class StageState {
  constructor(game, stageDef, opts = {}) {
    this.game = game;
    this.def = stageDef;
    this.opts = opts;
    this.loading = true;
  }

  async enter() {
    const g = this.game;
    const def = this.def;
    this.rail = new Rail(def.rail);
    g.world.configure(def.env);
    g.renderer.toneMappingExposure = def.env.toneExposure ?? 0.6;
    g.post.grade.setGrade(def.env.grade || 'neutral');

    this.player = new Player();
    this.player.reset({ s: 200, baseSpeed: def.rail.baseSpeed, box: def.rail.box });
    this.player.computePose(this.rail);
    this.player.prevPos.copy(this.player.pos);

    this.jet = this._placeholderJet();
    g.world.dynamic.add(this.jet);

    if (g.params.t > 0) this.fastForward(g.params.t);
    this.loading = false;
  }

  _placeholderJet() {
    const grp = new Group();
    const mat = applyWorldFog(new MeshStandardMaterial({ color: 0x8a939c, metalness: 0.4, roughness: 0.45 }));
    const body = new Mesh(new ConeGeometry(0.9, 16, 12), mat);
    body.rotation.x = -Math.PI / 2;
    const wing = new Mesh(new BoxGeometry(12, 0.25, 4), mat);
    wing.position.z = 1.5;
    const tail = new Mesh(new BoxGeometry(0.2, 3, 2.5), mat);
    tail.position.set(0, 1.5, 6);
    grp.add(body, wing, tail);
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return grp;
  }

  fastForward(sec) {
    const steps = Math.floor(sec * 120);
    const input = { moveX: 0, moveY: 0, throttleAxis: 0 };
    for (let i = 0; i < steps; i++) this.player.update(1 / 120, input, this.rail);
  }

  update(dt, wdt) {
    const p = this.player;
    const input = this.game.input;
    if (input.pressed.rollL) p.startRoll(-1);
    if (input.pressed.rollR) p.startRoll(1);
    p.update(wdt, input, this.rail);
  }

  render(alpha, realDt) {
    const g = this.game;
    const p = this.player;
    // interpolate jet transform
    this.jet.position.lerpVectors(p.prevPos, p.pos, alpha);
    this.jet.quaternion.slerpQuaternions(p.prevQuat, p.quat, alpha);
    g.rig.update(p, this.rail, alpha, realDt);
    g.world.update(realDt, g.rig.camera);
    g.renderWorld(realDt);
  }

  debugText() {
    const p = this.player;
    return `s ${p.s.toFixed(0)}/${this.rail.length.toFixed(0)}  v ${p.speed.toFixed(0)}  x ${p.x.toFixed(1)} y ${p.y.toFixed(1)}  G ${p.gLoad.toFixed(1)}`;
  }
}
