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
import { Autopilot } from './input/autopilot.js';
import { createRenderer } from './render/renderer.js';
import { PostFX } from './render/composer.js';
import { CameraRig } from './render/cameraRig.js';
import { World } from './world/world.js';
import { WorldUniforms } from './render/worldUniforms.js';
import { loadSettings, saveSettings, loadProgress } from './core/save.js';
import { HUD } from './ui/hud.js';
import { Scoring } from './sim/scoring.js';
import { setLang } from './ui/i18n.js';
import { loadAudio } from './render/assets.js';
import { Menu, overlay } from './ui/menu.js';
import { createOptionsMenu } from './ui/screens/options.js';
import { t } from './ui/i18n.js';
import { Bench } from './core/bench.js';

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
    this.progress = loadProgress();
    this.state = null;
    this.audio = null;
    this.session = this.newSession();
    this.nextState = null;
    this.ready = false;
    this.frameCount = 0;
  }

  async init() {
    const renderer = (this.renderer = createRenderer(this.canvas));
    const gl = renderer.getContext();
    this.gpu = gpuInfo(gl);
    this.detectedPreset = detectPreset(gl);
    const presetName = params.quality || this.settings.quality || this.detectedPreset;
    this.preset = PRESETS[presetName] || PRESETS.high;
    this.settings.quality = this.settings.quality || null;

    this.rig = new CameraRig(innerWidth / innerHeight);
    this.world = new World(renderer, this.preset, this.rig.camera);

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
    if (params.autopilot || params.bench) this.autopilot = this.input.addSource(new Autopilot(this));
    if (params.bench) this.bench = new Bench(this, params.benchSeconds);

    this.dynres = new DynamicResolution(this.preset, this.settings.fpsCap || 60);
    this.dynres.enabled = !params.fixed && !params.frames;
    this.dynres.onChange = () => this.resize();
    this.perf = new PerfOverlay(this.uiRoot);
    if (params.debug) this.perf.toggle(true);
    this.hud = new HUD(this.hudCanvas);
    this.hud.colorblind = !!this.settings.colorblindReticle;
    this.hud.lowFx = this.preset.name === 'low';
    setLang(params.lang || this.settings.lang || 'en');
    this.rig.shakeScale = this.settings.shake ?? 1;
    this._initAudio();

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
      if (params.frames && this.activeFrames === params.frames) this.markReady();
      this.bench?.frame(realDt);
    };

    this.applyFpsCap();
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.state?.onHidden?.();
    });
    this.resize();

    window.__game = this;
  }

  newSession() {
    return {
      jet: params.jet || this.settings.jet || 'fa18e',
      scheme: params.scheme || this.settings.scheme || 'standard',
      lives: 3,
      continues: 0,
      scoring: new Scoring(),
      get stars() {
        return this.scoring.stars;
      },
      climaxGauge: 0.35,
      eoCleared: {},
      stageIndex: 0,
      // route progress (stage ids): route = visited/chosen nodes, node = current stage id, stageNo = 1-based count
      route: [],
      node: null,
      stageNo: 1,
      results: [],
      stats: { missilesFired: 0, climaxUsed: 0 }
    };
  }

  async _initAudio() {
    const mod = await loadAudio();
    if (!mod?.AudioEngine) return;
    const audio = new mod.AudioEngine();
    this.audio = audio;
    const s = this.settings;
    const start = async () => {
      try {
        await audio.init();
        audio.setVolumes({ master: params.mute ? 0 : s.volMaster, sfx: s.volSfx, music: s.volMusic, voice: s.volVoice });
        this.events.emit('audioReady', audio);
      } catch (e) {
        console.warn('audio init failed', e);
      }
    };
    const unlock = () => {
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
      removeEventListener('gamepadconnected', unlock);
      start();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    addEventListener('gamepadconnected', unlock);
  }

  setLoading(frac, label) {
    const el = document.getElementById('boot');
    if (!el) return;
    const fill = el.querySelector('.boot-fill');
    const st = el.querySelector('.boot-status');
    if (fill) fill.style.width = `${Math.round(frac * 100)}%`;
    if (st && label) st.textContent = label;
    if (frac >= 1) setTimeout(() => el.classList.add('hidden'), 250);
    else el.classList.remove('hidden');
  }

  showPause(on) {
    this.events.emit('pause', on);
    if (on && !this.pauseUI) {
      const root = overlay('fade-in');
      root.style.background = 'rgba(2,6,14,0.45)';
      const resume = () => this.state?.togglePause?.();
      const menu = new Menu({
        game: this,
        className: 'menu-main',
        title: t('menu.paused'),
        onBack: resume,
        items: [
          { label: t('menu.resume'), onSelect: resume },
          { label: t('menu.restart'), onSelect: () => { resume(); this.flow?.restartStage(); } },
          {
            label: t('menu.options'),
            onSelect: () => {
              menu.el.classList.add('hidden');
              this.pauseUI.sub = createOptionsMenu(this, () => {
                this.pauseUI.sub.destroy();
                this.pauseUI.sub = null;
                menu.el.classList.remove('hidden');
              }).mount(root);
            }
          },
          { label: t('menu.quit'), onSelect: () => { resume(); this.flow?.toTitle(); } }
        ]
      }).mount(root);
      this.uiRoot.appendChild(root);
      this.pauseUI = { root, menu, sub: null };
    } else if (!on && this.pauseUI) {
      this.pauseUI.root.remove();
      this.pauseUI = null;
    }
  }

  onStageComplete(results) {
    this.session.results.push(results);
    this.events.emit('stageComplete', results);
    this.flow?.onStageComplete(results);
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
    if (this.pauseUI) {
      (this.pauseUI.sub || this.pauseUI.menu).update(this.input);
      this.input.consumeEdges();
    }
    if (this.state && !this.state.loading) this.state.update(dt, wdt);
    this.input.endStep();
    if (this.audio?.isReady) this._audioListener();
  }

  render(alpha, realDt) {
    this.frameCount++;
    if (this.nextState && !this._swapping) {
      this._swapping = true;
      this._swapState().finally(() => (this._swapping = false));
    }
    const r = this.renderer;
    r.info.reset();
    if (this.audio?.isReady) this.audio.update(realDt);
    if (this.state && !this.state.loading) {
      this.state.render(alpha, realDt);
      this.activeFrames = (this.activeFrames || 0) + 1;
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
      extra: (this.perf.visible && this.state && !this.state.loading && this.state.debugText?.()) || ''
    });
  }

  /** Render the world through the post chain with the rig camera. */
  renderWorld(realDt) {
    const cam = this.rig.camera;
    this.post.update(cam, WorldUniforms.uSunDir.value, realDt, { flareIntensity: this.world.env?.flare ?? 1 });
    this.post.render(realDt);
  }

  _audioListener() {
    const cam = this.rig.camera;
    const a = this.audio;
    this._fw ??= cam.position.clone();
    this._upv ??= cam.position.clone();
    this._vel ??= cam.position.clone().set(0, 0, 0);
    this._fw.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this._upv.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const p = this.state?.player;
    if (p) this._vel.copy(p.velocity);
    a.setListener(cam.position, this._fw, this._upv, this._vel);
    if (p) a.setEngine({ throttle: (p.throttle + 1) / 2, afterburner: p.afterburner, speed: p.speed, gLoad: p.gLoad });
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

  applyFpsCap() {
    const cap = this.settings.fpsCap || 0;
    this.loop.minFrameMs = cap ? 1000 / cap - 1.5 : 0;
    this.dynres.setTargetFps(cap || 60);
  }

  setQuality(name) {
    const p = PRESETS[name];
    if (!p) return;
    this.preset = p;
    this.settings.quality = name;
    saveSettings(this.settings);
    this.world.setQuality(p);
    this.dynres.setPreset(p);
    this.post.build(p);
    this.hud.lowFx = p.name === 'low';
    this.resize();
    this.events.emit('quality', p);
  }
}
