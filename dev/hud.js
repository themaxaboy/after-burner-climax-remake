// HUD dev page (vite dev only, not part of the build): renders the HUD over a
// painted sky with mock snapshots, one scene per HUD state, plus the DOM
// panels (Please Wait + route map, Status Report, results, menu).
// URL: /dev/hud.html?scene=<name>&lang=th&touch=1&t=<sec>  (t = simulate then freeze)
import '../src/ui/ui.css';
import { HUD } from '../src/ui/hud.js';
import { makeHudState } from '../src/states/stage/hudBridge.js';
import { setLang, t } from '../src/ui/i18n.js';
import { renderRouteMap } from '../src/ui/routeMap.js';
import { Menu, overlay } from '../src/ui/menu.js';

const q = new URLSearchParams(location.search);
const sceneName = q.get('scene') || 'normal';
const freezeT = q.has('t') ? +q.get('t') : null;
const touch = q.get('touch') === '1';
if (q.get('shot') === '1') document.body.classList.add('shot');

const gl = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const hud = new HUD(hudCanvas);
hud.touchLayout = touch;
hud.lowFx = q.get('low') === '1';
let dpr = Math.min(devicePixelRatio || 1, 2);

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  for (const c of [gl, hudCanvas]) {
    c.width = Math.round(innerWidth * dpr);
    c.height = Math.round(innerHeight * dpr);
    c.style.width = innerWidth + 'px';
    c.style.height = innerHeight + 'px';
  }
  paintSky();
}

/** Plain painted backdrop: bright sky, sun, sea, a jet silhouette (no reference art). */
function paintSky() {
  const c = gl.getContext('2d');
  const W = gl.width, H = gl.height;
  const night = sceneName === 'climax';
  const g = c.createLinearGradient(0, 0, 0, H);
  if (night) {
    g.addColorStop(0, '#0b2a66');
    g.addColorStop(0.55, '#3aa7e8');
  } else {
    g.addColorStop(0, '#1f6fe0');
    g.addColorStop(0.55, '#a9dcff');
  }
  g.addColorStop(0.56, '#2a7fd0');
  g.addColorStop(1, '#0a3a86');
  c.save();
  c.translate(W / 2, H / 2);
  c.rotate(-0.12);
  c.fillStyle = g;
  c.fillRect(-W, -H / 2 - H * 0.3, W * 2, H * 1.6);
  const sun = c.createRadialGradient(W * 0.18, -H * 0.3, 0, W * 0.18, -H * 0.3, H * 0.35);
  sun.addColorStop(0, 'rgba(255,255,255,1)');
  sun.addColorStop(0.1, 'rgba(255,255,240,0.9)');
  sun.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sun;
  c.fillRect(-W, -H, W * 2, H * 2);
  c.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 9; i++) {
    c.beginPath();
    c.ellipse(-W * 0.45 + i * W * 0.12, -H * 0.12 + ((i * 37) % 5) * 6 * dpr, 70 * dpr, 16 * dpr, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  // jet silhouette, lower centre
  const x = W / 2, y = H * 0.7, s = Math.min(W, H) * 0.2;
  c.fillStyle = '#9aa6b8';
  c.strokeStyle = '#3a4456';
  c.lineWidth = 2 * dpr;
  c.beginPath();
  c.moveTo(x, y - s * 0.35);
  c.lineTo(x + s * 0.12, y);
  c.lineTo(x + s * 1.1, y + s * 0.18);
  c.lineTo(x + s * 0.14, y + s * 0.22);
  c.lineTo(x + s * 0.3, y + s * 0.42);
  c.lineTo(x, y + s * 0.34);
  c.lineTo(x - s * 0.3, y + s * 0.42);
  c.lineTo(x - s * 0.14, y + s * 0.22);
  c.lineTo(x - s * 1.1, y + s * 0.18);
  c.lineTo(x - s * 0.12, y);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = '#ffb347';
  c.beginPath();
  c.arc(x - s * 0.08, y + s * 0.36, s * 0.05, 0, Math.PI * 2);
  c.arc(x + s * 0.08, y + s * 0.36, s * 0.05, 0, Math.PI * 2);
  c.fill();
}

let nextId = 1;
function target(o) {
  return { id: nextId++, active: true, onScreen: true, dead: false, dying: 0, lockable: true, locks: 0, incoming: 0, xMark: false, rammer: false, tag: null, radius: 9, dist: 900, hp: 1, maxHp: 1, def: {}, ...o };
}

function base() {
  const s = makeHudState();
  Object.assign(s, {
    reticle: { x: 0, y: -0.02 },
    score: 12690,
    combo: 12,
    comboTimer: 2.6,
    stars: 2,
    stageNo: 1,
    missiles: 6,
    missilesMax: 8,
    missileReload: 0.45,
    climaxGauge: 0.55,
    speed01: 0.44,
    armor: 100,
    lives: 3,
    jetName: 'F-15E STRIKE EAGLE',
    lockCap: 4,
    targets: [
      target({ sx: -0.42, sy: 0.32, dist: 1400 }),
      target({ sx: 0.36, sy: 0.18, dist: 700 }),
      target({ sx: 0.55, sy: 0.4, dist: 2100 }),
      target({ sx: -0.2, sy: 0.05, dist: 1100 })
    ]
  });
  return s;
}

const SCENES = {
  normal() {
    const s = base();
    hud.radio('HAWKEYE', 'Yours is a stealth capable target.', 60);
    return s;
  },
  locks() {
    const s = base();
    s.lockCount = 3;
    s.newLock = 1;
    s.missiles = 4;
    s.targets = [
      target({ sx: -0.35, sy: 0.3, dist: 700, locks: 1 }),
      target({ sx: 0.3, sy: 0.22, dist: 1500, locks: 1 }),
      target({ sx: 0.05, sy: 0.4, dist: 3000, locks: 2, def: { big: true }, hp: 0.6, radius: 30 }),
      target({ sx: -0.6, sy: 0.1, dist: 900, incoming: 1, xMark: true }),
      target({ sx: 0.62, sy: 0.02, dist: 600, incoming: 1, xMark: true }),
      target({ sx: -0.1, sy: -0.35, dist: 400, rammer: true }),
      target({ sx: 0.45, sy: 0.55, dist: 1800, tag: 'xb70', def: { big: true }, hp: 0.35, radius: 25 })
    ];
    hud.radio('WINGMAN', 'Good kill! Good kill!', 60);
    return s;
  },
  climax() {
    const s = base();
    s.climax = true;
    s.climaxPhase = 'active';
    s.lockRadius = 0.45;
    s.lockCap = 64;
    s.lockCount = 14;
    s.climaxOnScreen = 17;
    s.climaxGauge = 0.62;
    s.combo = 43;
    s.targets = [];
    for (let i = 0; i < 17; i++) {
      const a = i * 2.4, r = 0.15 + (i % 5) * 0.08;
      s.targets.push(target({ sx: Math.cos(a) * r * 0.6, sy: Math.sin(a) * r + 0.05, dist: 800 + i * 120, locks: i < 14 ? 1 : 0 }));
    }
    hud.callout(t('hud.climaxCallout'), { variant: 'cyan', dur: 60, size: 70, y: 0.2 });
    return s;
  },
  ready() {
    const s = base();
    s.climaxGauge = 1;
    s.climaxReady = true;
    s.climaxPhase = 'ready';
    hud.message(t('hud.engage'), { dur: 60 });
    return s;
  },
  missile() {
    const s = base();
    s.threat = { tgo: 1.1, sx: 0.8, sy: 0.35, behind: false, strong: true };
    s.caution = 'CAUTION';
    s.enemyBehind = true;
    s.armor = 46;
    s.combo = 0;
    hud.radio('WINGMAN', 'Missile launch! Break right!', 60);
    return s;
  },
  route() {
    const s = base();
    s.targets = [];
    s.routeSelect = { left: { id: 'sunset', name: 'SUNSET ARMADA' }, right: { id: 'glacier', name: 'GLACIER FJORD' }, side: -1, t: 0.4, commit: 0 };
    hud.radio('HAWKEYE', 'Choose your heading, Hawk.', 60);
    return s;
  },
  eo() {
    const s = base();
    s.eo = { id: 'helos', title: 'Shoot down 8 of 10 CH-47 transports', kind: 'destroy', remaining: 10, timeLimit: 40, t: 12, status: 'active' };
    s.timer = { label: 'TIME TO TARGET', value: 42.3 };
    s.radarWarning = 'RADAR CEILING';
    s.targets.push(target({ sx: 0.25, sy: 0.45, dist: 1600, tag: 'helos' }));
    hud.message(t('ui.eo'), { sub: s.eo.title, dur: 60, color: '#ffd84a' });
    return s;
  },
  eofail() {
    const s = base();
    s.eo = { id: 'b52', title: 'Destroy the B-52', kind: 'destroy', remaining: 1, timeLimit: 30, t: 30, status: 'active' };
    return s;
  },
  lowarmor() {
    const s = base();
    s.armor = 18;
    s.pullUp = true;
    s.combo = 57;
    s.stars = 5;
    s.shining = true;
    s.missilesInfinite = true;
    s.score = 1282120;
    s.stageNo = 12;
    s.radarWarning = 'RADAR LOCK — GET LOW!';
    return s;
  },
  mission() {
    const s = base();
    s.showCombatHud = false;
    hud.message(t('ui.missionComplete'), { sub: 'DOWN RATE 94.2%', dur: 60, color: '#7dffb0' });
    return s;
  },
  thai() {
    setLang('th');
    const s = base();
    s.threat = { tgo: 2.4, sx: -0.9, sy: -0.2, behind: false, strong: false };
    s.routeSelect = { left: { id: 'clouds', name: 'SEA OF CLOUDS' }, right: { id: 'strike', name: 'CANYON STRIKE' }, side: 1, t: 0.7, commit: 0 };
    s.enemyBehind = true;
    hud.radio('HAWKEYE', 'ระวังข้างหลัง ฮอว์ก! ข้าศึกไล่มาจากด้านหลัง!', 60);
    hud.message(t('ui.missionComplete'), { dur: 60 });
    return s;
  },
  panels() {
    buildPanels();
    return null;
  }
};

// ------------------------------------------------------------- DOM panels
const SAMPLE_GRAPH = {
  start: 'ocean',
  nodes: {
    ocean: { next: 'emerald' },
    emerald: { next: 'canyon' },
    canyon: { fork: [{ id: 'sunset', side: -1 }, { id: 'glacier', side: 1 }] },
    sunset: { next: 'dunes' },
    glacier: { next: 'dunes' },
    dunes: { next: 'clouds', bonus: { id: 'aurora', requires: 3 }, fork: [{ id: 'clouds', side: -1 }, { id: 'strike', side: 1 }] },
    aurora: { fork: [{ id: 'clouds', side: -1 }, { id: 'strike', side: 1 }] },
    clouds: { next: 'fortress' },
    strike: { next: 'fortress' },
    fortress: { end: true }
  },
  layout: {
    ocean: [0, 1, 'square'],
    emerald: [1, 1, 'square'],
    canyon: [2, 1, 'square'],
    sunset: [3, 0, 'square'],
    glacier: [3, 2, 'square'],
    dunes: [4, 1, 'square'],
    aurora: [5, 1, 'sphere'],
    clouds: [6, 0, 'square'],
    strike: [6, 2, 'square'],
    fortress: [7, 1, 'square']
  }
};

function buildPanels() {
  const ui = document.getElementById('ui');
  const which = q.get('panel') || 'wait';
  const root = overlay('fade-in');
  ui.appendChild(root);
  const session = { route: ['ocean', 'emerald', 'canyon', 'glacier'], node: 'dunes', eoCleared: { helos: true, xb70: true, aa: true } };
  if (which === 'wait') {
    root.classList.add('please-wait');
    root.innerHTML = `
      <div class="pw-banner"><span class="pw-title">${t('wait.title')}</span></div>
      <div class="pw-body">
        <div class="pw-jet"><div class="pw-code">F-15E</div><div class="pw-name">Strike Eagle</div><div class="pw-paint">${t('wait.paint')}: STANDARD</div></div>
        <div class="pw-map"></div>
      </div>
      <div class="pw-foot">${t('wait.loading')}<span class="pw-dots"></span></div>`;
    renderRouteMap(root.querySelector('.pw-map'), SAMPLE_GRAPH, session, { highlight: 'dunes' });
  } else if (which === 'status') {
    const el = document.createElement('div');
    el.className = 'panel-glass status-report';
    el.innerHTML = `
      <div class="heading-xl">${t('status.title')}</div>
      <div class="sr-rows">
        <div class="sr-row"><span class="sr-k">${t('status.score')}</span><span class="sr-v">0457070</span></div>
        <div class="sr-row"><span class="sr-k">${t('status.downTotal')}</span><span class="sr-v">214 / 236</span></div>
        <div class="sr-row"><span class="sr-k">${t('status.maxCombo')}</span><span class="sr-v">87</span></div>
        <div class="sr-row"><span class="sr-k">${t('status.playTime')}</span><span class="sr-v">04'21"50</span></div>
        <div class="sr-row"><span class="sr-k">${t('status.rank')}</span><span class="sr-v"><span class="grade grade-AA">AA</span></span></div>
      </div>
      <div class="route-map compact"></div>
      <div class="go">${t('status.continue')} ›</div>`;
    root.appendChild(el);
    renderRouteMap(el.querySelector('.route-map'), SAMPLE_GRAPH, session, { compact: true });
  } else if (which === 'results') {
    const el = document.createElement('div');
    el.className = 'panel';
    el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px">
      <div><h2>${t('ui.stage')} 4 · GLACIER FJORD</h2><h1>${t('res.clear')}</h1><div class="stars-row">★★★☆☆</div></div>
      <div style="text-align:center"><div class="menu-subtitle" style="margin:0">${t('res.rank')}</div><div class="rank-letter grade-AAA">AAA</div></div></div>
      <div class="results-grid">${[['res.kills', 64], ['res.combo', 31], ['res.time', "1'02\"40"], ['res.down', '96.8%'], ['res.eo', t('res.cleared')], ['res.score', '000457070']]
        .map(([k, v], i) => `<div class="k">${t(k)}</div><div class="v" style="animation-delay:${0.1 + i * 0.1}s">${v}</div>`).join('')}</div>
      <div class="go">${t('menu.continue')} ›</div>`;
    root.appendChild(el);
  } else if (which === 'menu') {
    let v = true;
    const m = new Menu({
      title: t('opt.title'),
      items: [
        { type: 'select', label: t('opt.quality'), options: [{ value: 'auto', label: 'AUTO' }, { value: 'high', label: 'HIGH' }], get: () => 'auto', set: () => {} },
        { type: 'toggle', label: t('opt.autoMissile'), get: () => v, set: (x) => (v = x), hint: t('opt.autoMissileHint') },
        { type: 'toggle', label: t('opt.climaxToggle'), get: () => false, set: () => {}, hint: t('opt.climaxToggleHint') },
        { type: 'slider', label: t('opt.music'), get: () => 0.7, set: () => {} },
        { label: t('opt.back') }
      ]
    });
    m.mount(root);
  } else if (which === 'pause') {
    const m = new Menu({ className: 'menu-main', title: t('menu.paused'), items: [{ label: t('menu.resume') }, { label: t('menu.restart') }, { label: t('menu.quit') }] });
    m.mount(root);
  }
}

// ------------------------------------------------------------------ run
if (q.get('lang') === 'th') setLang('th');
if (touch) {
  // same markup as src/input/touch.js, to check the HUD keeps clear of the buttons
  const el = document.createElement('div');
  el.className = 'touch-layer';
  el.innerHTML = `
    <div class="touch-throttle"><div class="tt-label tt-fast">FAST</div><div class="tt-track"><div class="tt-knob" style="top:50%"></div></div><div class="tt-label tt-slow">SLOW</div></div>
    <button class="touch-btn touch-missile">MISSILE</button>
    <button class="touch-btn touch-climax">CLIMAX</button>
    <button class="touch-btn touch-flare">FLARE</button>
    <button class="touch-btn touch-pause">II</button>`;
  document.body.appendChild(el);
}
resize();
addEventListener('resize', resize);
const scene = SCENES[sceneName] || SCENES.normal;
const s = scene();
if (s) s.stageName = 'BLUE HORIZON';

const bar = document.getElementById('devbar');
for (const name of Object.keys(SCENES)) {
  const b = document.createElement('button');
  b.textContent = name;
  if (name === sceneName) b.className = 'on';
  b.onclick = () => {
    q.set('scene', name);
    location.search = q.toString();
  };
  bar.appendChild(b);
}

let simT = 0;
function step(dt) {
  simT += dt;
  if (s) {
    // scripted progressions
    if (sceneName === 'eo' && simT > 0.3) s.eo.remaining = 6;
    if (sceneName === 'eofail' && simT > 0.5) s.eo.status = 'failed';
    if (sceneName === 'route' && q.get('commit') && simT > 0.5) s.routeSelect.commit = -1;
    s.newLock = Math.max(0, s.newLock - dt * 0.5);
  }
  hud.draw(dt, s, dpr);
}

await document.fonts.ready;
if (freezeT != null) {
  const dt = 1 / 60;
  const n = Math.round(freezeT / dt);
  for (let i = 0; i < n; i++) step(dt);
  window.__hudReady = true;
} else {
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__hudReady = true;
}
