import { Vector3 } from 'three';
import { projectPoint } from '../../sim/lockon.js';
import { dampTo } from '../../core/math.js';

const _s = new Vector3();

/**
 * Cruise missiles that must be shot down with the gun (cue 'cruise'): they
 * overtake low from behind, cruise a few hundred metres ahead weaving, then
 * accelerate away (escape) when their `hold` time runs out. They cannot be
 * locked (`e.lockable = false`, `e.gunOnly = true`); this component projects
 * them itself so the HUD can still mark them. Pair the cue with an `eo`
 * using `tags: [tag]` in the same timeline event.
 *
 * opts: { count = 3, tag = 'cruise', hold = 14, type = 'cruiseMissile' }
 */
export class CruiseMissiles {
  constructor(stage, opts = {}) {
    this.stage = stage;
    this.game = stage.game;
    this.opts = { count: 3, tag: 'cruise', hold: 14, type: 'cruiseMissile', ...opts };
    this.list = [];
  }

  cue(name) {
    if (name !== 'cruise') return;
    const st = this.stage;
    const p = st.player;
    const o = this.opts;
    for (let i = 0; i < o.count; i++) {
      const k = i - (o.count - 1) / 2;
      const e = st.enemies.spawn(o.type, {
        behavior: 'hover',
        rs: p.s - 260 - i * 60,
        rx: p.x + k * 50,
        ry: p.y - 12,
        tag: o.tag,
        params: { want: 230 + i * 70, hold: o.hold + i * 1.5, y: -6 + k * 8 }
      });
      if (!e) continue;
      e.behavior = cruise;
      e.behaviorName = 'cruise';
      e.lockable = false;
      e.gunOnly = true;
      this.list.push({ e, id: e.id });
    }
  }

  render() {
    if (!this.list.length) return;
    const st = this.stage;
    const cam = this.game.rig.camera;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const { e, id } = this.list[i];
      if (e.id !== id || !e.active || e.dead) {
        this.list.splice(i, 1);
        continue;
      }
      // lock-on skips non-lockable enemies: project for the HUD markers here
      const front = projectPoint(cam, e.lockPos, _s);
      e.onScreen = front && Math.abs(_s.x) < 1.05 && Math.abs(_s.y) < 1.05;
      e.sx = _s.x;
      e.sy = _s.y;
      e.dist = e.lockPos.distanceTo(st.player.pos);
    }
  }
}

/** Enemy behaviour (rail space): overtake low, hold ahead weaving, then escape. */
function cruise(e, dt, ctx, mgr) {
  const p = ctx.player;
  const b = e.b;
  if (!b.init) {
    b.init = 1;
    b.phase = 0;
    b.hold = e.params.hold ?? 14;
    b.want = e.params.want ?? 260;
  }
  const rel = e.rs - p.s;
  if (b.phase === 0) {
    e.rs += (p.speed + 150) * dt;
    e.ry = dampTo(e.ry, e.params.y ?? -6, 1.2, dt);
    if (rel > b.want) {
      b.phase = 1;
      b.x0 = e.rx;
    }
  } else if (b.phase === 1) {
    b.hold -= dt;
    e.rs += (p.speed + (b.want - rel) * 0.8) * dt;
    e.rx = dampTo(e.rx, b.x0 + Math.sin(e.t * 0.9 + e.id) * 26, 2, dt);
    e.ry = dampTo(e.ry, (e.params.y ?? -6) + Math.sin(e.t * 1.3 + e.id) * 5, 2, dt);
    if (b.hold <= 0) {
      b.phase = 2;
      b.vs = p.speed;
    }
  } else {
    b.vs += 140 * dt;
    e.rs += b.vs * dt;
    e.ry += 10 * dt;
    if (rel > 2600) mgr.despawn(e, true);
  }
}

export const cruiseMissiles = (opts) => (stage) => new CruiseMissiles(stage, opts);

/**
 * Enemies never shoot (bonus stage): enemy missile and gun requests are
 * swallowed. Collisions still count.
 */
export class NoFire {
  constructor(stage) {
    this.stage = stage;
  }

  init() {
    const ctx = this.stage.ctx;
    ctx.fireMissile = () => false;
    ctx.fireGun = () => false;
  }
}

export const noFire = () => (stage) => new NoFire(stage);
