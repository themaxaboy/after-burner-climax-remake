import { Clock } from './core/clock.js';
import { Loop } from './core/loop.js';
import { params } from './core/params.js';
import { Events } from './core/events.js';
import { PRESETS, detectPreset, DynamicResolution, gpuInfo } from './core/quality.js';
import { PerfOverlay } from './core/debug.js';
import { Input } from './input/input.js';
import { GamepadSource } from './input/gamepad.js';
import { MouseSource } from './input/mouse.js';
import { TouchSource } from './input/touch.js';
import { createRenderer } from './render/renderer.js';
import { PostFX } from './render/composer.js';
import { CameraRig } from './render/cameraRig.js';
import { World } from './world/world.js';
import { WorldUniforms } from './render/worldUniforms.js';
import { loadSettings, saveSettings } from './core/save.js';

/**
 * Top-level orchestrator: owns renderer, post chain, world, input, loop and
 * the active state (title / hangar / stage / results).
 */
export class Game {
  constructor({ canvas, hud, ui }) {
    this.canvas = canvas;
    this.hudCanvas = hud;
    this.uiRoot = ui;
    this.params = params;
    this.events = new Events();
    this.clock = new Clock();
    this.settings = loadSettings();
    this.state = null;
    this.nextState = null;
    this.ready = false;
    this.frameCount = 0;
  }

  async init() {
    const renderer = (this.renderer = createRenderer(this.canvas));
    const gl = renderer.getContext();
    this.gpu = gpuInfo(gl);
    const presetName = params.quality || this.settings.quality || detectPreset(gl);
    this.preset = PRESETS[presetName] || PRESETS.high;
    this.settings.quality = this.settings.quality || null;

    this.rig = new CameraRig(innerWidth / innerHeight);
    this.world = new World(renderer, this.preset);

    if (this.preset.ao) {
      try {
        const { N8AOPostPass } = await import('n8ao');
        PostFX.prototype.N8AOPostPass = N8AOPostPass;
      } catch (e) {
        console.warn('N8AO unavailable', e);
      }
    }
    this.post = new PostFX(renderer, this.world.scene, this.rig.camera, this.preset);

    // input
    this.input = new Input();
    this.input.invertY = !!this.settings.invertY;
    this.gamepad = this.input.addSource(new GamepadSource());
    this.mouse = this.input.addSource(new MouseSource(this.canvas));
    this.mouse.enabled = !!this.settings.mouseFlight;
    this.touch = this.input.addSource(new TouchSource(this.uiRoot));

    this.dynres = new DynamicResolution(this.preset, this.settings.fpsCap || 60);
    this.dynres.enabled = !params.fixed && !params.frames;
    this.dynres.onChange = () => this.resize();
    this.perf = new PerfOverlay(this.uiRoot);
    if (params.debug) this.perf.toggle(true);

    this.loop = new Loop({
      clock: this.clock,
      update: (dt, wdt) => this.update(dt, wdt),
      render: (alpha, realDt) => this.render(alpha, realDt),
      fixedDt: params.fixed || params.frames ? 1 / 60 : 0,
      turbo: params.turbo
    });
    this._lastFrameStart = performance.now();
    this.loop.onFrameEnd = (realDt, now) => {
      const ms = performance.now() - this._lastFrameStart;
      const frameMs = realDt * 1000;
      this.perf.push(frameMs);
      this.dynres.push(frameMs, realDt);
      this._lastFrameStart = performance.now();
      void ms;
      if (params.frames && this.frameCount === params.frames) this.markReady();
    };

    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.state?.onHidden?.();
    });
    this.resize();

    window.__game = this;
  }

  markReady() {
    if (this.ready) return;
    this.ready = true;
    document.body.dataset.ready = '1';
    this.events.emit('ready');
  }

  setState(state) {
    this.nextState = state;
  }

  async _swapState() {
    const next = this.nextState;
    this.nextState = null;
    if (this.state) await this.state.exit?.();
    this.state = next;
    await next.enter?.();
  }

  start() {
    this.loop.start();
  }

  update(dt, wdt) {
    this.input.poll(dt);
    if (this.input.pressed.debug) this.perf.toggle();
    WorldUniforms.uTime.value = this.clock.worldTime;
    WorldUniforms.uRealTime.value = this.clock.realTime;
    if (this.state && !this.state.loading) this.state.update(dt, wdt);
    this.input.endStep();
  }

  render(alpha, realDt) {
    this.frameCount++;
    if (this.nextState && !this._swapping) {
      this._swapping = true;
      this._swapState().finally(() => (this._swapping = false));
    }
    const r = this.renderer;
    r.info.reset();
    if (this.state && !this.state.loading) {
      this.state.render(alpha, realDt);
    }
    const info = r.info;
    this.perf.update(realDt, {
      scale: this.dynres.scale,
      width: r.domElement.width,
      height: r.domElement.height,
      preset: this.preset.name,
      calls: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs ? info.programs.length : 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      extra: this.state?.debugText?.() || ''
    });
  }

  /** Render the world through the post chain with the rig camera. */
  renderWorld(realDt) {
    const cam = this.rig.camera;
    this.post.update(cam, WorldUniforms.uSunDir.value, realDt, { flareIntensity: this.world.env?.flare ?? 1 });
    this.post.render(realDt);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, this.preset.maxDpr);
    const scale = this.dynres ? this.dynres.scale : 1;
    this.renderer.setPixelRatio(dpr * scale);
    this.post?.setSize(w, h);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.rig.setAspect(w / h);
    const hud = this.hudCanvas;
    const hdpr = Math.min(devicePixelRatio || 1, 2);
    hud.width = Math.round(w * hdpr);
    hud.height = Math.round(h * hdpr);
    hud.style.width = w + 'px';
    hud.style.height = h + 'px';
    this.hudScale = hdpr;
    this.state?.onResize?.(w, h);
  }

  setQuality(name) {
    const p = PRESETS[name];
    if (!p) return;
    this.preset = p;
    this.settings.quality = name;
    saveSettings(this.settings);
    this.world.quality = p;
    this.dynres.setPreset(p);
    this.post.build(p);
    this.resize();
    this.events.emit('quality', p);
  }
}
