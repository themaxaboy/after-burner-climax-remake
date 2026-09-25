import { Matrix4, Vector3 } from 'three';
import stage1 from '../stages/stage1_ocean.js';
import { Carrier, CARRIER } from '../world/carrier.js';
import { ShowcasePilot, buildShowcaseJet } from './showcase.js';
import { overlay } from '../ui/menu.js';
import { PlayerJet } from '../render/playerJet.js';
import { saveSettings } from '../core/save.js';
import { t } from '../ui/i18n.js';

const JETS = [
  { id: 'f14d', name: 'F-14D SUPER TOMCAT', role: 'FLEET DEFENCE INTERCEPTOR', crew: '2', speed: 'MACH 2.34', engines: '2 × TURBOFAN', note: 'VARIABLE-SWEEP WINGS' },
  { id: 'fa18e', name: 'F/A-18E SUPER HORNET', role: 'CARRIER STRIKE FIGHTER', crew: '1', speed: 'MACH 1.8', engines: '2 × TURBOFAN', note: 'LEADING-EDGE EXTENSIONS' },
  { id: 'f15e', name: 'F-15E STRIKE EAGLE', role: 'DUAL-ROLE STRIKE FIGHTER', crew: '2', speed: 'MACH 2.5', engines: '2 × TURBOFAN', note: 'CONFORMAL FUEL TANKS · LAND-BASED' }
];
const SCHEMES = ['standard', 'camo', 'special', 'lowvis'];

const _v = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

/** Aircraft + paint selection on the carrier deck at golden hour. */
export class HangarState {
  constructor(game) {
    this.game = game;
    this.kind = 'hangar';
    this.loading = true;
    this.t = 0;
    this.jetIndex = Math.max(0, JETS.findIndex((j) => j.id === game.session.jet));
    this.schemeIndex = Math.max(0, SCHEMES.indexOf(game.session.scheme));
    this.drag = 0;
    this.orbit = 0.6;
  }

  async enter() {
    const g = this.game;
    g.world.configure({ ...stage1.env, elev: 3.5, azim: 60 });
    g.renderer.toneMappingExposure = 0.6;
    g.post.grade.setGrade('goldenHour');
    const built = await buildShowcaseJet(g, JETS[this.jetIndex].id, SCHEMES[this.schemeIndex]);
    this.models = built.models;
    this.fx = built.fx;
    this.jet = built.jet;
    this.carrier = new Carrier({ models: this.models, fx: this.fx, csm: g.world.csm, seed: 5 });
    this.carrier.placeAt(new Vector3(0, 0, 20000), new Vector3(0, 0, -1));
    g.world.scene.add(this.carrier.group);
    this.pilot = new ShowcasePilot();
    this.pilot.gear = 1;
    this.pilot.afterburner = 0.05;
    this._placeJet();
    g.hud.visible = false;
    g.post.cameraFX.motionEnabled = false;
    g.post.gforce.set('uLetterbox', 0.55);
    this._ui();
    try {
      await g.renderer.compileAsync(g.world.scene, g.rig.camera);
    } catch {
      /* ignore */
    }
    g.setLoading?.(1, 'READY');
    g.audio?.music?.play('anthem', { fadeIn: 2 });
    this.loading = false;
  }

  _placeJet() {
    // on the deck, near the island, nose toward the bow
    const p = this.carrier.deckPoint(-4, 40, _v);
    p.y += 2.1;
    this.pilot.setPose(p, new Vector3(0.25, 0, -1), 0);
    this.pilot.snap();
  }

  _ui() {
    const g = this.game;
    this.root = overlay('hangar fade-in');
    this.root.innerHTML = `
      <div class="hangar-title">${t('hangar.title')}</div>
      <div class="hangar-left"><div class="hangar-name"></div><div class="hangar-sub"></div><div class="hangar-stats"></div></div>
      <div class="hangar-right"><div class="menu-subtitle">${t('hangar.scheme')}</div></div>
      <div class="hangar-arrows"><button data-d="-1">‹</button><button data-d="1">›</button></div>
      <div class="hangar-go">${t('hangar.go')}</div>`;
    const right = this.root.querySelector('.hangar-right');
    this.chips = SCHEMES.map((sch, i) => {
      const b = document.createElement('button');
      b.className = 'scheme-chip';
      b.textContent = t(`scheme.${sch}`);
      b.addEventListener('click', () => this._setScheme(i));
      right.appendChild(b);
      return b;
    });
    for (const b of this.root.querySelectorAll('.hangar-arrows button')) b.addEventListener('click', () => this._setJet(this.jetIndex + +b.dataset.d));
    this.root.querySelector('.hangar-go').addEventListener('click', () => this._go());
    // drag to rotate
    this.root.addEventListener('pointerdown', (e) => (this.dragX = e.clientX));
    this.root.addEventListener('pointermove', (e) => {
      if (this.dragX == null) return;
      this.orbit -= (e.clientX - this.dragX) * 0.006;
      this.dragX = e.clientX;
    });
    this._onUp = () => (this.dragX = null);
    addEventListener('pointerup', this._onUp);
    g.uiRoot.appendChild(this.root);
    this._refreshUI();
  }

  _refreshUI() {
    const j = JETS[this.jetIndex];
    this.root.querySelector('.hangar-name').textContent = j.name;
    this.root.querySelector('.hangar-sub').textContent = j.role;
    this.root.querySelector('.hangar-stats').innerHTML = `
      <span>CREW</span><span>${j.crew}</span>
      <span>MAX SPEED</span><span>${j.speed}</span>
      <span>ENGINES</span><span>${j.engines}</span>
      <span>FEATURE</span><span>${j.note}</span>`;
    this.chips.forEach((c, i) => c.classList.toggle('active', i === this.schemeIndex));
  }

  _rebuild() {
    const g = this.game;
    this.jet.dispose();
    this.jet = new PlayerJet({ models: this.models, fx: this.fx, jetId: JETS[this.jetIndex].id, scheme: SCHEMES[this.schemeIndex], csm: g.world.csm });
    g.world.dynamic.add(this.jet.group);
    this._refreshUI();
  }

  _setJet(i) {
    this.jetIndex = (i + JETS.length) % JETS.length;
    this.game.audio?.play('uiMove');
    this._rebuild();
  }

  _setScheme(i) {
    this.schemeIndex = (i + SCHEMES.length) % SCHEMES.length;
    this.game.audio?.play('uiMove');
    this._rebuild();
  }

  _go() {
    const g = this.game;
    g.session.jet = JETS[this.jetIndex].id;
    g.session.scheme = SCHEMES[this.schemeIndex];
    g.settings.jet = g.session.jet;
    g.settings.scheme = g.session.scheme;
    saveSettings(g.settings);
    g.audio?.play('uiSelect');
    g.flow.toBriefing(0);
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    const input = g.input;
    if (input.pressed.left) this._setJet(this.jetIndex - 1);
    if (input.pressed.right) this._setJet(this.jetIndex + 1);
    if (input.pressed.up) this._setScheme(this.schemeIndex - 1);
    if (input.pressed.down) this._setScheme(this.schemeIndex + 1);
    if (input.pressed.confirm || input.pressed.missile) this._go();
    if (input.pressed.back || input.pressed.pause) g.flow.toTitle();
    this.orbit += dt * 0.08;
    this.pilot.afterburner = 0.05;
  }

  render(alpha, realDt) {
    const g = this.game;
    const cam = g.rig.camera;
    this.jet.update(this.pilot, 1, realDt, this.t);
    const jp = this.jet.group.position;
    const R = 19;
    cam.position.set(jp.x + Math.sin(this.orbit) * R, jp.y + 2.2 + Math.sin(this.t * 0.25) * 0.8, jp.z + Math.cos(this.orbit) * R);
    _m.lookAt(cam.position, _v.copy(jp).add(new Vector3(0, 0.6, 0)), _up);
    cam.quaternion.setFromRotationMatrix(_m);
    if (cam.fov !== 42) {
      cam.fov = 42;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.carrier.update(realDt, 0);
    g.world.update(realDt, cam);
    this.fx.update(realDt, g.clock.worldTime, cam);
    g.renderWorld(realDt);
    g.hud.draw(realDt, null, g.hudScale);
  }

  exit() {
    const g = this.game;
    removeEventListener('pointerup', this._onUp);
    this.root?.remove();
    this.jet.dispose();
    this.carrier.dispose();
    this.fx.dispose?.();
    g.hud.visible = true;
    g.post.cameraFX.motionEnabled = !!g.preset.motionBlur;
    g.post.gforce.set('uLetterbox', 0);
    g.rig.camera.fov = 62;
    g.rig.camera.updateProjectionMatrix();
  }
}

export { CARRIER };
