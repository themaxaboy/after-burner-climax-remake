import { SnapDetector } from './input.js';

// Standard-mapping gamepad provider.
//   LS: move   A: missile (hold: ripple)   B/X: Climax (hold)   RT: fast   LT: slow
//   LB/RB or a stick snap from side to side: barrel roll   Y: flare   Start: pause   D-pad: menu nav
const DEAD = 0.14;
const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const BUTTON_MAP = [
  [BTN.A, 'missile'], [BTN.B, 'climax'], [BTN.X, 'climax'], [BTN.Y, 'flare'],
  [BTN.LB, 'rollL'], [BTN.RB, 'rollR'], [BTN.RT, 'fast'], [BTN.LT, 'slow'],
  [BTN.START, 'pause'], [BTN.UP, 'up'], [BTN.DOWN, 'down'], [BTN.LEFT, 'left'], [BTN.RIGHT, 'right']
];

function dz(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * (a - DEAD) / (1 - DEAD);
}

export class GamepadSource {
  constructor() {
    this.prev = new Uint8Array(17);
    this.index = -1;
    this.connected = false;
    this.snap = new SnapDetector(0.18, 0.8);
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        this.index = e.gamepad.index;
        this.connected = true;
      });
      window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad.index === this.index) {
          this.index = -1;
          this.connected = false;
        }
      });
    }
  }

  _pad() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.index >= 0 && pads[this.index]) return pads[this.index];
    for (const p of pads) if (p && p.connected) { this.index = p.index; return p; }
    return null;
  }

  poll(input, dt = 1 / 120) {
    const pad = this._pad();
    if (!pad) return;
    const lx = dz(pad.axes[0] || 0);
    const ly = dz(pad.axes[1] || 0);
    const b = pad.buttons;
    const down = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
    let any = Math.abs(lx) > 0 || Math.abs(ly) > 0;
    const map = BUTTON_MAP;
    for (let i = 0; i < map.length; i++) {
      const [bi, action] = map[i];
      const d = down(bi) ? 1 : 0;
      if (d !== this.prev[bi]) {
        any = true;
        // roll buttons & menu confirm are momentary
        if (action === 'rollL' || action === 'rollR') {
          if (d) input.press(action);
        } else if (action === 'climax') input.setHold('climax', down(BTN.B) || down(BTN.X));
        else input.setHold(action, !!d);
        if (bi === BTN.A) input.setHold('confirm', !!d);
        if (bi === BTN.B) input.setHold('back', !!d);
        this.prev[bi] = d;
      }
    }
    const snap = this.snap.update(lx, dt);
    if (snap) input.press(snap < 0 ? 'rollL' : 'rollR');
    if (Math.abs(lx) > 0 || Math.abs(ly) > 0) {
      input.moveX += lx;
      input.moveY += -ly;
    }
    const rt = b[BTN.RT] ? b[BTN.RT].value : 0;
    const lt = b[BTN.LT] ? b[BTN.LT].value : 0;
    if (rt > 0.3) input.throttleAxis = 1;
    else if (lt > 0.3) input.throttleAxis = -1;
    if (any) input.lastDevice = 'gamepad';
  }

  rumble(strong = 0.5, weak = 0.5, ms = 120) {
    const pad = this._pad();
    const act = pad && pad.vibrationActuator;
    if (act && act.playEffect) {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
    }
  }
}
