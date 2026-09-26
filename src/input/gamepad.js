import { SnapDetector } from './input.js';

// Gamepad provider. Every connected pad is polled each step and merged: stick
// axes are summed and clamped, buttons are OR-ed, so a phantom / virtual
// device can never shadow the pad being played.
//
// Standard mapping (pad.mapping === 'standard'):
//   LS: move   A: missile (hold: ripple)   B/X: Climax (hold)   RT: fast   LT: slow
//   LB/RB: barrel roll (also a stick snap from side to side, setting stickRoll)
//   Y: flare   Start: pause   D-pad: menu nav / steer
// Anything else (flight sticks, generic DirectInput pads, mapping === ''):
//   axes 0/1 steer; the D-pad comes from a hat axis (axes[9], 8 steps from -1
//   to 1, > 1.1 = centred) or from axes 6/7 when they read as -1/0/1;
//   buttons 0/1/2/3 missile / Climax / Climax / flare, 4/5 roll L/R,
//   6/7 slow / fast, 9 pause; any of 0–3 confirms, 8 (Select) goes back.
// The left stick also generates up/down/left/right presses with key repeat,
// so menus and the hangar work from the stick (harmless in flight).
const DEAD = 0.14;
const ARM = 0.3; // an axis counts once it has been seen near rest (stuck phantom axes never do)
const NAV_ON = 0.6;
const NAV_OFF = 0.4;
const NAV_DELAY = 0.35;
const NAV_REPEAT = 0.12;
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

// action → button indices, per mapping
const STANDARD = {
  missile: [BTN.A], climax: [BTN.B, BTN.X], flare: [BTN.Y], rollL: [BTN.LB], rollR: [BTN.RB],
  fast: [BTN.RT], slow: [BTN.LT], pause: [BTN.START],
  up: [BTN.UP], down: [BTN.DOWN], left: [BTN.LEFT], right: [BTN.RIGHT],
  confirm: [BTN.A], back: [BTN.B]
};
const GENERIC = {
  missile: [0], climax: [1, 2], flare: [3], rollL: [4], rollR: [5],
  slow: [6], fast: [7], pause: [9],
  up: [], down: [], left: [], right: [],
  // face-button layout differs per pad (DirectInput PS-style pads put Cross on
  // 1), so any face button confirms; back is Select (8) or Start, never a face
  // button, or one press would both confirm and go back (hangar)
  confirm: [0, 1, 2, 3], back: [8]
};
const ACTIONS = Object.keys(STANDARD);
const MOMENTARY = { rollL: true, rollR: true };
// hat switch: 8 directions from -1 (up) clockwise in steps of 2/7
const HAT_DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

function dz(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * (a - DEAD) / (1 - DEAD);
}

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

/** Decode a hat-switch axis value → [dx, dy] (screen: +y down), or null when centred / not a hat value. */
export function decodeHat(v) {
  if (typeof v !== 'number' || !(Math.abs(v) <= 1.05)) return null;
  const f = ((v + 1) * 7) / 2;
  const i = Math.round(f);
  if (Math.abs(f - i) > 0.2 || i < 0 || i > 7) return null;
  return HAT_DIRS[i];
}

const discrete = (v) => typeof v === 'number' && (Math.abs(v) < 0.02 || Math.abs(Math.abs(v) - 1) < 0.02);

/** D-pad direction of a non-standard pad: hat axis 9, else axes 6/7 when they read -1/0/1. */
export function genericDpad(axes) {
  if (axes.length > 9) {
    const h = decodeHat(axes[9]);
    if (h) return h;
    if (axes[9] > 1.1) return null; // centred hat
  }
  if (axes.length >= 8 && discrete(axes[6]) && discrete(axes[7])) {
    const x = Math.round(axes[6]), y = Math.round(axes[7]);
    if (x || y) return [x, y];
  }
  return null;
}

export class GamepadSource {
  /**
   * @param {object} [o]
   * @param {() => (Gamepad|null)[]} [o.getGamepads] pad list provider (default navigator.getGamepads)
   * @param {boolean} [o.stickRoll] stick-flick barrel roll (settings.stickRoll)
   */
  constructor({ getGamepads = null, stickRoll = true } = {}) {
    this.getGamepads = getGamepads;
    this.stickRoll = stickRoll;
    this.snap = new SnapDetector(0.18, 0.8);
    this.pads = new Map(); // index → {id, prev: Uint8Array, armed: [x, y], seen}
    this.state = Object.create(null); // merged action → 0/1 (last step)
    for (const a of ACTIONS) this.state[a] = 0;
    this.lastIndex = -1; // most recently used pad (rumble target)
    this.connected = false;
    this.stick = { x: 0, y: 0 }; // merged left stick (after dead zone), +y down
    /** Called once per pad on its first real input (button press or stick push): (pad) => void. */
    this.onFirstInput = null;
    this._nav = { dir: '', t: 0 };
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepaddisconnected', (e) => this.pads.delete(e.gamepad.index));
    }
  }

  /** Connected pads (nulls and disconnected slots dropped). */
  _list() {
    let pads = null;
    try {
      if (this.getGamepads) pads = this.getGamepads();
      else if (typeof navigator !== 'undefined' && navigator.getGamepads) pads = navigator.getGamepads();
    } catch {
      pads = null;
    }
    const out = [];
    if (pads) for (const p of pads) if (p && p.connected !== false) out.push(p);
    return out;
  }

  _rec(p) {
    let r = this.pads.get(p.index);
    if (!r || r.id !== p.id) {
      r = { id: p.id, prev: new Uint8Array(Math.max(32, p.buttons?.length || 0)), armed: [false, false], seen: false, dpad: 0 };
      this.pads.set(p.index, r);
    }
    return r;
  }

  poll(input, dt = 1 / 120) {
    const list = this._list();
    this.connected = list.length > 0;
    const acc = this._acc || (this._acc = Object.create(null));
    for (const a of ACTIONS) acc[a] = 0;
    let lx = 0, ly = 0, rt = 0, lt = 0, any = false;
    for (const p of list) {
      const rec = this._rec(p);
      const std = p.mapping === 'standard';
      const map = std ? STANDARD : GENERIC;
      const b = p.buttons || [];
      const axes = p.axes || [];
      const down = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
      let used = false;
      // per-pad button edges: activity (rumble target, first input)
      const n = Math.min(b.length, rec.prev.length);
      for (let i = 0; i < n; i++) {
        const d = down(i) ? 1 : 0;
        if (d && !rec.prev[i]) used = true;
        rec.prev[i] = d;
      }
      for (const a of ACTIONS) {
        const ids = map[a];
        for (let j = 0; j < ids.length; j++) if (down(ids[j])) { acc[a] = 1; break; }
      }
      if (!std) {
        const h = genericDpad(axes);
        if (h) {
          if (h[0] < 0) acc.left = 1;
          if (h[0] > 0) acc.right = 1;
          if (h[1] < 0) acc.up = 1;
          if (h[1] > 0) acc.down = 1;
        }
        const code = h ? 1 + (h[0] + 1) * 3 + (h[1] + 1) : 0;
        if (code && code !== rec.dpad) used = true;
        rec.dpad = code;
      }
      // left stick (axes 0/1); an axis only counts once it has been near rest
      for (let k = 0; k < 2; k++) if (!rec.armed[k] && Math.abs(axes[k] || 0) < ARM) rec.armed[k] = true;
      const x = rec.armed[0] ? dz(axes[0] || 0) : 0;
      const y = rec.armed[1] ? dz(axes[1] || 0) : 0;
      if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) used = true;
      lx += x;
      ly += y;
      if (std) {
        rt = Math.max(rt, b[BTN.RT] ? b[BTN.RT].value : 0);
        lt = Math.max(lt, b[BTN.LT] ? b[BTN.LT].value : 0);
      }
      if (used) {
        any = true;
        this.lastIndex = p.index;
        if (!rec.seen) {
          rec.seen = true;
          try {
            this.onFirstInput?.(p);
          } catch (e) {
            console.warn('[gamepad] onFirstInput', e);
          }
        }
      }
    }
    lx = clamp1(lx);
    ly = clamp1(ly);
    this.stick.x = lx;
    this.stick.y = ly;
    // merged edges → unified input
    const st = this.state;
    for (const a of ACTIONS) {
      const d = acc[a];
      if (d === st[a]) continue;
      st[a] = d;
      any = true;
      if (MOMENTARY[a]) {
        if (d) input.press(a);
      } else input.setHold(a, !!d);
    }
    // stick-flick barrel roll (settings.stickRoll; LB/RB always roll)
    const snap = this.snap.update(this.stickRoll ? lx : 0, dt);
    if (snap) input.press(snap < 0 ? 'rollL' : 'rollR');
    if (lx || ly) {
      input.moveX += lx;
      input.moveY += -ly;
      any = true;
    }
    this._navigate(input, lx, ly, dt);
    if (rt > 0.3) input.throttleAxis = 1;
    else if (lt > 0.3) input.throttleAxis = -1;
    if (any) input.lastDevice = 'gamepad';
  }

  /** Stick → up/down/left/right presses with key repeat (menus, hangar, panels). */
  _navigate(input, lx, ly, dt) {
    const nav = this._nav;
    const ax = Math.abs(lx), ay = Math.abs(ly);
    let dir = '';
    // keep the current direction until the stick falls back under NAV_OFF
    if (nav.dir) {
      const v = nav.dir === 'left' ? -lx : nav.dir === 'right' ? lx : nav.dir === 'up' ? -ly : ly;
      if (v >= NAV_OFF) dir = nav.dir;
    }
    if (!dir && Math.max(ax, ay) >= NAV_ON) dir = ax >= ay ? (lx < 0 ? 'left' : 'right') : ly < 0 ? 'up' : 'down';
    if (dir !== nav.dir) {
      nav.dir = dir;
      nav.t = NAV_DELAY;
      if (dir) input.press(dir);
      return;
    }
    if (!dir) return;
    nav.t -= dt;
    if (nav.t <= 0) {
      nav.t += NAV_REPEAT;
      input.press(dir);
    }
  }

  /** The pad used most recently (rumble target), or the first connected one. */
  activePad() {
    const list = this._list();
    for (const p of list) if (p.index === this.lastIndex) return p;
    return list[0] || null;
  }

  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const pad = this.activePad();
    const act = pad && pad.vibrationActuator;
    if (act && act.playEffect) {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {});
    }
  }
}
