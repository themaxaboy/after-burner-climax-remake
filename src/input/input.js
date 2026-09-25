import { clamp } from '../core/math.js';

// Unified action state from keyboard, mouse, gamepad, touch and tilt.
//   axes:  moveX, moveY in [-1, 1]  (+Y = climb unless invertY)
//   holds: missile, climax, fast, slow, fire, flare
//   edges: *Pressed flags set for one sim step (consumed by `endStep`)
export const ACTIONS = ['missile', 'climax', 'fast', 'slow', 'fire', 'flare', 'rollL', 'rollR', 'pause', 'confirm', 'back', 'up', 'down', 'left', 'right', 'debug'];

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyJ: 'missile', Space: 'missile', KeyZ: 'missile',
  KeyK: 'climax', KeyX: 'climax',
  ShiftLeft: 'fast', ShiftRight: 'fast',
  ControlLeft: 'slow', ControlRight: 'slow', KeyC: 'slow',
  KeyL: 'fire',
  KeyF: 'flare',
  KeyQ: 'rollL', KeyE: 'rollR',
  Escape: 'pause', KeyP: 'pause',
  Enter: 'confirm', NumpadEnter: 'confirm',
  Backspace: 'back',
  F3: 'debug', Backquote: 'debug'
};

/**
 * Stick-snap roll gesture (arcade stick): the stick goes from one side
 * (|x| ≥ thresh) to the other within `window` seconds. `update` returns the
 * snap direction (-1 / 1) on the step it happens, else 0.
 */
export class SnapDetector {
  constructor(window = 0.18, thresh = 0.8) {
    this.window = window;
    this.thresh = thresh;
    this.side = 0; // last extreme visited
    this.t = 1e9; // s since the stick left that extreme
    this.cool = 0;
  }

  update(x, dt) {
    this.t += dt;
    if (this.cool > 0) this.cool -= dt;
    const s = x >= this.thresh ? 1 : x <= -this.thresh ? -1 : 0;
    if (s === 0) return 0;
    let out = 0;
    if (this.side === -s && this.t <= this.window && this.cool <= 0) {
      out = s;
      this.cool = 0.3;
    }
    this.side = s;
    this.t = 0;
    return out;
  }
}

export class Input {
  constructor(target = window) {
    this.target = target;
    this.moveX = 0;
    this.moveY = 0;
    this.throttleAxis = 0; // -1 slow, 0 neutral, 1 fast (analog sources)
    this.hold = Object.create(null);
    this.pressed = Object.create(null);
    this.released = Object.create(null);
    for (const a of ACTIONS) {
      this.hold[a] = false;
      this.pressed[a] = false;
      this.released[a] = false;
    }
    this._keys = new Set();
    this._sources = []; // extra providers: {poll(input)} (gamepad, touch, tilt, autopilot)
    this.invertY = false;
    this.lastDevice = 'keyboard';
    this.enabled = true;
    this._tapTimes = { left: -1, right: -1 };
    this._now = 0;
    this.mouse = { x: 0, y: 0, active: false, locked: false, dx: 0, dy: 0 };
    this._bind();
  }

  addSource(src) {
    this._sources.push(src);
    return src;
  }

  removeSource(src) {
    const i = this._sources.indexOf(src);
    if (i >= 0) this._sources.splice(i, 1);
  }

  _bind() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (a !== 'debug' && e.code !== 'F5' && e.code !== 'F12') e.preventDefault();
      if (e.repeat) return;
      this.lastDevice = 'keyboard';
      this._keys.add(e.code);
      this._setAction(a, true);
      // double-tap left/right = barrel roll (arcade stick snap)
      if (a === 'left' || a === 'right') {
        const now = performance.now();
        if (now - this._tapTimes[a] < 260) this._pulse(a === 'left' ? 'rollL' : 'rollR');
        this._tapTimes[a] = now;
      }
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this._keys.delete(e.code);
      // only release if no other key maps to the same action
      for (const k of this._keys) if (KEYMAP[k] === a) return;
      this._setAction(a, false);
    });
    window.addEventListener('blur', () => {
      this._keys.clear();
      for (const a of ACTIONS) if (this.hold[a]) this._setAction(a, false);
    });
  }

  _setAction(a, down) {
    if (down && !this.hold[a]) this.pressed[a] = true;
    if (!down && this.hold[a]) this.released[a] = true;
    this.hold[a] = down;
  }

  /** Momentary press (e.g. gestures) — sets pressed for one step. */
  _pulse(a) {
    this.pressed[a] = true;
  }

  press(a) {
    this._pulse(a);
  }

  /** Called at the start of each sim step. */
  poll(dt) {
    this._now += dt;
    let x = 0, y = 0;
    if (this.hold.left) x -= 1;
    if (this.hold.right) x += 1;
    if (this.hold.up) y += 1;
    if (this.hold.down) y -= 1;
    this.moveX = x;
    this.moveY = y;
    this.throttleAxis = this.hold.fast ? 1 : this.hold.slow ? -1 : 0;
    // extra sources may add to / override axes and actions
    for (let i = 0; i < this._sources.length; i++) this._sources[i].poll(this, dt);
    const len = Math.hypot(this.moveX, this.moveY);
    if (len > 1) {
      this.moveX /= len;
      this.moveY /= len;
    }
    this.moveX = clamp(this.moveX, -1, 1);
    this.moveY = clamp(this.moveY, -1, 1) * (this.invertY ? -1 : 1);
    if (!this.enabled) {
      this.moveX = 0;
      this.moveY = 0;
    }
  }

  /** Clears edge flags; call after each sim step. */
  endStep() {
    for (const a of ACTIONS) {
      this.pressed[a] = false;
      this.released[a] = false;
    }
  }

  /** Swallow this step's edges (a menu consumed them). */
  consumeEdges() {
    for (const a of ACTIONS) {
      this.pressed[a] = false;
      this.released[a] = false;
    }
  }

  /** Programmatic hold (used by touch buttons / autopilot). */
  setHold(a, down) {
    this._setAction(a, down);
  }
}
