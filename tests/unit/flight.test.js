import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { Player, FLIGHT } from '../../src/sim/player.js';
import { Rail } from '../../src/sim/rail.js';
import { Reticle, RETICLE } from '../../src/sim/reticle.js';
import { CameraRig, CHASE, SLIDE_LIMITS } from '../../src/render/cameraRig.js';
import { SnapDetector } from '../../src/input/input.js';
import { projectPoint } from '../../src/sim/lockon.js';
import { buildRail } from '../../src/stages/railBuilder.js';

const DT = 1 / 120;
const straight = new Rail({ points: buildRail({ start: [0, 300, 0], segs: [{ len: 40000, turn: 0 }] }) });
const turning = new Rail({ points: buildRail({ start: [0, 300, 0], segs: [{ len: 4000, turn: 0 }, { len: 12000, turn: 120 }, { len: 12000, turn: -120 }] }) });

function makePlayer(box = { x: 240, y: 100 }) {
  const p = new Player();
  p.reset({ s: 100, baseSpeed: 230, box });
  p.computePose(straight);
  p.prevPos.copy(p.pos);
  return p;
}

const input = (moveX = 0, moveY = 0) => ({ moveX, moveY, throttleAxis: 0 });

describe('flight model', () => {
  it('moves wide: crosses most of a 240 m box in about 3 s', () => {
    const p = makePlayer();
    expect(p.lateralSpeed).toBeGreaterThanOrEqual(140);
    expect(p.verticalSpeed).toBeGreaterThanOrEqual(90);
    let t = 0;
    while (p.x < 200 && t < 5) {
      p.update(DT, input(1, 0), straight);
      t += DT;
    }
    expect(t).toBeLessThan(3);
  });

  it('box edges are soft: never exceeds the box, brakes smoothly, pinned edge adds no G', () => {
    const p = makePlayer();
    let maxJump = 0, prevVx = 0, maxG = 0;
    for (let i = 0; i < 120 * 5; i++) {
      p.update(DT, input(1, 1), straight);
      expect(p.x).toBeLessThanOrEqual(p.box.x + 1e-6);
      expect(p.y).toBeLessThanOrEqual(p.box.y + 1e-6);
      maxJump = Math.max(maxJump, Math.abs(p.vx - prevVx));
      prevVx = p.vx;
      maxG = Math.max(maxG, p.gLoad);
    }
    // largest per-step velocity change stays small (no wall slam)
    expect(maxJump).toBeLessThan(8);
    expect(maxG).toBeLessThanOrEqual(9);
    // pinned at the corner with the stick still pushed: G settles back near 1
    expect(p.x).toBeGreaterThan(p.box.x - 1);
    expect(p.gLoad).toBeLessThan(1.3);
  });

  it('gLoad stays ≤ 9 during violent stick reversals and reads high G', () => {
    const p = makePlayer();
    let maxG = 0;
    for (let i = 0; i < 120 * 10; i++) {
      const phase = Math.floor(i / 36) % 2 ? 1 : -1; // reverse every 0.3 s
      p.update(DT, input(phase, -phase), straight);
      maxG = Math.max(maxG, p.gLoad);
      expect(p.gLoad).toBeLessThanOrEqual(9);
      expect(p.gLoad).toBeGreaterThanOrEqual(1);
    }
    expect(maxG).toBeGreaterThan(3);
    // cruising straight settles to 1 G
    for (let i = 0; i < 120 * 3; i++) p.update(DT, input(0, 0), straight);
    expect(p.gLoad).toBeLessThan(1.1);
    expect(p.gOverride).toBe(0);
  });

  it('bank follows lateral speed up to ~70°, yaw is small', () => {
    const p = makePlayer();
    p.x = -200;
    for (let i = 0; i < 120; i++) p.update(DT, input(1, 0), straight);
    expect(p.bank).toBeGreaterThan(55 * (Math.PI / 180));
    expect(p.bank).toBeLessThan(85 * (Math.PI / 180));
    expect(Math.abs(p.yaw)).toBeLessThanOrEqual(FLIGHT.yawMax + 1e-9);
  });

  it('barrel roll: 0.55 s, 0.5 s evade window, drifts sideways', () => {
    const p = makePlayer();
    expect(p.startRoll(1)).toBe(true);
    expect(p.evadeWindow).toBeCloseTo(0.5);
    expect(p.startRoll(-1)).toBe(false);
    let t = 0;
    while (p.rollT > 0 && t < 2) {
      p.update(DT, input(0, 0), straight);
      t += DT;
      if (t < 0.45) expect(p.evadeWindow).toBeGreaterThan(0);
    }
    expect(t).toBeGreaterThan(0.5);
    expect(t).toBeLessThan(0.6);
    expect(p.evadeWindow).toBe(0);
    expect(p.x).toBeGreaterThan(20);
    expect(p.rollAngle).toBe(0);
  });

  it('noRoll stages turn the roll into a quick sideways jink', () => {
    const p = makePlayer({ x: 200, y: 80 });
    p.noRoll = true;
    expect(p.startRoll(-1)).toBe(true);
    expect(p.rollT).toBe(0);
    expect(p.jinkT).toBeGreaterThan(0);
    expect(p.evadeWindow).toBeGreaterThan(0.3);
    let maxBank = 0;
    for (let i = 0; i < 60; i++) {
      p.update(DT, input(0, 0), straight);
      maxBank = Math.max(maxBank, -p.bank);
      expect(p.rollAngle).toBe(0);
    }
    expect(p.x).toBeLessThan(-35);
    expect(maxBank).toBeGreaterThan(0.9);
    expect(p.gLoad).toBeLessThanOrEqual(9);
  });

  it('external velocity resets (respawn, cinematics) do not spike G', () => {
    const p = makePlayer();
    for (let i = 0; i < 120; i++) p.update(DT, input(1, 0), straight);
    const g0 = p.gLoad;
    p.vx = p.vy = 0;
    p.x = 0;
    for (let i = 0; i < 12; i++) {
      p.update(DT, input(0, 0), straight);
      expect(p.gLoad).toBeLessThanOrEqual(g0 + 0.05);
    }
  });

  it('terrain floor rising under the jet pushes it up without G spikes', () => {
    const p = makePlayer({ x: 200, y: 80 });
    const lim = { minY: -80 };
    for (let i = 0; i < 240; i++) {
      lim.minY = -80 + i * 0.6;
      p.update(DT, input(0, -1), straight, lim);
      expect(p.y).toBeGreaterThanOrEqual(lim.minY - 1e-6);
      expect(p.gLoad).toBeLessThanOrEqual(9);
    }
  });
});

describe('stick snap roll', () => {
  it('fires on a side-to-side snap within 0.18 s, not on a slow sweep', () => {
    const d = new SnapDetector();
    let out = 0;
    for (let i = 0; i < 30; i++) out ||= d.update(-1, DT);
    expect(out).toBe(0);
    // snap: -1 → +1 in 0.1 s
    for (let i = 0; i <= 12; i++) out ||= d.update(-1 + (2 * i) / 12, DT);
    expect(out).toBe(1);
    const slow = new SnapDetector();
    out = 0;
    for (let i = 0; i < 30; i++) out ||= slow.update(1, DT);
    for (let i = 0; i <= 60; i++) out ||= slow.update(1 - (2 * i) / 60, DT); // 0.5 s sweep
    expect(out).toBe(0);
  });
});

describe('chase camera + reticle', () => {
  function frame(p, rig, rail, n = 1, input0 = input(0, 0)) {
    for (let i = 0; i < n; i++) {
      p.update(DT, input0, rail);
      rig.update(p, rail, 1, DT);
    }
  }

  it('jet sits large in the lower centre; horizon rolls ≤ 30° with the bank', () => {
    const p = makePlayer();
    const rig = new CameraRig(16 / 9);
    frame(p, rig, straight, 120);
    const s = new Vector3();
    expect(projectPoint(rig.camera, p.pos, s)).toBe(true);
    // ~62 % down the screen (NDC y ≈ -0.24), centred
    expect(s.y).toBeLessThan(-0.12);
    expect(s.y).toBeGreaterThan(-0.4);
    expect(Math.abs(s.x)).toBeLessThan(0.02);
    expect(rig.camera.fov).toBeCloseTo(CHASE.fov, 0);
    // hard right: camera rolls toward the bank, clamped
    let maxRoll = 0;
    for (let i = 0; i < 240; i++) {
      frame(p, rig, straight, 1, input(1, 0));
      maxRoll = Math.max(maxRoll, rig.roll);
      expect(Math.abs(rig.roll)).toBeLessThanOrEqual(CHASE.rollMax + 1e-9);
    }
    expect(maxRoll).toBeGreaterThan(20 * (Math.PI / 180));
    // the jet travels across the screen with its box position (bounded), so the
    // reticle can reach the screen edges; at rest the slide settles on that offset
    expect(Math.abs(rig.slide.x)).toBeLessThanOrEqual(SLIDE_LIMITS.x + 1e-9);
    expect(rig.slide.x).toBeGreaterThan(CHASE.slideX * 0.5);
    frame(p, rig, straight, 360, input(0, 0));
    const want = Math.max(-1, Math.min(1, p.x / p.box.x)) * CHASE.slideX;
    expect(Math.abs(rig.slide.x - want)).toBeLessThan(0.3);
    expect(projectPoint(rig.camera, p.pos, s)).toBe(true);
    expect(s.x).toBeGreaterThan(0.3); // well right of centre, still on screen
    expect(s.x).toBeLessThan(0.85);
  });

  it('camera stays smooth through rail turns (no jumps)', () => {
    const p = new Player();
    p.reset({ s: 3000, baseSpeed: 230 });
    p.computePose(turning);
    p.prevPos.copy(p.pos);
    const rig = new CameraRig(16 / 9);
    frame(p, rig, turning, 10);
    const prev = rig.camera.position.clone();
    const q = rig.camera.quaternion.clone();
    let maxAng = 0;
    for (let i = 0; i < 120 * 20; i++) {
      frame(p, rig, turning, 1, input(Math.sin(i / 90), 0));
      const step = rig.camera.position.distanceTo(prev);
      expect(step).toBeLessThan(4); // ≤ ~480 m/s
      maxAng = Math.max(maxAng, rig.camera.quaternion.angleTo(q));
      prev.copy(rig.camera.position);
      q.copy(rig.camera.quaternion);
    }
    expect(maxAng).toBeLessThan(0.05); // < 3° per 1/120 s
  });

  it('reticle rides above the nose, leads with vx and is pulled ≤ 0.06 toward the target', () => {
    const r = new Reticle();
    const out = { x: 0, y: 0 };
    r.update(DT, 0, -0.3, 0, 0, null, 2, 16 / 9, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.y).toBeCloseTo(-0.3 + RETICLE.lift);
    for (let i = 0; i < 120; i++) r.update(DT, 0, -0.3, 1, 0, null, 2, 16 / 9, out);
    expect(out.x).toBeGreaterThan(0.03);
    const tgt = { sx: 0.8, sy: 0.5, onScreen: true };
    for (let i = 0; i < 240; i++) r.update(DT, 0, -0.3, 0, 0, tgt, 2, 16 / 9, out);
    const pull = Math.hypot((out.x - r.baseX) * (16 / 9), out.y - r.baseY);
    expect(pull).toBeLessThanOrEqual(RETICLE.maxPull + 1e-6);
    expect(pull).toBeGreaterThan(0.05);
    for (let i = 0; i < 240; i++) r.update(DT, 0, -0.3, 0, 0, tgt, 0, 16 / 9, out);
    expect(Math.abs(out.x - r.baseX)).toBeLessThan(1e-3);
  });

  it('camera ray through the reticle is a usable aim direction', () => {
    const cam = new PerspectiveCamera(58, 16 / 9, 1, 30000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld();
    const ray = new Vector3(0, 0.1, 0.5).unproject(cam).sub(cam.position).normalize();
    const pt = cam.position.clone().addScaledVector(ray, 700);
    const s = new Vector3();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    projectPoint(cam, pt, s);
    expect(s.x).toBeCloseTo(0, 4);
    expect(s.y).toBeCloseTo(0.1, 4);
  });
});
