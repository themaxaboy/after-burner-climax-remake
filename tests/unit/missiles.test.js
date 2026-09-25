import { describe, it, expect } from 'vitest';
import { Vector3, PerspectiveCamera, Matrix4 } from 'three';
import { MissileSystem, ENEMY_MISSILE } from '../../src/sim/missiles.js';
import { projectPoint } from '../../src/sim/lockon.js';
import { Rail, makeFrame } from '../../src/sim/rail.js';
import { Player } from '../../src/sim/player.js';
import { Rng } from '../../src/core/rng.js';
import { buildRail } from '../../src/stages/railBuilder.js';

const DT = 1 / 120;
const rail = new Rail({ points: buildRail({ start: [0, 150, 0], segs: [{ len: 40000, turn: 25 }] }) });
const NO_INPUT = { moveX: 0, moveY: 0, throttleAxis: 0 };

// launch geometries (player-relative rail space) and launcher kinds
const LAUNCHES = [
  { name: 'behind', ds: -300, dx: 40, dy: 15, kind: 'chaser' },
  { name: 'behind-wide', ds: -420, dx: -80, dy: 30, kind: 'chaser' },
  { name: 'ahead', ds: 1500, dx: -60, dy: 10, kind: 'headOn' },
  { name: 'ahead-side', ds: 1100, dx: 150, dy: 40, kind: 'headOn' },
  { name: 'side', ds: 700, dx: -450, dy: 30, kind: 'crossing' },
  { name: 'below', ds: 2200, dx: 200, dy: -130, kind: 'ground' }
];

const _f = makeFrame();
const _m = new Matrix4();
const _look = new Vector3();

function chaseCamera(cam, p) {
  rail.frameAt(p.s, _f);
  cam.position.copy(_f.pos).addScaledVector(_f.R, p.x * 0.8).addScaledVector(_f.U, p.y * 0.8 + 4.2).addScaledVector(_f.T, -17);
  _look.copy(p.pos).addScaledVector(_f.T, 90);
  _m.lookAt(cam.position, _look, _f.U);
  cam.quaternion.setFromRotationMatrix(_m);
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
}

function makePlayer(lat) {
  const p = new Player();
  p.reset({ s: 2000, baseSpeed: 230, box: { x: 240, y: 100 } });
  if (lat) p.lateralSpeed = lat;
  p.id = -1;
  p.active = true;
  p.computePose(rail);
  return p;
}

function launchFrom(ms, p, L, opts = {}) {
  const s = p.s + L.ds;
  rail.frameAt(s, _f);
  const pos = new Vector3().copy(_f.pos).addScaledVector(_f.R, p.x + L.dx).addScaledVector(_f.U, p.y + L.dy);
  const dir = new Vector3().subVectors(p.pos, pos).normalize();
  const vel = new Vector3();
  if (L.kind === 'chaser') vel.copy(_f.T).multiplyScalar(p.speed);
  else if (L.kind === 'headOn') vel.copy(_f.T).multiplyScalar(-210);
  else if (L.kind === 'crossing') vel.copy(_f.T).multiplyScalar(p.speed * 0.45).addScaledVector(_f.R, -Math.sign(L.dx) * 180);
  vel.addScaledVector(dir, 60);
  return ms.launch('enemy', pos, vel, p, { rs: L.kind === 'ground' ? undefined : s, ...opts });
}

/**
 * Fly one enemy missile at the player. `onStep(t, p, m)` may steer the player.
 * Returns {reason, tEnd, arcIn, arcN, hit}.
 */
function fly(L, seed, { onStep, opts, cam, lat } = {}) {
  const p = makePlayer(lat);
  let reason = null, tEnd = 0;
  const ms = new MissileSystem({ rng: new Rng(seed), hooks: { onEnd: (m, r) => (reason = r) } });
  const m = launchFrom(ms, p, L, opts);
  const ctx = { player: p, rail };
  const out = new Vector3();
  let arcIn = 0, arcN = 0;
  for (let i = 0; i < 120 * 12 && m.active; i++) {
    const t = i * DT;
    const input = onStep ? onStep(t, p, m) || NO_INPUT : NO_INPUT;
    p.update(DT, input, rail, null);
    ms.update(DT, ctx);
    tEnd = t;
    if (cam && m.active && m.cine === 2 && m.phase === 0) {
      chaseCamera(cam, p);
      arcN++;
      if (projectPoint(cam, m.pos, out) && Math.abs(out.x) <= 1 && Math.abs(out.y) <= 1) arcIn++;
    }
  }
  return { reason, tEnd, arcIn, arcN, hit: reason === 'hit', ms, m };
}

describe('enemy missiles: cinematic homing', () => {
  it('arcs are visible: >= 60% of arc samples inside a chase-camera frustum', () => {
    const cam = new PerspectiveCamera(62, 16 / 9, 1.2, 32000);
    let inside = 0, total = 0;
    for (const L of LAUNCHES) {
      for (let k = 0; k < 6; k++) {
        const r = fly(L, 100 + k, { cam });
        inside += r.arcIn;
        total += r.arcN;
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(inside / total).toBeGreaterThanOrEqual(0.6);
  });

  it('hits a straight-flying player >= 70% of the time', () => {
    let hits = 0, n = 0;
    for (const L of LAUNCHES) {
      for (let k = 0; k < 8; k++) {
        if (fly(L, 200 + k).hit) hits++;
        n++;
      }
    }
    expect(hits / n).toBeGreaterThanOrEqual(0.7);
  });

  it('a barrel roll ~0.8 s before impact defeats it (<= 10% hits), reported as lost', () => {
    let hits = 0, n = 0, lost = 0;
    for (const L of LAUNCHES) {
      for (let k = 0; k < 5; k++) {
        const seed = 300 + k;
        const ref = fly(L, seed);
        if (!ref.hit) continue;
        const tRoll = ref.tEnd - 0.8;
        let rolled = false;
        const r = fly(L, seed, {
          onStep: (t, p) => {
            if (!rolled && t >= tRoll) rolled = p.startRoll(1);
          }
        });
        n++;
        if (r.hit) hits++;
        if (r.reason === 'lost') lost++;
        expect(r.ms.evaded + (r.reason === 'lost' ? 0 : 1)).toBeGreaterThan(0);
      }
    }
    expect(n).toBeGreaterThan(15);
    expect(hits / n).toBeLessThanOrEqual(0.1);
    expect(lost / n).toBeGreaterThanOrEqual(0.9);
  });

  it('a roll too early (2 s before impact) does not save you', () => {
    let hits = 0, n = 0;
    for (const L of LAUNCHES) {
      const ref = fly(L, 400);
      if (!ref.hit) continue;
      let rolled = false;
      const r = fly(L, 400, { onStep: (t, p) => { if (!rolled && t >= ref.tEnd - 2) rolled = p.startRoll(-1); } });
      n++;
      if (r.hit) hits++;
    }
    expect(hits / n).toBeGreaterThanOrEqual(0.6);
  });

  it('a hard late jink (150 m/s lateral, FAST) dodges; an unhurried one does not', () => {
    const jink = (tImpact, lead, stick) => (t) => (t >= tImpact - lead ? { moveX: stick, moveY: 0.3 * stick, throttleAxis: stick === 1 ? 1 : 0 } : NO_INPUT);
    let hard = 0, soft = 0, n = 0;
    for (const L of LAUNCHES) {
      for (let k = 0; k < 3; k++) {
        const ref = fly(L, 500 + k, { lat: 150 });
        if (!ref.hit) continue;
        n++;
        if (!fly(L, 500 + k, { lat: 150, onStep: jink(ref.tEnd, 1.1, 1) }).hit) hard++;
        if (!fly(L, 500 + k, { lat: 150, onStep: jink(ref.tEnd, 1.1, 0.15) }).hit) soft++;
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(hard / n).toBeGreaterThanOrEqual(0.6);
    expect(soft / n).toBeLessThanOrEqual(0.3);
  });

  it('missed / lost missiles overshoot and self-destruct', () => {
    // player dodges hard from the start of the terminal phase: whatever misses must end on its own
    const r = fly(LAUNCHES[2], 7, { onStep: (t, p, m) => (m.phase === 1 ? { moveX: 1, moveY: 1, throttleAxis: 1 } : NO_INPUT) });
    expect(['hit', 'timeout', 'lost']).toContain(r.reason);
    expect(r.tEnd).toBeLessThan(ENEMY_MISSILE.life);
  });

  it('strong missiles are flagged, homes harder and report through threat()', () => {
    const p = makePlayer();
    const ms = new MissileSystem({ rng: new Rng(1), hooks: {} });
    const m = launchFrom(ms, p, LAUNCHES[2], { strong: true });
    expect(m.strong).toBe(true);
    for (let i = 0; i < 30; i++) {
      p.update(DT, NO_INPUT, rail, null);
      ms.update(DT, { player: p, rail });
    }
    const th = ms.threat(p.pos, p.velocity);
    expect(th).not.toBe(null);
    expect(th.m).toBe(m);
    expect(th.strong).toBe(true);
    expect(th.tgo).toBeGreaterThan(1);
    expect(th.tgo).toBeLessThan(6);
  });

  it('caps: >= 1 s between enemy launches, <= 6 alive (4 on low)', () => {
    for (const cap of [6, 4]) {
      const p = makePlayer();
      const ms = new MissileSystem({ rng: new Rng(2), hooks: {} });
      ms.enemyCap = cap;
      let launched = 0, maxAlive = 0, lastT = -10, minGap = 10;
      for (let i = 0; i < 120 * 12; i++) {
        const t = i * DT;
        p.update(DT, NO_INPUT, rail, null);
        // try to launch every step from far ahead (long flights: the cap binds)
        const m = launchFrom(ms, p, { ds: 2600, dx: 0, dy: 20, kind: 'headOn' });
        if (m) {
          launched++;
          minGap = Math.min(minGap, t - lastT);
          lastT = t;
        }
        ms.update(DT, { player: p, rail });
        maxAlive = Math.max(maxAlive, ms.count('enemy'));
      }
      expect(launched).toBeGreaterThan(cap);
      expect(minGap).toBeGreaterThanOrEqual(1 - 1e-6);
      expect(maxAlive).toBeLessThanOrEqual(cap);
    }
  });

  it('the vulcan can shoot enemy missiles down', () => {
    const p = makePlayer();
    const reasons = [];
    const ms = new MissileSystem({ rng: new Rng(3), hooks: { onEnd: (m, r) => reasons.push(r) } });
    launchFrom(ms, p, LAUNCHES[2]);
    for (let i = 0; i < 20; i++) ms.update(DT, { player: p, rail });
    const out = ms.shootables([]);
    expect(out.length).toBe(1);
    expect(out[0].radius).toBeGreaterThan(2);
    expect(out[0].pos).toBeInstanceOf(Vector3);
    expect(ms.shootDown(out[0])).toBe(true);
    expect(reasons).toEqual(['shot']);
    expect(ms.shootables(out).length).toBe(0);
  });

  it('is deterministic per seed', () => {
    const a = fly(LAUNCHES[0], 42);
    const b = fly(LAUNCHES[0], 42);
    expect(a.tEnd).toBe(b.tEnd);
    expect(a.reason).toBe(b.reason);
    expect(a.m.pos.x).toBe(b.m.pos.x);
  });
});

describe('player missiles keep PN + incoming bookkeeping', () => {
  it('counts incoming on the target and releases it on impact', () => {
    const tgt = { id: 9, active: true, dead: false, pos: new Vector3(0, 100, -1200), vel: new Vector3(0, 0, 150), radius: 10, incoming: 0 };
    tgt.lockPos = tgt.pos;
    let hit = false;
    const ms = new MissileSystem({ rng: new Rng(5), hooks: { onHit: () => (hit = true) } });
    ms.launch('player', new Vector3(0, 100, 0), new Vector3(0, -5, -230), tgt);
    expect(tgt.incoming).toBe(1);
    for (let i = 0; i < 120 * 5 && !hit; i++) {
      tgt.pos.addScaledVector(tgt.vel, DT);
      ms.update(DT, {});
    }
    expect(hit).toBe(true);
    expect(tgt.incoming).toBe(0);
  });

  it('player launches are never capped', () => {
    const ms = new MissileSystem({ rng: new Rng(6), hooks: {} });
    for (let i = 0; i < 10; i++) expect(ms.launch('player', new Vector3(), new Vector3(0, 0, -200), null)).toBeTruthy();
  });
});


