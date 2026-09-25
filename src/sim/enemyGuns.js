import { Vector3 } from 'three';
import { interceptTime } from '../core/math.js';
import { segSphere } from './weapons.js';

const _a = new Vector3();
const _b = new Vector3();
const _rel = new Vector3();
const _rv = new Vector3();
const _dir = new Vector3();

/**
 * Enemy cannon bursts: real bullets aimed at the player's predicted position
 * with spread that grows with distance and at FAST throttle, so speed and
 * movement genuinely dodge fire.
 */
export class EnemyGuns {
  constructor({ max = 256, rng, hooks = {} }) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.alive = new Uint8Array(max);
    this.head = 0;
    this.rng = rng;
    this.hooks = hooks;
    this.queue = []; // pending burst rounds {e, t, n}
    this.packedPos = new Float32Array(max * 3);
    this.packedVel = new Float32Array(max * 3);
    this.count = 0;
    this.speed = 950;
    this.spreadMul = 1;
  }

  reset() {
    this.alive.fill(0);
    this.queue.length = 0;
    this.count = 0;
  }

  burst(e, rounds = 10) {
    this.queue.push({ e, t: 0, n: rounds, cd: 0 });
  }

  _shoot(e, player) {
    _rel.subVectors(player.pos, e.pos);
    _rv.subVectors(player.velocity, e.vel);
    const t = interceptTime(_rel.x, _rel.y, _rel.z, _rv.x, _rv.y, _rv.z, this.speed);
    _dir.copy(_rel);
    if (t > 0) _dir.addScaledVector(_rv, t);
    const dist = _dir.length();
    _dir.divideScalar(dist);
    const spread = (0.004 + dist * 0.0000075) * this.spreadMul;
    _dir.x += (this.rng.next() - 0.5) * spread * 2;
    _dir.y += (this.rng.next() - 0.5) * spread * 2;
    _dir.z += (this.rng.next() - 0.5) * spread * 2;
    _dir.normalize();
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const o = i * 3;
    this.pos[o] = e.pos.x + _dir.x * (e.radius + 2);
    this.pos[o + 1] = e.pos.y + _dir.y * (e.radius + 2);
    this.pos[o + 2] = e.pos.z + _dir.z * (e.radius + 2);
    this.vel[o] = e.vel.x + _dir.x * this.speed;
    this.vel[o + 1] = e.vel.y + _dir.y * this.speed;
    this.vel[o + 2] = e.vel.z + _dir.z * this.speed;
    this.life[i] = 2.2;
    this.alive[i] = 1;
  }

  update(dt, player, godMode = false) {
    for (let q = this.queue.length - 1; q >= 0; q--) {
      const b = this.queue[q];
      b.cd -= dt;
      if (!b.e.active || b.e.dead) {
        this.queue.splice(q, 1);
        continue;
      }
      while (b.cd <= 0 && b.n > 0) {
        this._shoot(b.e, player);
        b.n--;
        b.cd += 0.055;
      }
      if (b.n <= 0) this.queue.splice(q, 1);
    }
    const P = this.pos, V = this.vel;
    const pr = 5.5;
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      const o = i * 3;
      _a.set(P[o], P[o + 1], P[o + 2]);
      P[o] += V[o] * dt;
      P[o + 1] += V[o + 1] * dt;
      P[o + 2] += V[o + 2] * dt;
      _b.set(P[o], P[o + 1], P[o + 2]);
      this.life[i] -= dt;
      if (player.alive && !godMode && segSphere(_a, _b, player.pos, pr)) {
        this.alive[i] = 0;
        this.hooks.onPlayerHit?.(_b);
        continue;
      }
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        continue;
      }
      const p = n * 3;
      this.packedPos[p] = P[o]; this.packedPos[p + 1] = P[o + 1]; this.packedPos[p + 2] = P[o + 2];
      this.packedVel[p] = V[o]; this.packedVel[p + 1] = V[o + 1]; this.packedVel[p + 2] = V[o + 2];
      n++;
    }
    this.count = n;
  }
}
