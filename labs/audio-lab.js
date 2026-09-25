// Audio Lab - dev page for the audio subsystem (served by `npx vite` at /labs/audio-lab.html).
import { AudioEngine, SOUND_NAMES, LOOP_NAMES, TRACK_IDS, SONGS, DRUM_DEFS, analyzeChannels } from '../src/audio/index.js';

const audio = new AudioEngine();
window.audio = audio;

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
let analyser = null;

function setStatus(text) {
  statusEl.textContent = text;
}

/* ------------------------------------------------------------ sliders */

function bindRange(id, fn, fmt = (v) => v.toFixed(2)) {
  const el = $(id);
  const out = el.parentElement.querySelector('output');
  const update = () => {
    const v = parseFloat(el.value);
    if (out) out.textContent = fmt(v);
    fn(v);
  };
  el.addEventListener('input', update);
  update();
  return el;
}

for (const k of ['master', 'sfx', 'music', 'voice']) bindRange(`vol-${k}`, (v) => audio.setVolumes({ [k]: v }));
const optRate = bindRange('opt-rate', () => {});
const optPan = bindRange('opt-pan', () => {});
const optGain = bindRange('opt-gain', () => {});

/* ------------------------------------------------------------- init */

$('init').addEventListener('click', async () => {
  setStatus('initialising...');
  const ok = await audio.init();
  if (!ok) {
    setStatus('Web Audio unavailable');
    return;
  }
  if (!analyser) analyser = audio.createAnalyser(2048);
  setStatus(`ready - ${audio.stats().bankSize} buffers rendered in ${audio.stats().renderTimeMs} ms @ ${audio.ctx.sampleRate} Hz`);
  document.body.dataset.ready = '1';
});
$('suspend').addEventListener('click', () => audio.suspend());
$('resume').addEventListener('click', () => audio.resume());
$('stopAll').addEventListener('click', () => {
  audio.stopAll({ music: true });
  engineOn = false;
  audio.stopEngine();
  $('engine').textContent = 'Engine off';
  $('engine').classList.remove('on');
  document.querySelectorAll('#loops button').forEach((b) => b.classList.remove('on'));
});

/* ---------------------------------------------------------- one-shots */

const soundsEl = $('sounds');
for (const name of SOUND_NAMES) {
  const b = document.createElement('button');
  b.textContent = name;
  b.dataset.sound = name;
  b.addEventListener('click', () => {
    const opts = { rate: parseFloat(optRate.value), gain: parseFloat(optGain.value) };
    const pan = parseFloat(optPan.value);
    if (pan) opts.pan = pan;
    if ($('opt-pos').checked) {
      const a = Math.random() * Math.PI * 2;
      const d = 100 + Math.random() * 500;
      opts.position = { x: Math.cos(a) * d, y: 20, z: Math.sin(a) * d };
      markers.push({ x: opts.position.x, z: opts.position.z, life: 1.5, color: '#ff8a1f' });
    }
    audio.play(name, opts);
  });
  soundsEl.appendChild(b);
}

/* -------------------------------------------------------------- loops */

const loopsEl = $('loops');
for (const name of LOOP_NAMES) {
  const b = document.createElement('button');
  b.textContent = name;
  b.dataset.loop = name;
  b.addEventListener('click', () => {
    if (audio.isLooping(name)) {
      audio.stopLoop(name);
      b.classList.remove('on');
    } else if (audio.startLoop(name)) b.classList.add('on');
  });
  loopsEl.appendChild(b);
}
$('radio').addEventListener('click', () => audio.radio($('callsign').value, { duration: 1.2 }));

/* ------------------------------------------------------------- engine */

let engineOn = false;
let engineDemo = false;
const engineParams = { throttle: 0.5, afterburner: 0, speed: 250, gLoad: 1 };
const engSliders = {};
for (const k of Object.keys(engineParams)) {
  engSliders[k] = bindRange(
    `eng-${k}`,
    (v) => {
      engineParams[k] = v;
      if (engineOn) audio.setEngine(engineParams);
    },
    (v) => (k === 'speed' ? v.toFixed(0) : v.toFixed(2))
  );
}
$('engine').addEventListener('click', (e) => {
  engineOn = !engineOn;
  e.target.textContent = engineOn ? 'Engine on' : 'Engine off';
  e.target.classList.toggle('on', engineOn);
  if (engineOn) audio.setEngine(engineParams);
  else audio.stopEngine();
});
$('engineDemo').addEventListener('click', (e) => {
  engineDemo = !engineDemo;
  e.target.classList.toggle('on', engineDemo);
  if (engineDemo && !engineOn) $('engine').click();
});

/* --------------------------------------------------------- time scale */

const tsEl = bindRange('ts', (v) => audio.setTimeScale(v));
let climaxT = -1;
$('climax').addEventListener('click', () => {
  audio.play('climaxStart');
  climaxT = 0;
});
function climaxTick(dt) {
  if (climaxT < 0) return;
  climaxT += dt;
  // 0.9 s swell, ramp to 0.3, hold, climaxEnd at 5 s, ramp back
  let ts = 1;
  if (climaxT < 0.9) ts = 1;
  else if (climaxT < 1.3) ts = 1 - ((climaxT - 0.9) / 0.4) * 0.7;
  else if (climaxT < 5) ts = 0.3;
  else if (climaxT < 5.5) ts = 0.3 + ((climaxT - 5) / 0.5) * 0.7;
  else {
    ts = 1;
    climaxT = -1;
  }
  if (climaxT > 5 && climaxT - dt <= 5) audio.play('climaxEnd');
  tsEl.value = ts;
  tsEl.dispatchEvent(new Event('input'));
}

/* -------------------------------------------------------------- music */

const tracksEl = $('tracks');
const fadeEl = bindRange('fade', () => {}, (v) => v.toFixed(1));
for (const id of TRACK_IDS) {
  const b = document.createElement('button');
  b.textContent = `${id} - ${SONGS[id].title} (${SONGS[id].bpm})`;
  b.dataset.track = id;
  b.addEventListener('click', () => {
    audio.music.play(id, { fadeIn: parseFloat(fadeEl.value) });
    tracksEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  });
  tracksEl.appendChild(b);
}
$('musicStop').addEventListener('click', () => {
  audio.music.stop({ fadeOut: parseFloat(fadeEl.value) });
  tracksEl.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
});
bindRange('intensity', (v) => audio.music.setIntensity(v));

/* ------------------------------------------------------------- flyby */

const listener = { pos: { x: 0, y: 0, z: 0 }, fwd: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
const flybys = [];
const markers = [];
function startFlyby(p, v) {
  const h = audio.play('flyby', { position: p, velocity: v });
  if (h) flybys.push({ h, p: { ...p }, v: { ...v }, t: 0 });
}
$('flyby').addEventListener('click', () => startFlyby({ x: -700, y: 30, z: -60 }, { x: 400, y: 0, z: 0 }));
$('flybyHead').addEventListener('click', () => startFlyby({ x: 20, y: 40, z: -900 }, { x: 0, y: 0, z: 450 }));
$('barrage').addEventListener('click', () => {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pos = { x: Math.cos(a) * 250, y: 10, z: Math.sin(a) * 250 };
    audio.play(i % 2 ? 'explosionSmall' : 'explosionLarge', { position: pos, delay: i * 0.18 });
    markers.push({ x: pos.x, z: pos.z, life: 1.5 + i * 0.18, color: '#ff4d5e' });
  }
});

const radar = $('radar');
const rctx = radar.getContext('2d');
function drawRadar() {
  const w = radar.width;
  const h = radar.height;
  const s = w / 2000; // 2 km wide
  rctx.fillStyle = '#070b10';
  rctx.fillRect(0, 0, w, h);
  rctx.strokeStyle = '#243242';
  for (const r of [100, 250, 500]) {
    rctx.beginPath();
    rctx.arc(w / 2, h / 2, r * s, 0, Math.PI * 2);
    rctx.stroke();
  }
  rctx.fillStyle = '#41d17a';
  rctx.beginPath();
  rctx.moveTo(w / 2, h / 2 - 8);
  rctx.lineTo(w / 2 - 5, h / 2 + 5);
  rctx.lineTo(w / 2 + 5, h / 2 + 5);
  rctx.fill();
  for (const f of flybys) {
    rctx.fillStyle = '#ff8a1f';
    rctx.beginPath();
    rctx.arc(w / 2 + f.p.x * s, h / 2 + f.p.z * s, 4, 0, Math.PI * 2);
    rctx.fill();
  }
  for (const m of markers) {
    rctx.fillStyle = m.color;
    rctx.globalAlpha = Math.min(1, m.life);
    rctx.beginPath();
    rctx.arc(w / 2 + m.x * s, h / 2 + m.z * s, 3, 0, Math.PI * 2);
    rctx.fill();
    rctx.globalAlpha = 1;
  }
}

/* -------------------------------------------------------------- scope */

const scope = $('scope');
const sctx = scope.getContext('2d');
let scopeData = null;
function drawScope() {
  const w = scope.width;
  const h = scope.height;
  sctx.fillStyle = '#070b10';
  sctx.fillRect(0, 0, w, h);
  if (!analyser) return;
  if (!scopeData) scopeData = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(scopeData);
  let peak = 0;
  sctx.strokeStyle = '#ff8a1f';
  sctx.beginPath();
  for (let i = 0; i < scopeData.length; i++) {
    const v = scopeData[i];
    if (Math.abs(v) > peak) peak = Math.abs(v);
    const x = (i / scopeData.length) * w;
    const y = h / 2 - v * (h / 2);
    if (i) sctx.lineTo(x, y);
    else sctx.moveTo(x, y);
  }
  sctx.stroke();
  sctx.fillStyle = peak > 0.97 ? '#ff4d5e' : '#41d17a';
  sctx.fillRect(0, h - 4, peak * w, 4);
}

/* --------------------------------------------------------------- loop */

let last = performance.now();
let statT = 0;
let demoT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  climaxTick(dt);
  if (engineDemo && engineOn) {
    demoT += dt;
    engineParams.throttle = 0.5 + 0.5 * Math.sin(demoT * 0.7);
    engineParams.afterburner = Math.max(0, Math.sin(demoT * 0.4)) > 0.7 ? 1 : 0;
    engineParams.speed = 275 + 125 * Math.sin(demoT * 0.3);
    engineParams.gLoad = 1 + 4 * Math.max(0, Math.sin(demoT * 0.9));
    for (const k of Object.keys(engineParams)) {
      engSliders[k].value = engineParams[k];
      engSliders[k].parentElement.querySelector('output').textContent = engineParams[k].toFixed(k === 'speed' ? 0 : 2);
    }
    audio.setEngine(engineParams);
  }
  const wdt = dt * audio.timeScale;
  for (let i = flybys.length - 1; i >= 0; i--) {
    const f = flybys[i];
    f.p.x += f.v.x * wdt;
    f.p.y += f.v.y * wdt;
    f.p.z += f.v.z * wdt;
    f.h.setPosition(f.p);
    if (!f.h.playing) flybys.splice(i, 1);
  }
  for (let i = markers.length - 1; i >= 0; i--) {
    markers[i].life -= dt;
    if (markers[i].life <= 0) markers.splice(i, 1);
  }
  audio.setListener(listener.pos, listener.fwd, listener.up, listener.vel);
  audio.update(dt);
  if (flybys.length && flybys[0].h.playing) {
    const v = flybys[0].h._v;
    $('doppler').textContent = `doppler: ${v.doppler.toFixed(3)}  pos: ${v.px.toFixed(0)}, ${v.pz.toFixed(0)}`;
  }
  drawRadar();
  drawScope();
  statT += dt;
  if (statT > 0.5 && audio.isReady) {
    statT = 0;
    const s = audio.stats();
    setStatus(
      `${s.state} | voices ${s.voices} (pos ${s.positional}) | loops [${s.loops.join(', ')}] | music ${s.music || '-'} | ts ${s.timeScale.toFixed(2)} | t ${audio.ctx.currentTime.toFixed(1)}s`
    );
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---------------------------------------------------------- self-test */

function analyze(buffer) {
  const ch = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) ch.push(buffer.getChannelData(c));
  return analyzeChannels(ch);
}

/**
 * Offline checks: every pre-rendered buffer, an sfx mix through the master chain,
 * 6 s of every music track (pre-master) and the engine loop. Returns a report.
 */
async function selfTest() {
  if (!audio.isReady) await audio.init();
  const report = { sounds: [], mix: null, music: [], engine: null, problems: [] };
  const P = (m) => report.problems.push(m);
  const names = [...SOUND_NAMES, 'vulcanTail', 'heartbeat', 'radioOpen', 'radioStatic', 'radioClose', ...Object.keys(DRUM_DEFS)];
  for (const name of names) {
    const b = audio.getBuffer(name);
    if (!b) {
      P(`missing buffer ${name}`);
      continue;
    }
    const a = analyze(b);
    report.sounds.push({ name, dur: b.duration, peak: a.peak, rms: a.rms, win: a.maxWindowRms });
    if (!a.finite) P(`${name}: non-finite samples`);
    if (!(a.peak < 1)) P(`${name}: peak ${a.peak.toFixed(3)} >= 1`);
    if (!(a.maxWindowRms > 0.01)) P(`${name}: silent (max window rms ${a.maxWindowRms.toFixed(4)})`);
  }
  const mixBuf = await audio.renderOfflineMix(
    [
      { name: 'explosionLarge', time: 0 },
      { name: 'missileLaunch', time: 0.15 },
      { name: 'vulcan', time: 0.1 },
      { name: 'hit', time: 0.3 },
      { name: 'sonicBoom', time: 0.5 },
      { name: 'flare', time: 0.8 },
      { name: 'lockOn', time: 1.0 },
      { name: 'explosionSmall', time: 1.2 },
      { name: 'playerHit', time: 1.5 }
    ],
    3
  );
  report.mix = analyze(mixBuf);
  if (!(report.mix.peak < 1)) P(`sfx mix peak ${report.mix.peak.toFixed(3)} >= 1`);
  if (!(report.mix.rms > 0.02)) P(`sfx mix too quiet (rms ${report.mix.rms.toFixed(4)})`);
  for (const id of TRACK_IDS) {
    for (const [section, intensity] of [[0, 0.5], [Math.min(2, SONGS[id].arrangement.length - 1), 1]]) {
      const b = await audio.music.renderOffline(id, { seconds: 6, intensity, section });
      const a = analyze(b);
      report.music.push({ id, section: SONGS[id].arrangement[section], intensity, peak: a.peak, rms: a.rms, win: a.maxWindowRms });
      if (!a.finite) P(`music ${id}: non-finite`);
      if (!(a.peak < 1)) P(`music ${id}/${section}: pre-master peak ${a.peak.toFixed(3)} >= 1`);
      if (!(a.rms > 0.015)) P(`music ${id}/${section}: too quiet (rms ${a.rms.toFixed(4)})`);
    }
  }
  const eng = await audio.renderEngineOffline({ throttle: 1, afterburner: 1, speed: 400, gLoad: 6 }, 2);
  report.engine = analyze(eng);
  report.engineCruise = analyze(await audio.renderEngineOffline({ throttle: 0.5, afterburner: 0, speed: 250, gLoad: 1 }, 2));
  if (!(report.engine.peak < 1)) P(`engine peak ${report.engine.peak.toFixed(3)} >= 1`);
  if (!(report.engineCruise.rms > 0.005)) P('engine silent');
  report.ok = report.problems.length === 0;
  renderReport(report);
  return report;
}
window.audioLabSelfTest = selfTest;

function renderReport(r) {
  const f = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : v);
  const rows = [];
  rows.push('<tr><th>item</th><th>dur/int</th><th>peak</th><th>rms</th><th>max win rms</th></tr>');
  for (const s of r.sounds) {
    const bad = !(s.peak < 1) || !(s.win > 0.01);
    rows.push(`<tr class="${bad ? 'bad' : ''}"><td>${s.name}</td><td>${f(s.dur, 2)}s</td><td>${f(s.peak)}</td><td>${f(s.rms)}</td><td>${f(s.win)}</td></tr>`);
  }
  rows.push(`<tr><td><b>sfx mix (master chain)</b></td><td>3s</td><td>${f(r.mix.peak)}</td><td>${f(r.mix.rms)}</td><td>${f(r.mix.maxWindowRms)}</td></tr>`);
  rows.push(`<tr><td><b>engine (full AB)</b></td><td>2s</td><td>${f(r.engine.peak)}</td><td>${f(r.engine.rms)}</td><td>${f(r.engine.maxWindowRms)}</td></tr>`);
  rows.push(`<tr><td><b>engine (cruise)</b></td><td>2s</td><td>${f(r.engineCruise.peak)}</td><td>${f(r.engineCruise.rms)}</td><td>${f(r.engineCruise.maxWindowRms)}</td></tr>`);
  for (const m of r.music) {
    rows.push(`<tr class="${m.peak < 1 ? '' : 'bad'}"><td>music ${m.id} / ${m.section}</td><td>${f(m.intensity, 1)}</td><td>${f(m.peak)}</td><td>${f(m.rms)}</td><td>${f(m.win)}</td></tr>`);
  }
  $('selftestTable').innerHTML = rows.join('');
  $('selftestSummary').innerHTML = r.ok ? '<span class="ok">all checks passed</span>' : `<span class="bad">${r.problems.length} problem(s): ${r.problems.join('; ')}</span>`;
}
$('selftest').addEventListener('click', () => selfTest());
