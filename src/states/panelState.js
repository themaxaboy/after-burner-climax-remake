import { Matrix4, Vector3 } from 'three';
import { overlay } from '../ui/menu.js';
import { t } from '../ui/i18n.js';
import { formatScore, formatTime } from '../core/math.js';
import { Scoring } from '../sim/scoring.js';
import { saveProgress } from '../core/save.js';

const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _v = new Vector3();

/**
 * Full-screen information panel over a slowly drifting sky of the given
 * stage environment: briefing, results and ending screens.
 */
class PanelState {
  constructor(game, env, { music = null } = {}) {
    this.game = game;
    this.env = env;
    this.music = music;
    this.loading = true;
    this.t = 0;
    this.accept = 0.6; // ignore input briefly to avoid skipping by accident
  }

  async enter() {
    const g = this.game;
    g.world.configure({ ...this.env });
    g.renderer.toneMappingExposure = this.env.toneExposure ?? 0.6;
    g.post.grade.setGrade(this.env.grade || 'neutral');
    g.hud.visible = false;
    g.post.cameraFX.motionEnabled = false;
    this.root = overlay('fade-in');
    this.root.appendChild(this.build());
    this.root.addEventListener('click', () => this.t > this.accept && this.next());
    g.uiRoot.appendChild(this.root);
    if (this.music) g.audio?.music?.play(this.music, { fadeIn: 1.5 });
    g.setLoading?.(1, 'READY');
    this.loading = false;
  }

  build() {
    return document.createElement('div');
  }

  next() {}

  update(dt) {
    this.t += dt;
    const input = this.game.input;
    if (this.t > this.accept && (input.pressed.confirm || input.pressed.missile || input.pressed.pause)) this.next();
  }

  render(alpha, realDt) {
    const g = this.game;
    const cam = g.rig.camera;
    const y = this.env.ocean ? 90 : this.env.deck ? 1500 : 400;
    cam.position.set(Math.sin(this.t * 0.02) * 300, y, 20000 - this.t * 30);
    _v.set(cam.position.x + Math.sin(this.env.azim * Math.PI / 180) * 1000, y - 40, cam.position.z - Math.cos(this.env.azim * Math.PI / 180) * 1000);
    _m.lookAt(cam.position, _v, _up);
    cam.quaternion.setFromRotationMatrix(_m);
    cam.updateMatrixWorld();
    g.world.update(realDt, cam);
    g.renderWorld(realDt);
    g.hud.draw(realDt, null, g.hudScale);
  }

  exit() {
    this.root?.remove();
    this.game.hud.visible = true;
    this.game.post.cameraFX.motionEnabled = !!this.game.preset.motionBlur;
  }
}

export class BriefingState extends PanelState {
  constructor(game, stageIndex, stageDef) {
    super(game, stageDef.env, { music: 'anthem' });
    this.kind = 'briefing';
    this.stageIndex = stageIndex;
    this.def = stageDef;
  }

  build() {
    const d = this.def;
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `
      <h2>${t('brief.mission')} ${d.index} / 3</h2>
      <h1>${d.name}</h1>
      <h2>${d.subtitle}</h2>
      <p>${t(`brief.${d.id}`)}</p>
      <p style="font-size:13px;opacity:.75">${t('howto.tips')}</p>
      <div class="go">${t('brief.go')} ›</div>`;
    return el;
  }

  next() {
    this.game.flow.toStage(this.stageIndex);
  }
}

export class ResultsState extends PanelState {
  constructor(game, results) {
    super(game, results.stage.env, { music: 'results' });
    this.kind = 'results';
    this.r = results;
    this.accept = 1.2;
  }

  build() {
    const r = this.r;
    const rank = Scoring.rankLetter(r.downRate);
    const stars = '★'.repeat(r.stars) + '☆'.repeat(Math.max(0, 5 - r.stars));
    const eo = r.eo.length ? r.eo.map((e) => (e.ok ? t('res.cleared') : t('res.failed'))).join(' / ') : '—';
    const rows = [
      [t('res.kills'), r.kills],
      [t('res.combo'), r.bestCombo],
      [t('res.time'), formatTime(r.time)],
      [t('res.down'), `${r.downRate.toFixed(1)}%`],
      [t('res.eo'), eo],
      [t('res.score'), formatScore(r.score)],
      [t('res.total'), formatScore(r.total)]
    ];
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">
        <div><h2>${t('ui.stage')} ${r.stage.index} · ${r.stage.name}</h2><h1>${t('res.clear')}</h1><div class="stars-row">${stars}</div></div>
        <div style="text-align:center"><div class="menu-subtitle" style="margin:0">${t('res.rank')}</div><div class="rank-letter">${rank}</div></div>
      </div>
      <div class="results-grid">${rows.map(([k, v], i) => `<div class="k">${k}</div><div class="v" style="animation-delay:${0.25 + i * 0.18}s">${v}</div>`).join('')}</div>
      <div class="go">${t('menu.continue')} ›</div>`;
    return el;
  }

  next() {
    this.game.flow.afterResults(this.r);
  }
}

export class EndingState extends PanelState {
  constructor(game, env) {
    super(game, env, { music: 'anthem' });
    this.kind = 'ending';
    this.accept = 2;
  }

  build() {
    const g = this.game;
    const total = g.session.scoring.total;
    // record high score
    const hs = g.progress.highScores || [];
    hs.push({ score: Math.floor(total), jet: g.session.jet, date: new Date().toISOString().slice(0, 10), stars: g.session.scoring.stars });
    hs.sort((a, b) => b.score - a.score);
    g.progress.highScores = hs.slice(0, 10);
    g.progress.plays = (g.progress.plays || 0) + 1;
    saveProgress(g.progress);
    const best = g.progress.highScores[0]?.score || total;
    const el = document.createElement('div');
    el.className = 'panel';
    el.style.textAlign = 'center';
    el.innerHTML = `
      <h1>${t('end.title')}</h1>
      <h2>${t('end.sub')}</h2>
      <div class="results-grid" style="max-width:420px;margin:22px auto 0">
        <div class="k">${t('end.final')}</div><div class="v">${formatScore(total)}</div>
        <div class="k">HIGH SCORE</div><div class="v" style="animation-delay:.2s">${formatScore(best)}</div>
        <div class="k">CONTINUES</div><div class="v" style="animation-delay:.4s">${g.session.continues}</div>
      </div>
      <p style="margin-top:26px;font-size:13px;opacity:.7">After Burner Climax Web Remake — fan project built with three.js.<br/>Models, audio and effects generated procedurally · Terrain textures CC0 by Poly Haven.</p>
      <div class="stars-row">${'★'.repeat(g.session.scoring.stars)}</div>
      <div class="go" style="text-align:center">${t('end.thanks')}</div>`;
    return el;
  }

  next() {
    this.game.flow.toTitle();
  }
}
