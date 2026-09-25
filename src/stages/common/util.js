import { Vector3 } from 'three';
import { makeFrame } from '../../sim/rail.js';
import { groundAt } from './compose.js';

const _f = makeFrame();
const _r = new Vector3();
const _up = new Vector3(0, 1, 0);

const smooth = (t) => t * t * (3 - 2 * t);

/** Interpolated terrain section {width, depth, floor} at rail distance s (def.terrain.sections). */
export function sectionAt(sections, s, out = { width: 0, depth: 0, floor: 0 }) {
  if (!sections?.length) return out;
  let a = sections[0], b = sections[0], t = 0;
  if (s > sections[0].s) {
    a = b = sections[sections.length - 1];
    for (let i = 1; i < sections.length; i++) {
      if (s <= sections[i].s) {
        a = sections[i - 1];
        b = sections[i];
        t = smooth((s - a.s) / Math.max(1, b.s - a.s));
        break;
      }
    }
  }
  out.width = a.width + (b.width - a.width) * t;
  out.depth = a.depth + (b.depth - a.depth) * t;
  out.floor = (a.floor ?? 0) + ((b.floor ?? 0) - (a.floor ?? 0)) * t;
  return out;
}

/** Terrain component of the running stage logic (the one with safeX), or null. */
export function terrainPart(stage) {
  const parts = stage.stageLogic?.parts;
  return parts ? parts.find((p) => typeof p.safeX === 'function') || null : null;
}

/** Lateral offset of the free corridor centre at s (terrain stages), else 0. */
export function corridorX(stage, s) {
  const tp = terrainPart(stage);
  if (!tp) return 0;
  // raw corridor centre when the terrain exposes it, else the (box-clamped) safe x
  const x = typeof tp.shape?.centreAt === 'function' ? tp.shape.centreAt(s) : tp.safeX(s, 0);
  return Number.isFinite(x) ? x : 0;
}

/** World point for rail distance s, horizontal lateral offset l and height above ground. */
export function groundPoint(stage, s, l, above, out = new Vector3()) {
  stage.rail.frameAt(Math.max(0, s), _f);
  _r.crossVectors(_f.T, _up).normalize();
  out.copy(_f.pos).addScaledVector(_r, l);
  out.y = groundAt(stage, s, l) + above;
  return out;
}

/** Launch an enemy SAM from a world point toward the player. */
export function launchSam(stage, from, speed = 180, bonus = 60) {
  const p = stage.player;
  stage.fx.smokePuff?.(from, _r.set(0, 20, 0), 12, 2);
  const vel = _r.subVectors(p.pos, from).normalize().multiplyScalar(speed);
  return stage.missiles.launch('enemy', from, vel, p, { speedBonus: bonus });
}
