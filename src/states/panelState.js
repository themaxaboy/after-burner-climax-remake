import { Matrix4, Vector3 } from 'three';
import { overlay } from '../ui/menu.js';
import { t } from '../ui/i18n.js';
import { renderRouteMap } from '../ui/routeMap.js';
import { formatScore, formatTime } from '../core/math.js';
import { Scoring } from '../sim/scoring.js';
import { saveProgress } from '../core/save.js';
import { ROUTE_GRAPH } from '../stages/routes.js';
import { statusReport } from '../stages/status.js';
import { applyLook } from './showcase.js';
import { JETS } from './hangarState.js';

const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);
const _v = new Vector3();

/**
 * Full-screen information panel over a slowly drifting sky of the given
 * stage environment: results, status report and ending screens. With
 * ?autopilot=1 (tests, demos) panels advance by themselves.
 */
class PanelState {
  constructor(game, env, { music = null, autoAdvance = 2.5 } = {}) {
    this.game = game;
    this.env = env;
    this.music = music;
    this.loading = true;
    this.t = 0;
    this.accept = 0.6; // ignore input briefly to avoid skipping by accident
    this.autoAdvance = autoAdvance;
    this._done = false;
  }

  async enter() {
    const g = this.game;
    ensureFlowCss();
    applyLook(g, this.env);
    g.hud.visible = false;
    g.post.cameraFX.motionEnabled = false;
    this.root = overlay('fade-in');
    this.root.appendChild(this.build());
    this.root.addEventListener('click', () => this.t > this.accept && this._next());
    g.uiRoot.appendChild(this.root);
    if (this.music) g.audio?.music?.play(this.music, { fadeIn: 1.5 });
    g.setLoading?.(1, 'READY');
    this.loading = false;
  }

  build() {
    return document.createElement('div');
  }

  _next() {
    if (this._done) return;
    this._done = true;
    this.next();
  }

  next() {}

  update(dt) {
    this.t += dt;
    const g = this.game;
    const input = g.input;
    if (this.t > this.accept && (input.pressed.confirm || input.pressed.missile || input.pressed.pause)) this._next();
    else if (this.autoAdvance && g.params.autopilot && !g.params.bench && this.t > this.autoAdvance) this._next();
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

/** Short arcade results after every stage. */
export class ResultsState extends PanelState {
  constructor(game, results) {
    super(game, results.stage.env, { music: 'results' });
    this.kind = 'results';
    this.r = results;
    this.accept = 1.2;
  }

  build() {
    const r = this.r;
    const g = this.game;
    const rank = Scoring.rankLetter(r.downRate);
    const stars = '★'.repeat(r.stars) + '☆'.repeat(Math.max(0, 5 - r.stars));
    const eo = r.eo.length ? r.eo.map((e) => (e.ok ? t('res.cleared') : t('res.failed'))).join(' / ') : '—';
    const rows = [
      [t('res.kills'), r.kills],
      [t('res.down'), `${r.downRate.toFixed(1)}%`],
      [t('res.combo'), r.bestCombo],
      [t('res.eo'), eo],
      [t('res.score'), formatScore(r.score)]
    ];
    const no = g.session.stageNo || r.stage.index;
    const route = r.route ? `<div class="res-route">${t('flow.route')} ➜ ${esc(t(`stage.${r.route}.name`))}</div>` : '';
    const el = document.createElement('div');
    el.className = 'panel res-panel';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">
        <div><h2>${t('flow.stage')} ${no} · ${esc(r.stage.name)}</h2><h1>${t('res.clear')}</h1><div class="stars-row">${stars}</div></div>
        <div style="text-align:center"><div class="menu-subtitle" style="margin:0">${t('res.rank')}</div><div class="rank-letter">${rank}</div></div>
      </div>
      <div class="results-grid">${rows.map(([k, v], i) => `<div class="k">${k}</div><div class="v" style="animation-delay:${0.2 + i * 0.14}s">${v}</div>`).join('')}</div>
      ${route}
      <div class="go">${t('menu.continue')} ›</div>`;
    return el;
  }

  next() {
    this.game.flow.afterResults(this.r);
  }
}

/** STATUS REPORT (blue glass): cumulative run figures graded against par; titled MID-GAME RESULT halfway. */
export class StatusReportState extends PanelState {
  constructor(game, { results, env, bonus = false, midGame = false }, onDone) {
    super(game, env, { music: 'results', autoAdvance: 3 });
    this.kind = 'status';
    this.results = results;
    this.bonus = bonus;
    this.midGame = midGame;
    this.onDone = onDone;
    this.accept = 1.0;
  }

  build() {
    const g = this.game;
    const rep = statusReport(this.results, g.session.scoring.total);
    const rows = [
      [t('status.score'), formatScore(rep.score.value).padStart(7, '0'), rep.score.grade],
      [t('status.downed'), `${rep.downed.value}`, rep.downed.grade],
      [t('status.combo'), `${rep.combo.value}`, rep.combo.grade],
      [t('status.time'), formatTime(rep.time.value), rep.time.grade]
    ];
    this.report = rep;
    const el = document.createElement('div');
    el.className = 'st-wrap';
    el.innerHTML = `
      <div class="st-panel">
        <div class="st-head">${t(this.midGame ? 'status.midgame' : 'status.title')}</div>
        ${rows
          .map(
            ([k, v, gr], i) => `
          <div class="st-row" style="animation-delay:${0.15 + i * 0.16}s">
            <span class="st-k">${k}</span><span class="st-v">${v}</span><span class="st-g st-${gr}">${gr}</span>
          </div>`
          )
          .join('')}
        <div class="st-map"></div>
        ${this.bonus ? `<div class="st-bonus">${t('flow.bonus')}</div>` : ''}
        <div class="go">${t('flow.next')} ›</div>
      </div>`;
    renderRouteMap(el.querySelector('.st-map'), ROUTE_GRAPH, g.session, { compact: true });
    return el;
  }

  next() {
    this.onDone?.();
  }
}

export class EndingState extends PanelState {
  constructor(game, env) {
    super(game, env, { music: 'anthem', autoAdvance: 0 });
    this.kind = 'ending';
    this.accept = 2;
  }

  build() {
    const g = this.game;
    const total = g.session.scoring.total;
    // record high score
    const hs = g.progress.highScores || [];
    hs.push({ score: Math.floor(total), jet: g.session.jet, date: new Date().toISOString().slice(0, 10), stars: g.session.scoring.stars, route: (g.session.route || []).join('>') });
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
      <div class="st-map st-map-end"></div>
      <p style="margin-top:18px;font-size:13px;opacity:.7">After Burner Climax Web Remake — fan project built with three.js.<br/>Models, audio and effects generated procedurally · Terrain textures CC0 by Poly Haven.</p>
      <div class="stars-row">${'★'.repeat(g.session.scoring.stars)}</div>
      <div class="go" style="text-align:center">${t('end.thanks')}</div>`;
    renderRouteMap(el.querySelector('.st-map'), ROUTE_GRAPH, g.session, { compact: true });
    return el;
  }

  next() {
    this.game.flow.toTitle();
  }
}

/**
 * "Please Wait" loading screen shown while `stage` loads (replaces the
 * briefing): the chosen jet and paint, the route map with the next stage
 * highlighted, the stage name and a short brief. It stays up until the stage
 * has loaded and at least `minTime` seconds have passed (the stage is held
 * paused meanwhile), or a key / click once loaded.
 */
export function showPleaseWait(game, def, stage, { minTime = 2.2 } = {}) {
  const g = game;
  const s = g.session;
  ensureFlowCss();
  const jet = JETS.find((j) => j.id === s.jet) || JETS[0];
  const sp = jet.name.indexOf(' ');
  const code = sp > 0 ? jet.name.slice(0, sp) : jet.name;
  const model = sp > 0 ? jet.name.slice(sp + 1) : '';
  const scheme = t(`scheme.${s.scheme}`);
  const root = document.createElement('div');
  root.className = 'overlay pw-screen';
  root.innerHTML = `
    <div class="pw-bar"><div class="pw-title">${t('flow.pleaseWait')}<i>.</i><i>.</i><i>.</i></div></div>
    <div class="pw-body">
      <div class="pw-stage">
        <div class="pw-no">${t('flow.stage')} ${s.stageNo || def.index}${def.bonus ? ' · ★' : ''}</div>
        <div class="pw-name">${esc(def.name)}</div>
        <div class="pw-sub">${esc(def.subtitle)}</div>
        <p class="pw-brief">${esc(def.brief)}</p>
      </div>
      <div class="pw-jet">
        ${JET_SVG}
        <div class="pw-code">${esc(code)}</div>
        <div class="pw-model">${esc(model)}</div>
        <div class="pw-paint">${esc(t('flow.paintOf').replace('{scheme}', scheme))}</div>
      </div>
    </div>
    <div class="pw-route"><div class="pw-route-label">${t('flow.route')} <b>➜</b></div><div class="pw-map"></div></div>
    <div class="pw-foot">${t('flow.ready')}</div>`;
  const names = {};
  for (const id of Object.keys(ROUTE_GRAPH.nodes)) if (s.route?.includes(id) || id === def.id) names[id] = t(`stage.${id}.name`);
  renderRouteMap(root.querySelector('.pw-map'), ROUTE_GRAPH, s, { highlight: def.id, label: false, names });
  // on <body>, above the boot/loading screen (#ui is its own stacking context)
  document.body.appendChild(root);
  const t0 = performance.now();
  let loaded = false;
  let done = false;
  const offs = [];
  const cleanup = () => {
    for (const off of offs) off();
    removeEventListener('keydown', onKey);
  };
  const finish = () => {
    if (done) return;
    done = true;
    stage.paused = false;
    root.classList.add('pw-out');
    setTimeout(() => root.remove(), 450);
    cleanup();
  };
  const onKey = (e) => {
    if (loaded && ['Enter', 'Space', 'KeyJ', 'KeyZ'].includes(e.code)) finish();
  };
  offs.push(
    stage.events.on('stageStart', () => {
      loaded = true;
      root.classList.add('pw-ready');
      const left = minTime * 1000 - (performance.now() - t0);
      if (left <= 0) finish();
      else {
        stage.paused = true; // hold the stage behind the panel
        setTimeout(finish, left);
      }
    })
  );
  offs.push(
    stage.events.on('stageExit', () => {
      done = true;
      root.remove();
      cleanup();
    })
  );
  root.addEventListener('click', () => loaded && finish());
  addEventListener('keydown', onKey);
  return root;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Stylised top-view jet silhouette for the Please Wait card.
const JET_SVG = `<svg class="pw-jet-svg" viewBox="0 0 200 120" aria-hidden="true"><path d="M100 4 L108 40 L112 52 L186 86 L186 96 L114 84 L110 100 L128 112 L128 118 L100 112 L72 118 L72 112 L90 100 L86 84 L14 96 L14 86 L88 52 L92 40 Z"/></svg>`;

// Styles for the flow panels (Please Wait, Status Report). Kept here with the
// panels; the HUD stream may move them into ui.css.
const FLOW_CSS = `
.pw-screen { z-index: 11; flex-direction: column; align-items: stretch; justify-content: space-between; color: #0b2a55;
  background: repeating-linear-gradient(60deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 26px),
    repeating-linear-gradient(-60deg, rgba(255,255,255,0.10) 0 2px, transparent 2px 26px),
    linear-gradient(180deg, #f2faff 0%, #cde8ff 48%, #8cc8f5 100%);
  transition: opacity 0.4s ease; animation: fadeIn 0.35s ease both; font-family: var(--font-ui); }
.pw-screen.pw-out { opacity: 0; pointer-events: none; }
.pw-bar { height: 13vh; min-height: 56px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(180deg, #45b4ff 0%, #1570e0 55%, #0b52b8 100%); box-shadow: 0 6px 24px rgba(10,60,140,0.35), inset 0 -2px 0 rgba(255,255,255,0.5); }
.pw-title { font: 900 italic clamp(22px, 4.2vw, 46px) var(--font-display); letter-spacing: 0.06em; color: #fff;
  text-shadow: 0 2px 0 #0a3f8f, 0 0 18px rgba(160,220,255,0.8); }
.pw-title i { font-style: normal; animation: pulse 1s infinite; }
.pw-title i:nth-child(2) { animation-delay: 0.2s; } .pw-title i:nth-child(3) { animation-delay: 0.4s; }
.pw-body { flex: 1; display: grid; grid-template-columns: 1fr 1fr; gap: 4vw; align-items: center; padding: 3vh 6vw; }
.pw-no { font: 800 13px var(--font-display); letter-spacing: 0.4em; color: #1570e0; }
.pw-name { margin-top: 6px; font: 900 italic clamp(24px, 4vw, 52px) var(--font-display); letter-spacing: 0.03em; line-height: 1; color: #0b2a55; }
.pw-sub { margin-top: 8px; font: 700 14px var(--font-ui); letter-spacing: 0.42em; color: #e0457b; }
.pw-brief { margin-top: 16px; max-width: 520px; font: 600 16px/1.5 var(--font-ui); color: rgba(11,42,85,0.85); }
.pw-jet { position: relative; text-align: right; padding: 2vh 0; }
.pw-jet-svg { position: absolute; right: 0; top: 50%; width: min(34vw, 380px); transform: translateY(-50%) rotate(-12deg); fill: rgba(255,255,255,0.55);
  filter: drop-shadow(0 8px 18px rgba(20,90,180,0.25)); z-index: 0; }
.pw-code, .pw-model, .pw-paint { position: relative; z-index: 1; }
.pw-code { font: 800 clamp(16px, 2vw, 24px) var(--font-display); color: #1570e0; letter-spacing: 0.08em; }
.pw-model { font: 900 italic clamp(26px, 4.4vw, 58px) var(--font-display); color: #0b2a55; line-height: 1.05; text-shadow: 0 2px 0 rgba(255,255,255,0.8); }
.pw-paint { margin-top: 6px; font: 700 14px var(--font-ui); letter-spacing: 0.3em; color: #2c5d97; }
.pw-route { display: flex; align-items: center; gap: 18px; margin: 0 4vw 2vh; padding: 10px 20px; border-radius: 10px;
  background: linear-gradient(180deg, rgba(255,255,255,0.75), rgba(220,240,255,0.55)); border: 1px solid rgba(21,112,224,0.35); box-shadow: 0 8px 30px rgba(10,60,140,0.18); }
.pw-route-label { font: 900 italic 18px var(--font-display); color: #e0457b; letter-spacing: 0.1em; white-space: nowrap; }
.pw-route-label b { color: #ffb400; }
.pw-map { flex: 1; min-width: 0; }
.pw-map svg, .st-map svg { width: 100%; height: auto; max-height: 18vh; display: block; }
.pw-foot { margin: 0 4vw 3vh; text-align: right; font: 800 14px var(--font-display); letter-spacing: 0.3em; color: #0b52b8; opacity: 0; }
.pw-screen.pw-ready .pw-foot { opacity: 1; animation: pulse 1.2s infinite; }
@media (max-width: 720px) { .pw-body { grid-template-columns: 1fr; gap: 2vh; } .pw-jet { text-align: left; } .pw-jet-svg { display: none; } }

.st-wrap { width: min(760px, 94vw); perspective: 900px; }
.st-panel { position: relative; padding: 26px 30px 20px; border-radius: 10px; color: #fff; transform: rotateY(-4deg);
  background: linear-gradient(135deg, rgba(70,160,255,0.62) 0%, rgba(24,92,220,0.66) 55%, rgba(12,52,160,0.72) 100%);
  border: 1px solid rgba(190,230,255,0.8); box-shadow: 0 24px 70px rgba(0,20,60,0.45), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 0 40px rgba(140,210,255,0.25);
  backdrop-filter: blur(10px); animation: rise 0.5s ease both; }
.st-head { display: inline-block; margin-bottom: 14px; padding: 4px 16px; border-radius: 3px; font: 900 italic 18px var(--font-display); letter-spacing: 0.18em;
  background: linear-gradient(90deg, #ff5fa2, #d23c8c); box-shadow: 0 2px 10px rgba(210,60,140,0.5); }
.st-row { display: grid; grid-template-columns: 1fr auto 74px; align-items: center; gap: 18px; padding: 9px 12px; margin: 5px 0;
  border-bottom: 1px solid rgba(200,235,255,0.35); animation: rise 0.4s ease both; }
.st-k { font: 800 15px var(--font-ui); letter-spacing: 0.22em; }
.st-k::before { content: '▶ '; color: #7fe0ff; }
.st-v { font: 900 italic clamp(18px, 2.6vw, 28px) var(--font-display); letter-spacing: 0.06em; text-shadow: 0 0 12px rgba(160,220,255,0.7); text-align: right; }
.st-g { text-align: center; font: 900 20px var(--font-display); letter-spacing: 0.04em; }
.st-AAA { color: #ffe066; text-shadow: 0 0 14px rgba(255,210,60,0.9); }
.st-AA { color: #fff3b0; text-shadow: 0 0 10px rgba(255,230,140,0.7); }
.st-A { color: #ffffff; } .st-B { color: #bfe6ff; } .st-C { color: #8fb3d9; }
.st-map { margin-top: 14px; padding: 6px 10px; border-radius: 8px; background: rgba(255,255,255,0.12); }
.st-map-end { max-width: 520px; margin: 18px auto 0; background: rgba(255,255,255,0.06); }
.st-bonus { margin-top: 12px; text-align: center; font: 900 italic 16px var(--font-display); letter-spacing: 0.2em; color: #ffe066; animation: pulse 1s infinite; }
.st-panel .go { margin-top: 14px; text-align: right; font: 700 13px var(--font-display); letter-spacing: 0.3em; color: #ffe08a; animation: pulse 1.4s infinite; cursor: pointer; }
@media (max-height: 520px) {
  .st-panel { padding: 14px 20px 10px; } .st-head { margin-bottom: 6px; font-size: 15px; }
  .st-row { padding: 5px 10px; margin: 2px 0; } .st-map { margin-top: 6px; } .st-map svg { max-height: 14vh; }
  .pw-bar { height: 10vh; min-height: 40px; } .pw-body { padding: 1vh 5vw; } .pw-brief { font-size: 13px; margin-top: 8px; }
}
.res-route { margin-top: 14px; text-align: right; font: 900 italic 15px var(--font-display); letter-spacing: 0.16em; color: #ff8fc0; }
`;

function ensureFlowCss() {
  if (typeof document === 'undefined' || document.getElementById('flow-panels-css')) return;
  const el = document.createElement('style');
  el.id = 'flow-panels-css';
  el.textContent = FLOW_CSS;
  document.head.appendChild(el);
}
