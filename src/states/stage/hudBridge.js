import { Vector3 } from 'three';
import { projectPoint } from '../../sim/lockon.js';
import { clamp } from '../../core/math.js';

const _s = new Vector3();

/**
 * Builds the HUD snapshot (`hudState` v2, see docs/overhaul/CONTRACTS.md)
 * from the stage's systems every rendered frame and hands it to the HUD.
 */
export class HudBridge {
  constructor(stage) {
    this.stage = stage;
    this.game = stage.game;
    this.hud = stage.game.hud;
    this.state = makeHudState();
    stage.events.on('evade', () => this.popupAtScreen(0.5, 0.62, 'EVADED!', '#7dffb0'));
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
    s.climaxReady = climax.ready;
    s.climaxPhase = climax.phase ?? (climax.active ? 'active' : climax.ready ? 'ready' : 'idle');
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
    s.lives = Math.max(0, g.session.lives);
    s.missiles = stock.ready ?? stock.count;
    s.missilesMax = stock.max;
    s.missileReload = stock.reload ?? clamp(stock.acc ?? 0, 0, 1);
    s.throttle = p.throttle;
    s.speed01 = p.baseSpeed > 0 ? clamp((p.speed - p.baseSpeed * 0.72) / (p.baseSpeed * (1.4 - 0.72)), 0, 1) : 0;
    s.speedKt = p.speed * 1.944;
    s.altFt = p.pos.y * 3.28;
    s.gLoad = p.gLoad;
    s.jetName = g.session.jetName || '';
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
    lives: 3,
    missiles: 8,
    missilesMax: 8,
    missileReload: 0,
    throttle: 0,
    speed01: 0,
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
