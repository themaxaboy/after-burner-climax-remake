// ?bench=1 — deterministic 90 s autopilot flythrough of stage 1 that reports
// frame-time statistics for real hardware (SwiftShader cannot measure FPS).
export class Bench {
  constructor(game, seconds = 90) {
    this.game = game;
    this.seconds = seconds;
    this.times = [];
    this.t = 0;
    this.started = false;
    this.done = false;
    this.maxCalls = 0;
    this.maxTris = 0;
    this.programs0 = 0;
  }

  frame(realDt) {
    const g = this.game;
    if (this.done || !g.state || g.state.loading || !g.state.player) return;
    if (!this.started) {
      this.started = true;
      this.programs0 = g.renderer.info.programs?.length || 0;
      this.t = -2; // settle
      return;
    }
    this.t += realDt;
    if (this.t < 0) return;
    this.times.push(realDt * 1000);
    const info = g.renderer.info.render;
    this.maxCalls = Math.max(this.maxCalls, info.calls);
    this.maxTris = Math.max(this.maxTris, info.triangles);
    if (this.t >= this.seconds) this.finish();
  }

  finish() {
    this.done = true;
    const g = this.game;
    const a = this.times.slice().sort((x, y) => x - y);
    const n = a.length;
    const pct = (p) => a[Math.min(n - 1, Math.floor(n * p))];
    const avg = a.reduce((s, v) => s + v, 0) / n;
    const worst1 = a.slice(Math.floor(n * 0.99));
    const low1 = 1000 / (worst1.reduce((s, v) => s + v, 0) / Math.max(1, worst1.length));
    const res = {
      preset: g.preset.name,
      gpu: g.gpu.renderer,
      resolution: `${g.renderer.domElement.width}x${g.renderer.domElement.height}`,
      frames: n,
      avgFps: +(1000 / avg).toFixed(1),
      onePercentLowFps: +low1.toFixed(1),
      p50ms: +pct(0.5).toFixed(2),
      p95ms: +pct(0.95).toFixed(2),
      p99ms: +pct(0.99).toFixed(2),
      maxDrawCalls: this.maxCalls,
      maxTriangles: this.maxTris,
      shaderPrograms: g.renderer.info.programs?.length || 0,
      programsCompiledDuringRun: (g.renderer.info.programs?.length || 0) - this.programs0,
      finalRenderScale: +g.dynres.scale.toFixed(2),
      jsHeapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(0) : null
    };
    window.__bench = res;
    console.log('[bench]', JSON.stringify(res));
    const el = document.createElement('div');
    el.className = 'overlay fade-in';
    el.innerHTML = `<div class="panel"><h2>BENCHMARK · ${res.preset.toUpperCase()}</h2><h1>${res.avgFps} FPS</h1>
      <div class="results-grid">${Object.entries(res).map(([k, v]) => `<div class="k">${k}</div><div class="v" style="opacity:1;animation:none">${v}</div>`).join('')}</div>
      <p style="font-size:12px;opacity:.7">Copy with: copy(window.__bench) in the dev console.</p></div>`;
    g.uiRoot.appendChild(el);
    document.body.dataset.bench = '1';
  }
}
