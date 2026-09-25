// Mouse flight: the cursor position (relative to screen centre) steers like a
// virtual stick. LMB = missile, RMB = Climax, wheel = throttle detents.
export class MouseSource {
  constructor(el) {
    this.el = el;
    this.enabled = false;
    this.x = 0;
    this.y = 0;
    this.lastMove = -1e9;
    this._wheel = 0;
    this.throttle = 0;
    this._btn = [false, false, false];
    this._edges = [];
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      this.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      this.lastMove = performance.now();
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this._btn[e.button] = true;
      this._edges.push([e.button, true]);
    });
    window.addEventListener('mouseup', (e) => {
      if (!this.enabled) return;
      if (this._btn[e.button]) this._edges.push([e.button, false]);
      this._btn[e.button] = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.throttle = Math.max(-1, Math.min(1, this.throttle + (e.deltaY < 0 ? 1 : -1)));
      e.preventDefault();
    }, { passive: false });
  }

  poll(input) {
    if (!this.enabled) return;
    for (const [b, d] of this._edges) {
      if (b === 0) input.setHold('missile', d);
      else if (b === 2) input.setHold('climax', d);
      else if (b === 1 && d) input.press('flare');
    }
    this._edges.length = 0;
    if (performance.now() - this.lastMove < 4000 || this._btn[0]) {
      // stick = cursor offset from centre with a small dead zone, full deflection at 60% screen
      const k = 1 / 0.6;
      const dx = Math.abs(this.x) < 0.04 ? 0 : this.x * k;
      const dy = Math.abs(this.y) < 0.04 ? 0 : this.y * k;
      input.moveX += dx;
      input.moveY += dy;
      input.lastDevice = 'mouse';
    }
    if (this.throttle !== 0 && input.throttleAxis === 0) input.throttleAxis = this.throttle;
  }
}
