import { BoxGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { applyWorldFog } from './worldUniforms.js';

const _v = new Vector3();

/**
 * Player aircraft visual: procedural model (or placeholder), afterburner
 * flames, wingtip vortex trails under G / during jinks, vapor cone at FAST and
 * at the start of the Climax afterburn (`player.boost`), control surfaces.
 */
export class PlayerJet {
  constructor({ models, fx, jetId = 'fa18e', scheme = 'standard', csm = null }) {
    this.group = new Group();
    this.group.name = 'playerJet';
    this.fx = fx;
    this.model = null;
    this.materials = [];
    if (models && models.buildAircraft) {
      try {
        this.model = models.buildAircraft(jetId, { lod: 0, scheme });
      } catch (e) {
        console.warn('player model failed', e);
      }
    }
    if (this.model) {
      this.group.add(this.model.root);
      this.nozzles = this.model.nozzles;
      this.wingtips = this.model.wingtips;
      this.hardpoints = this.model.hardpoints || [new Vector3(-2, -0.8, 1), new Vector3(2, -0.8, 1)];
      for (const m of Object.values(this.model.materials)) if (m) this.materials.push(m);
    } else {
      this._placeholder();
    }
    for (const m of this.materials) {
      if (!m.userData.worldFog) {
        m.userData.worldFog = true;
        applyWorldFog(m);
        if (csm) csm.setupMaterial(m);
      }
    }
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.afterburner = fx?.createAfterburner ? fx.createAfterburner(this.nozzles, {}) : null;
    if (this.afterburner) this.group.add(this.afterburner.object);
    this.vortex = [null, null];
    this.vapor = 0;
    this.boostT = -1; // s since the Climax afterburn started (-1 = off)
    this.hardpointIndex = 0;
  }

  _placeholder() {
    const mat = new MeshStandardMaterial({ color: 0x8a939c, metalness: 0.4, roughness: 0.45 });
    this.materials.push(mat);
    const body = new Mesh(new ConeGeometry(0.9, 16, 12).rotateX(-Math.PI / 2), mat);
    const wing = new Mesh(new BoxGeometry(12, 0.25, 4).translate(0, 0, 1.5), mat);
    const tail = new Mesh(new BoxGeometry(0.2, 3, 2.5).translate(0, 1.5, 6), mat);
    this.group.add(body, wing, tail);
    this.nozzles = [
      { position: new Vector3(-0.6, 0, 8), radius: 0.45, direction: new Vector3(0, 0, 1) },
      { position: new Vector3(0.6, 0, 8), radius: 0.45, direction: new Vector3(0, 0, 1) }
    ];
    this.wingtips = [new Vector3(-6, 0, 2), new Vector3(6, 0, 2)];
    this.hardpoints = [new Vector3(-2.5, -0.6, 1), new Vector3(2.5, -0.6, 1)];
  }

  nextHardpoint(out) {
    const hp = this.hardpoints[this.hardpointIndex % this.hardpoints.length];
    this.hardpointIndex++;
    return out.copy(hp).applyQuaternion(this.group.quaternion).add(this.group.position);
  }

  /** Nozzle positions in world space (for heat haze). */
  nozzleWorld(i, out) {
    const n = this.nozzles[i] || this.nozzles[0];
    return out.copy(n.position).applyMatrix4(this.group.matrixWorld);
  }

  update(player, alpha, realDt, timeSec) {
    const g = this.group;
    g.position.lerpVectors(player.prevPos, player.pos, alpha);
    g.quaternion.slerpQuaternions(player.prevQuat, player.quat, alpha);
    g.updateMatrixWorld();
    const speed01 = Math.min(1, Math.max(0, (player.speed - player.baseSpeed * 0.7) / (player.baseSpeed * 0.75)));
    if (this.model?.animate) {
      this.model.animate({
        roll: player.surfaces.roll,
        pitch: player.surfaces.pitch,
        yaw: player.surfaces.yaw,
        speed01,
        flaps: player.throttle < 0 ? 0.6 : 0,
        gear: player.gear || 0,
        time: timeSec
      });
    }
    const boost = player.boost > 0;
    this.boostT = boost ? (this.boostT < 0 ? 0 : this.boostT + realDt) : -1;
    if (this.afterburner) {
      if (boost) this.afterburner.set(1, 1);
      else this.afterburner.set(0.55 + player.throttle * 0.3 + 0.15, player.afterburner);
    }
    // wingtip vortices under high G / hard turns / jinks / afterburn
    const fx = this.fx;
    if (fx?.createTrail) {
      const pull = player.gLoad > 3.2 || Math.abs(player.bank) > 1.0 || player.jinkT > 0 || boost;
      for (let i = 0; i < 2; i++) {
        if (pull) {
          if (!this.vortex[i]) this.vortex[i] = fx.createTrail({ kind: 'vortex', width: 0.16, life: 0.32 });
          this.vortex[i].push(_v.copy(this.wingtips[i]).applyMatrix4(g.matrixWorld));
        } else if (this.vortex[i]) {
          this.vortex[i].stop();
          this.vortex[i] = null;
        }
      }
    }
    // vapor cone when punching through to FAST
    const punch = player.throttle > 0 && player.speed > player.baseSpeed * 1.2 && player.speed < player.baseSpeed * 1.38;
    const targetVapor = punch || (boost && this.boostT < 0.7) ? 1 : 0;
    this.vapor += (targetVapor - this.vapor) * Math.min(1, realDt * 5);
    if (fx?.vaporCone) fx.vaporCone(g, this.vapor);
  }

  dispose() {
    this.afterburner?.dispose?.();
    for (let i = 0; i < 2; i++) if (this.vortex[i]) this.vortex[i].stop();
    this.group.removeFromParent();
  }

  setVisible(v) {
    this.group.visible = v;
    if (!v) for (let i = 0; i < 2; i++) if (this.vortex[i]) { this.vortex[i].stop(); this.vortex[i] = null; }
  }
}
