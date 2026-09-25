import { Matrix4, Vector3 } from 'three';
import stage1 from '../stages/stage1_ocean.js';
import { ShowcasePilot, buildShowcaseJet } from './showcase.js';
import { Menu, overlay } from '../ui/menu.js';
import { createOptionsMenu } from '../ui/screens/options.js';
import { t } from '../ui/i18n.js';

const _v = new Vector3();
const _fw = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

/** Title screen: golden-hour flyby behind the logo, main menu. */
export class TitleState {
  constructor(game) {
    this.game = game;
    this.kind = 'title';
    this.loading = true;
    this.t = 0;
  }

  async enter() {
    const g = this.game;
    g.setLoading?.(0.2, 'LOADING');
    g.world.configure({ ...stage1.env, cloudCover: 0.3 });
    g.renderer.toneMappingExposure = stage1.env.toneExposure ?? 0.55;
    g.post.grade.setGrade(stage1.env.grade);
    g.post.bloom.luminanceMaterial.threshold = 1;
    g.post.bloom.intensity = 0.9;
    const { fx, jet } = await buildShowcaseJet(g, g.session.jet, g.session.scheme);
    this.fx = fx;
    this.jet = jet;
    this.pilot = new ShowcasePilot();
    this._pose(0);
    this.pilot.snap();
    g.hud.visible = false;
    g.post.cameraFX.motionEnabled = false;

    this.root = overlay('title-screen fade-in');
    this.root.innerHTML = `
      <div class="logo">AFTER BURNER<small>CLIMAX</small></div>
      <div class="logo-tag">WEB REMAKE · FAN PROJECT</div>
      <div class="press-start">${t(this._touch() ? 'ui.tapToStart' : 'ui.pressStart')}</div>
      <div class="legal">Unofficial fan remake · Not affiliated with or endorsed by SEGA · All models, textures (CC0) and audio are original or procedural</div>`;
    g.uiRoot.appendChild(this.root);
    this.root.addEventListener('click', () => this._openMenu());
    try {
      await g.renderer.compileAsync(g.world.scene, g.rig.camera);
    } catch {
      /* ignore */
    }
    g.setLoading?.(1, 'READY');
    g.audio?.music?.play('title', { fadeIn: 2 });
    this.loading = false;
  }

  _touch() {
    return matchMedia('(pointer: coarse)').matches;
  }

  _openMenu() {
    if (this.menu) return;
    const g = this.game;
    g.audio?.play('uiSelect');
    this.root.querySelector('.press-start')?.classList.add('hidden');
    this.menu = new Menu({
      game: g,
      className: 'menu-main',
      items: [
        { label: t('menu.start'), onSelect: () => g.flow.toHangar() },
        { label: t('menu.options'), onSelect: () => this._options() },
        { label: t('menu.howto'), onSelect: () => this._howto() }
      ]
    }).mount(this.root);
  }

  _options() {
    const g = this.game;
    this.menu.el.classList.add('hidden');
    this.sub = createOptionsMenu(g, () => this._closeSub()).mount(this.root);
  }

  _howto() {
    const g = this.game;
    this.menu.el.classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'panel howto';
    el.innerHTML = `<h1>${t('howto.title')}</h1><p>${t('howto.tips')}</p><p>${t('howto.kb')}</p><p>${t('howto.pad')}</p><p>${t('howto.touch')}</p><div class="go">${t('opt.back')}</div>`;
    el.querySelector('.go').addEventListener('click', () => this._closeSub());
    this.root.appendChild(el);
    this.sub = { el, update: (input) => (input.pressed.confirm || input.pressed.back || input.pressed.pause || input.pressed.missile) && this._closeSub(), destroy: () => el.remove() };
  }

  _closeSub() {
    this.sub?.destroy();
    this.sub = null;
    this.menu?.el.classList.remove('hidden');
  }

  _pose(time) {
    // lazy S-turns over the sea
    const a = time * 0.12;
    const R = 900;
    _v.set(Math.sin(a) * R, 70 + Math.sin(time * 0.5) * 6, 21000 - Math.cos(a) * R - time * 0);
    _fw.set(Math.cos(a), Math.cos(time * 0.5) * 0.02, Math.sin(a));
    this.pilot.setPose(_v, _fw, 0.42 + Math.sin(time * 0.3) * 0.08);
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this._pose(this.t);
    const input = g.input;
    if (this.sub) this.sub.update(input);
    else if (this.menu) this.menu.update(input);
    else if (input.pressed.confirm || input.pressed.missile || input.pressed.pause || input.pressed.climax) this._openMenu();
  }

  render(alpha, realDt) {
    const g = this.game;
    const cam = g.rig.camera;
    this.jet.update(this.pilot, alpha, realDt, this.t);
    // slow orbit chase camera
    const jp = this.jet.group.position;
    const ang = this.t * 0.06 + 2.2;
    cam.position.set(jp.x + Math.sin(ang) * 30, jp.y - 1.5 + Math.sin(this.t * 0.2) * 2, jp.z + Math.cos(ang) * 30);
    // aim above the jet so it sits in the lower third, sunset sky behind the logo
    _m.lookAt(cam.position, _v.copy(jp).add(_fw.set(0, 7.5, 0)), _up);
    cam.quaternion.setFromRotationMatrix(_m);
    if (cam.fov !== 40) {
      cam.fov = 40;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    g.world.update(realDt, cam);
    this.fx.update(realDt, g.clock.worldTime, cam);
    g.renderWorld(realDt);
    g.hud.draw(realDt, null, g.hudScale);
  }

  exit() {
    const g = this.game;
    this.root?.remove();
    g.world.dynamic.remove(this.jet.group);
    this.fx.dispose?.();
    g.hud.visible = true;
    g.post.cameraFX.motionEnabled = !!g.preset.motionBlur;
    g.rig.camera.fov = 62;
    g.rig.camera.updateProjectionMatrix();
  }
}
