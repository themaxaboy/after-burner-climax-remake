import { describe, it, expect, vi, afterEach } from 'vitest';
import { Input } from '../../src/input/input.js';
import { GamepadSource, decodeHat, genericDpad } from '../../src/input/gamepad.js';
import { DEFAULT_SETTINGS } from '../../src/core/save.js';

const DT = 1 / 120;

function buttons(n, down = []) {
  return Array.from({ length: n }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 }));
}

function makePad(o = {}) {
  return { index: 0, id: 'Test Pad (STANDARD GAMEPAD)', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: buttons(17), ...o };
}

/** Input + GamepadSource reading a fake navigator.getGamepads(). */
function rig(pads, opts) {
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  const input = new Input({});
  const gp = input.addSource(new GamepadSource(opts));
  const log = [];
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      input.poll(DT);
      log.push({ moveX: input.moveX, moveY: input.moveY, pressed: { ...input.pressed }, hold: { ...input.hold } });
      input.endStep();
    }
    return log[log.length - 1];
  };
  return { input, gp, step, log };
}

const count = (log, a) => log.filter((f) => f.pressed[a]).length;

afterEach(() => vi.unstubAllGlobals());

describe('gamepad: every connected pad is merged', () => {
  it('a real pad steers and fires past a null slot and an idle phantom device', () => {
    const phantom = makePad({ index: 1, id: 'Virtual HID Device', mapping: '', axes: [0, 0], buttons: buttons(4) });
    const real = makePad({ index: 2 });
    const { step, gp } = rig([null, phantom, real]);
    const seen = [];
    gp.onFirstInput = (p) => seen.push(p.id);
    expect(step().moveX).toBe(0);
    real.axes[0] = 1;
    real.axes[1] = -1; // stick up = climb
    const f = step();
    expect(f.moveX).toBeGreaterThan(0.6);
    expect(f.moveY).toBeGreaterThan(0.6);
    real.axes[0] = real.axes[1] = 0;
    real.buttons[0] = { pressed: true, value: 1 };
    const g = step();
    expect(g.pressed.missile).toBe(true);
    expect(g.pressed.confirm).toBe(true);
    expect(seen).toEqual([real.id]); // once, and never for the idle phantom
  });

  it('ignores a phantom axis stuck at full deflection and rumbles the pad in use', () => {
    const stuck = makePad({ index: 0, id: 'Stuck Wheel', mapping: '', axes: [-1, -1, 0, 0], buttons: buttons(8) });
    const real = makePad({ index: 3 });
    const fx = [];
    real.vibrationActuator = { playEffect: (type, p) => (fx.push([type, p]), Promise.resolve()) };
    stuck.vibrationActuator = { playEffect: () => { throw new Error('rumbled the phantom'); } };
    const { step, gp } = rig([stuck, null, null, real]);
    expect(step(5).moveX).toBe(0);
    real.axes[0] = -1;
    expect(step().moveX).toBeLessThan(-0.9);
    gp.rumble(1, 0.5, 100);
    expect(fx.length).toBe(1);
    expect(fx[0][0]).toBe('dual-rumble');
  });

  it('ORs buttons across pads without extra edges', () => {
    const a = makePad({ index: 0 });
    const b = makePad({ index: 1 });
    const { step, log } = rig([a, b]);
    a.buttons[0] = { pressed: true, value: 1 };
    step();
    b.buttons[0] = { pressed: true, value: 1 };
    step();
    a.buttons[0] = { pressed: false, value: 0 };
    const f = step();
    expect(f.hold.missile).toBe(true); // still held on pad b
    expect(count(log, 'missile')).toBe(1);
  });
});

describe('gamepad: non-standard mapping', () => {
  it('decodes a hat switch axis', () => {
    expect(decodeHat(-1)).toEqual([0, -1]);
    expect(decodeHat(-0.4286)).toEqual([1, 0]);
    expect(decodeHat(0.1429)).toEqual([0, 1]);
    expect(decodeHat(0.7143)).toEqual([-1, 0]);
    expect(decodeHat(3.2857)).toBe(null); // centred
    expect(decodeHat(0)).toBe(null); // an analog axis at rest is not a hat value
    expect(genericDpad([0, 0, 0, 0, 0, 0, -1, 0])).toEqual([-1, 0]);
    expect(genericDpad([0, 0, 0, 0, 0, 0, 0.37, 0])).toBe(null);
  });

  it('confirms with any face button and steers with the stick and the hat', () => {
    const axes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 3.2857];
    const generic = makePad({ id: 'USB Joystick (Vendor: 0079 Product: 0006)', mapping: '', axes, buttons: buttons(12) });
    const { step, log } = rig([generic]);
    expect(step().moveX).toBe(0);
    generic.buttons[2] = { pressed: true, value: 1 };
    const f = step();
    expect(f.pressed.confirm).toBe(true);
    expect(f.hold.climax).toBe(true);
    generic.buttons[2] = { pressed: false, value: 0 };
    step();
    // hat left: D-pad hold (menus get a press; flight reads the hold)
    axes[9] = 0.7143;
    const h = step();
    expect(h.pressed.left).toBe(true);
    expect(step().moveX).toBeLessThan(-0.9);
    axes[9] = 3.2857;
    step();
    expect(step().moveX).toBe(0);
    // stick
    axes[0] = 0.8;
    expect(step().moveX).toBeGreaterThan(0.6);
    expect(count(log, 'back')).toBe(0);
  });
});

describe('gamepad: stick-flick roll setting', () => {
  // hold left, then snap to the right in 0.1 s
  function flick(step, pad) {
    step(); // the pad is first seen at rest
    pad.axes[0] = -1;
    step(30);
    for (let i = 0; i <= 12; i++) {
      pad.axes[0] = -1 + (2 * i) / 12;
      step();
    }
  }

  it('defaults: stick-flick roll on (unchanged feel), soft missile alarm', () => {
    expect(DEFAULT_SETTINGS.stickRoll).toBe(true);
    expect(DEFAULT_SETTINGS.missileTone).toBe('soft');
  });

  it('rolls on a quick left→right reversal by default (stickRoll on)', () => {
    const p = makePad();
    const { step, log, gp } = rig([p]);
    expect(gp.stickRoll).toBe(true);
    flick(step, p);
    expect(count(log, 'rollR')).toBe(1);
  });

  it('does not roll on the same reversal with stickRoll off; LB/RB still roll', () => {
    const p = makePad();
    const { step, log } = rig([p], { stickRoll: false });
    flick(step, p);
    expect(count(log, 'rollR') + count(log, 'rollL')).toBe(0);
    p.buttons[4] = { pressed: true, value: 1 };
    expect(step().pressed.rollL).toBe(true);
  });
});

describe('gamepad: menu navigation from the stick', () => {
  it('presses a direction once, then repeats after 0.35 s every 0.12 s', () => {
    const p = makePad();
    const { step, log } = rig([p]);
    step();
    p.axes[1] = 1; // down
    step();
    expect(count(log, 'down')).toBe(1);
    step(Math.round(0.3 / DT));
    expect(count(log, 'down')).toBe(1); // no repeat before 0.35 s
    step(Math.round(0.7 / DT)); // 1.0 s held in total → 1 + 6 repeats
    const n = count(log, 'down');
    expect(n).toBeGreaterThanOrEqual(6);
    expect(n).toBeLessThanOrEqual(8);
    expect(count(log, 'up') + count(log, 'left') + count(log, 'right')).toBe(0);
    p.axes[1] = 0;
    step(10);
    expect(count(log, 'down')).toBe(n);
  });
});
