// Performance overlay (F3 / ` / ?debug=1): FPS, frame time percentiles,
// render scale, draw calls, triangles, programs, JS heap.
export class PerfOverlay {
  constructor(root) {
    this.el = document.createElement('div');
    this.el.className = 'perf-overlay';
    this.el.style.display = 'none';
    root.appendChild(this.el);
    this.visible = false;
    this.times = new Float32Array(240);
    this.i = 0;
    this.n = 0;
    this.acc = 0;
    this.sorted = new Float32Array(240);
  }

  toggle(v = !this.visible) {
    this.visible = v;
    this.el.style.display = v ? '' : 'none';
  }

  push(ms) {
    this.times[this.i] = ms;
    this.i = (this.i + 1) % this.times.length;
    this.n = Math.min(this.n + 1, this.times.length);
  }

  stats() {
    const n = this.n;
    if (!n) return { avg: 0, p50: 0, p95: 0, p99: 0, low1: 0 };
    const s = this.sorted;
    s.set(this.times);
    if (n < s.length) s.fill(Infinity, n);
    s.sort();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += s[i];
    return {
      avg: sum / n,
      p50: s[Math.floor(n * 0.5)],
      p95: s[Math.floor(n * 0.95)],
      p99: s[Math.min(n - 1, Math.floor(n * 0.99))],
      low1: 1000 / s[Math.min(n - 1, Math.floor(n * 0.99))]
    };
  }

  update(dt, info) {
    this.acc += dt;
    if (!this.visible || this.acc < 0.25) return;
    this.acc = 0;
    const st = this.stats();
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB' : 'n/a';
    this.el.textContent =
      `FPS ${(1000 / st.avg).toFixed(0)}  (1% low ${st.low1.toFixed(0)})\n` +
      `frame p50 ${st.p50.toFixed(2)}  p95 ${st.p95.toFixed(2)}  p99 ${st.p99.toFixed(2)} ms\n` +
      `scale ${info.scale.toFixed(2)}  ${info.width}x${info.height}  ${info.preset}\n` +
      `draws ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k  progs ${info.programs}\n` +
      `geo ${info.geometries}  tex ${info.textures}  heap ${mem}\n` +
      (info.extra || '');
  }
}
