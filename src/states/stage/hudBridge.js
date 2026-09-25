import { Vector3 } from 'three';
import { projectPoint } from '../../sim/lockon.js';
import { clamp } from '../../core/math.js';
import { loadModels } from '../../render/assets.js';
import { t } from '../../ui/i18n.js';

const _s = new Vector3();

/**
 * Builds the HUD snapshot (`hudState` v2, see docs/overhaul/CONTRACTS.md)
 * from the stage's systems every rendered frame and hands it to the HUD.
 * Also turns a few stage events into HUD call-outs (CLIMAX, EVADED, ALL DOWN).
 */
export class HudBridge {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.hud = stage.game.hud;
    this.state = makeHudState();
    this._salvo = new Set(); // enemy ids fired at by the last Climax salvo
    this._salvoT = 0;
    this._jetId = null;
    this._jets = null; // PLAYER_JETS, from the (already loaded) lazy model module
    loadModels().then((m) => (this._jets = m?.PLAYER_JETS || []), () => (this._jets = []));
    const ev = stage.events;
    ev.on('evade', () => this.hud.callout(t('hud.evaded'), { variant: 'green', dur: 1.3, size: 40 }));
    ev.on('climax', (e) => {
      if (e.phase === 'start') this.hud.callout(t('hud.climaxCallout'), { variant: 'cyan', dur: 1.4, size: 70, y: 0.2 });
      else if (e.phase === 'end') this._trackSalvo(e.salvo || 0);
      else if (e.phase === 'allDown') this._allDown();
    });
    ev.on('kill', (e) => {
      if (this._salvo.size && this._salvo.delete(e.e.id) && this._salvo.size === 0) this._allDown();
    });
    ev.on('escape', (e) => {
      if (this._salvo.has(e.e.id)) this._salvo.clear();
    });
  }

  _trackSalvo(n) {
    this._salvo.clear();
    const list = this.stage.combat?.salvo;
    if (n < 3 || !list) return;
    for (const it of list) {
      const e = it?.e || it;
      if (e && e.id != null) this._salvo.add(e.id);
    }
    this._salvoT = 6;
  }

  _allDown() {
    this._salvo.clear();
    this.hud.callout(t('hud.allDown'), { variant: 'gold', dur: 2.2 });
  }

  /** Score popup at a world position (px offset dy in CSS-ish units). */
  popupAtWorld(pos, text, color, dy = 0) {
    const g = this.game;
    if (!projectPoint(g.rig.camera, pos, _s)) return;
    const W = g.hudCanvas.width, H = g.hudCanvas.height;
    this.hud.popup((_s.x * 0.5 + 0.5) * W, (-_s.y * 0.5 + 0.5) * H + dy * (g.hudScale || 1), text, color);
  }

  /** Popup at a screen fraction (0..1). */
  popupAtScreen(fx, fy, text, color) {
    const g = this.game;
    this.hud.popup(g.hudCanvas.width * fx, g.hudCanvas.height * fy, text, color);
  }

  update(realDt) {
    const st = this.stage;
    const g = this.game;
    const s = this.state;
    const p = st.player;
    const logic = st.stageLogic;
    const logicHud = logic?.hud;
    const lockon = st.lockon;
    const climax = st.climax;
    const stock = st.stock;
    if (this._salvoT > 0 && (this._salvoT -= realDt) <= 0) this._salvo.clear();
    s.showCombatHud = !st.dead && !st.finished && !(logicHud && logicHud.hideCombat);
    s.showGauges = !(logicHud && logicHud.hideGauges);
    // aiming
    s.reticle = lockon.reticle;
    s.reticleSize = lockon.reticleSize ?? 0.032;
    s.lockRadius = lockon.radius;
    s.lockCap = climax.active ? (lockon.climaxMax ?? 64) : (lockon.max ?? 6);
    s.lockCount = lockon.locks.length;
    s.newLock = lockon.newLocks > 0 ? 1 : Math.max(0, (s.newLock || 0) - realDt * 4);
    s.assistActive = !!st.vulcan.aimTarget;
    s.targets = st.enemies.list;
    // climax
    s.climax = climax.active;
    s.climaxGauge = climax.gauge;
    s.climaxReady = climax.ready ?? (climax.gauge >= 1 && !climax.active);
    s.climaxPhase = climax.phase ?? (climax.active ? 'active' : s.climaxReady ? 'ready' : 'idle');
    s.climaxOnScreen = climax.active ? countOnScreen(st.enemies.list) : 0;
    // threats
    s.threat = st.enemyOps.threat;
    s.enemyBehind = st.enemyOps.enemyBehind();
    // score
    const sc = st.scoring;
    s.score = sc.total;
    s.combo = sc.combo;
    s.comboTimer = sc.comboTimer;
    s.comboWindow = sc.comboWindow ?? 4;
    s.stars = sc.stars;
    s.shining = sc.shining;
    // status
    s.armor = p.armor;
    s.hitFlash = st.hitFlash || 0;
    s.lives = Math.max(0, g.session.lives);
    s.missiles = stock.ready ?? stock.count;
    s.missilesMax = stock.max;
    s.missileReload = stock.reload ?? clamp(stock.acc ?? 0, 0, 1);
    s.missilesInfinite = !!stock.infinite;
    s.throttle = p.throttle;
    s.speed01 = p.baseSpeed > 0 ? clamp((p.speed - p.baseSpeed * 0.72) / (p.baseSpeed * (1.4 - 0.72)), 0, 1) : 0;
    s.speedMark = (1 - 0.72) / (1.4 - 0.72);
    s.speedKt = p.speed * 1.944;
    s.altFt = p.pos.y * 3.28;
    s.gLoad = p.gLoad;
    if (g.session.jet !== this._jetId && this._jets) {
      this._jetId = g.session.jet;
      s.jetName = g.session.jetName || this._jets.find((j) => j.id === this._jetId)?.name || '';
    }
    s.eo = this.hud.eo;
    s.pullUp = st.pullUp && !st.dead;
    s.caution = st.hudExtra.caution || null;
    s.radarWarning = logic?.radarWarning || null;
    s.timer = logicHud?.timer || null;
    s.routeSelect = st.hudExtra.routeSelect || null;
    s.stageNo = g.session.stageNo || st.def.index || 1;
    s.stageName = st.def.name;
    this.hud.draw(realDt, s, g.hudScale);
  }
}

function countOnScreen(list) {
  let n = 0;
  for (const e of list) if (e.active && !e.dead && !e.dying && e.onScreen && e.lockable) n++;
  return n;
}

export function makeHudState() {
  return {
    showCombatHud: true,
    showGauges: true,
    reticle: null,
    reticleSize: 0.032,
    lockRadius: 0.1,
    lockCap: 6,
    lockCount: 0,
    newLock: 0,
    assistActive: false,
    targets: null,
    climax: false,
    climaxGauge: 0,
    climaxReady: false,
    climaxPhase: 'idle',
    climaxOnScreen: 0,
    threat: null,
    enemyBehind: false,
    score: 0,
    combo: 0,
    comboTimer: 0,
    comboWindow: 4,
    stars: 0,
    shining: false,
    armor: 100,
    hitFlash: 0,
    lives: 3,
    missiles: 8,
    missilesMax: 8,
    missileReload: 0,
    missilesInfinite: false,
    throttle: 0,
    speed01: 0,
    speedMark: 0.41,
    speedKt: 0,
    altFt: 0,
    gLoad: 1,
    jetName: '',
    eo: null,
    pullUp: false,
    caution: null,
    radarWarning: null,
    timer: null,
    routeSelect: null,
    stageNo: 1,
    stageName: ''
  };
}
