// Android-port style touch controls:
//   * floating virtual stick anywhere on the left 60% of the screen
//   * right side: MISSILE (big; hold = ripple at new locks), CLIMAX (press
//     toggles on touch), FLARE buttons; pointerdown/up drive the hold states
//   * right edge: 3-detent throttle slider (SLOW / NORMAL / FAST)
//   * quick horizontal flick of the stick = barrel roll (jink on noRoll stages)
//   * optional tilt steering (DeviceOrientation) with calibration
const STICK_RADIUS = 64;

export class TouchSource {
  constructor(root) {
    this.root = root;
    this.enabled = false;
    this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, lastX: 0, lastT: 0 };
    this.throttle = 0;
    this.buttons = new Map(); // action -> pointerId
    this.tilt = { enabled: false, beta0: null, gamma0: null, x: 0, y: 0 };
    this._rolls = [];
    this.el = null;
    this._build();
  }

  static isTouchDevice() {
    return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'touch-layer';
    el.innerHTML = `
      <div class="touch-stick-zone"></div>
      <div class="touch-stick"><div class="touch-stick-knob"></div></div>
      <div class="touch-throttle" data-throttle>
        <div class="tt-label tt-fast">FAST</div>
        <div class="tt-track"><div class="tt-knob"></div></div>
        <div class="tt-label tt-slow">SLOW</div>
      </div>
      <button class="touch-btn touch-missile" data-action="missile">MISSILE</button>
      <button class="touch-btn touch-climax" data-action="climax">CLIMAX</button>
      <button class="touch-btn touch-flare" data-action="flare">FLARE</button>
      <button class="touch-btn touch-pause" data-action="pause">II</button>`;
    this.root.appendChild(el);
    this.el = el;
    this.stickEl = el.querySelector('.touch-stick');
    this.knobEl = el.querySelector('.touch-stick-knob');
    this.ttEl = el.querySelector('.touch-throttle');
    this.ttKnob = el.querySelector('.tt-knob');
    const zone = el.querySelector('.touch-stick-zone');

    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return;
      zone.setPointerCapture(e.pointerId);
      const s = this.stick;
      s.id = e.pointerId;
      s.ox = e.clientX;
      s.oy = e.clientY;
      s.x = s.y = 0;
      s.lastX = 0;
      s.lastT = performance.now();
      this.stickEl.style.transform = `translate(${e.clientX - STICK_RADIUS}px, ${e.clientY - STICK_RADIUS}px)`;
      this.stickEl.classList.add('active');
      this.knobEl.style.transform = 'translate(0px, 0px)';
    });
    zone.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (e.pointerId !== s.id) return;
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx *= STICK_RADIUS / len;
        dy *= STICK_RADIUS / len;
      }
      s.x = dx / STICK_RADIUS;
      s.y = -dy / STICK_RADIUS;
      this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
      // flick detection: full deflection reversal within 180 ms
      const now = performance.now();
      if (Math.abs(s.x) > 0.85 && Math.sign(s.x) !== Math.sign(s.lastX) && Math.abs(s.lastX) > 0.85 && now - s.lastT < 180) {
        this._rolls.push(s.x > 0 ? 'rollR' : 'rollL');
      }
      if (Math.abs(s.x) > 0.85) {
        s.lastX = s.x;
        s.lastT = now;
      }
    });
    const endStick = (e) => {
      const s = this.stick;
      if (e.pointerId !== s.id) return;
      s.id = -1;
      s.x = s.y = 0;
      this.stickEl.classList.remove('active');
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    for (const btn of el.querySelectorAll('.touch-btn')) {
      const action = btn.dataset.action;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        this.buttons.set(action, e.pointerId);
        btn.classList.add('down');
        this._pending.push([action, true]);
        if (navigator.vibrate) navigator.vibrate(8);
      });
      const up = (e) => {
        if (this.buttons.get(action) !== e.pointerId) return;
        this.buttons.delete(action);
        btn.classList.remove('down');
        this._pending.push([action, false]);
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    }

    const setThrottleFromY = (clientY) => {
      const r = this.ttEl.getBoundingClientRect();
      const t = 1 - (clientY - r.top) / r.height; // 0 bottom .. 1 top
      this.throttle = t > 0.66 ? 1 : t < 0.33 ? -1 : 0;
      this._updateThrottleKnob();
    };
    this.ttEl.addEventListener('pointerdown', (e) => {
      this.ttEl.setPointerCapture(e.pointerId);
      this._ttId = e.pointerId;
      setThrottleFromY(e.clientY);
    });
    this.ttEl.addEventListener('pointermove', (e) => {
      if (e.pointerId === this._ttId) setThrottleFromY(e.clientY);
    });
    const ttEnd = (e) => {
      if (e.pointerId !== this._ttId) return;
      this._ttId = -1;
    };
    this.ttEl.addEventListener('pointerup', ttEnd);
    this.ttEl.addEventListener('pointercancel', ttEnd);
    this._pending = [];
    this._updateThrottleKnob();
    this.setVisible(false);
  }

  _updateThrottleKnob() {
    const pct = this.throttle === 1 ? 12 : this.throttle === -1 ? 88 : 50;
    this.ttKnob.style.top = `${pct}%`;
    this.ttEl.dataset.state = this.throttle === 1 ? 'fast' : this.throttle === -1 ? 'slow' : 'normal';
  }

  setVisible(v) {
    this.enabled = v;
    this.el.style.display = v ? '' : 'none';
  }

  async enableTilt() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      }
    } catch {
      return false;
    }
    this.tilt.enabled = true;
    this.tilt.beta0 = null;
    if (!this._tiltBound) {
      this._tiltBound = true;
      window.addEventListener('deviceorientation', (e) => {
        if (!this.tilt.enabled || e.beta == null) return;
        const landscape = Math.abs(window.orientation || screen.orientation?.angle || 0) === 90;
        const pitch = landscape ? e.gamma : e.beta;
        const roll = landscape ? e.beta * Math.sign(window.orientation || screen.orientation?.angle || 90) : e.gamma;
        if (this.tilt.beta0 == null) {
          this.tilt.beta0 = pitch;
          this.tilt.gamma0 = roll;
        }
        const k = 1 / 22; // full deflection at 22 degrees
        this.tilt.x = Math.max(-1, Math.min(1, (roll - this.tilt.gamma0) * k));
        this.tilt.y = Math.max(-1, Math.min(1, -(pitch - this.tilt.beta0) * k));
      });
    }
    return true;
  }

  disableTilt() {
    this.tilt.enabled = false;
  }

  poll(input) {
    if (!this.enabled) return;
    for (const [a, d] of this._pending) {
      if (a === 'pause' || a === 'flare') {
        if (d) input.press(a);
      } else input.setHold(a, d);
    }
    this._pending.length = 0;
    for (const r of this._rolls) input.press(r);
    this._rolls.length = 0;
    const s = this.stick;
    if (s.id !== -1) {
      input.moveX += s.x;
      input.moveY += s.y;
      input.lastDevice = 'touch';
    } else if (this.tilt.enabled) {
      input.moveX += this.tilt.x;
      input.moveY += this.tilt.y;
    }
    if (this.throttle !== 0) input.throttleAxis = this.throttle;
  }
}
