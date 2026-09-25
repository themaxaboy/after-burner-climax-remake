// Terrain Lab (dev only, not built): flies a TerrainRun over a sample rail for
// each profile / palette with the game's real World, post chain and chase
// camera, so terrain, water, obstacles and trees can be judged (and
// screenshotted) without a stage def.
//
//   /dev/terrain.html?scene=canyon|valley|fjord|dunes&s=5200&cam=chase|high|side|far&q=medium
//   &look=<LOOKS name>   override the look      &steer=0   keyboard steering (arrows)   &jet=0  hide the proxy jet
//   &shot=1&warm=2       simulate `warm` seconds up to s, render, set body.dataset.ready = '1'
//   &shot=1&fly=40       precompile, fly 40 s and report shader programs compiled mid-flight (stats)
import { Group, Mesh, BoxGeometry, MeshStandardMaterial, Vector3, Matrix4 } from 'three';
import { PRESETS } from '../src/core/quality.js';
import { createRenderer } from '../src/render/renderer.js';
import { PostFX } from '../src/render/composer.js';
import { CameraRig } from '../src/render/cameraRig.js';
import { World } from '../src/world/world.js';
import { LOOKS } from '../src/world/looks.js';
import { WorldUniforms } from '../src/render/worldUniforms.js';
import { Rail } from '../src/sim/rail.js';
import { buildRail } from '../src/stages/railBuilder.js';
import { Player } from '../src/sim/player.js';
import { Events } from '../src/core/events.js';
import { clamp } from '../src/core/math.js';
import { TerrainRun } from '../src/stages/common/terrainRun.js';
import { TERRAIN_EXAMPLES, EXAMPLE_RAIL } from '../src/world/terrain/examples.js';

const params = new URLSearchParams(location.search);
const sceneName = params.get('scene') || 'canyon';
const S0 = parseFloat(params.get('s') || '4200');
const camMode = params.get('cam') || 'chase';
const quality = params.get('q') || 'medium';
const shot = params.get('shot') === '1';
const warm = parseFloat(params.get('warm') || '2');
const steer = params.get('steer') !== '0';
const LOOK_FOR = { canyon: 'canyonRed', valley: 'emerald', fjord: 'glacier', dunes: 'dunes' };
const env = LOOKS[params.get('look') || LOOK_FOR[sceneName]] || LOOKS.canyonRed;
if (shot) document.body.classList.add('shot');

// ------------------------------------------------------------------ renderer, world, post
const canvas = document.getElementById('gl');
const renderer = createRenderer(canvas);
const preset = PRESETS[quality] || PRESETS.medium;
const rig = new CameraRig(innerWidth / innerHeight);
const world = new World(renderer, preset, rig.camera);
world.configure(env);
const post = new PostFX(renderer, world.scene, rig.camera, preset);
renderer.toneMappingExposure = env.toneExposure ?? 0.6;
post.grade.setGrade(env.grade || 'neutral');
post.bloom.luminanceMaterial.threshold = env.bloom?.threshold ?? 1.0;
post.bloom.intensity = env.bloom?.intensity ?? 0.9;
function resize() {
  renderer.setPixelRatio(shot ? 1 : Math.min(devicePixelRatio || 1, 1.5));
  post.setSize(innerWidth, innerHeight);
  renderer.domElement.style.width = innerWidth + 'px';
  renderer.domElement.style.height = innerHeight + 'px';
  rig.setAspect(innerWidth / innerHeight);
}
resize();
addEventListener('resize', resize);

// ------------------------------------------------------------------ rail, player, fake stage
const rail = new Rail({ points: buildRail(EXAMPLE_RAIL) });
const def = TERRAIN_EXAMPLES[sceneName] || TERRAIN_EXAMPLES.canyon;
const p = new Player();
const box = { x: 200, y: 80 };
p.reset({ s: Math.max(10, S0 - (shot ? warm : 0) * 240), baseSpeed: 240, box });
p.lateralSpeed = 150;
p.verticalSpeed = 100;
p.computePose(rail);
p.prevPos.copy(p.pos);
p.prevQuat.copy(p.quat);
const hits = [];
const game = { preset, world, rig, renderer, clock: { worldTime: 0 }, settings: { difficulty: 'normal' }, params: {} };
const stage = {
  game,
  rail,
  player: p,
  def: { rail: { box } },
  ctx: {},
  hudExtra: {},
  autopilotHint: { x: null, y: null },
  events: new Events(),
  difficulty: { terrain: 25 },
  fx: { hitSparks() {}, smokePuff() {} },
  playerHit(amount, kind) {
    hits.push(`${kind} ${amount}% @${p.s.toFixed(0)}`);
    p.damage(amount);
    p.armor = 100;
    p.alive = true;
  }
};
const cautionEl = document.getElementById('caution');
stage.events.on('caution', (e) => console.log('caution', e.kind, e.on));

// jet proxy (scale reference)
const jet = new Group();
const jm = new MeshStandardMaterial({ color: 0x9aa4ae, roughness: 0.5, metalness: 0.4 });
jet.add(new Mesh(new BoxGeometry(1.6, 1.4, 15), jm));
const wing = new Mesh(new BoxGeometry(12, 0.3, 4.5), jm);
wing.position.set(0, 0, 1.5);
jet.add(wing);
const tail = new Mesh(new BoxGeometry(0.3, 3, 2.5), jm);
tail.position.set(0, 1.6, 6.5);
jet.add(tail);
world.csm?.setupMaterial(jm);
if (params.get('jet') !== '0') world.dynamic.add(jet);

const run = new TerrainRun(stage, def);
await run.init();
p.x = run.safeX(p.s, p.pos.y);
p.computePose(rail);
p.prevPos.copy(p.pos);

// ------------------------------------------------------------------ sim
const input = { moveX: 0, moveY: 0, throttleAxis: 0 };
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.key));
addEventListener('keyup', (e) => keys.delete(e.key));
const lim = { minY: 0 };
const _v = new Vector3();
function step(dt) {
  run.preUpdate(dt, dt);
  const hint = stage.autopilotHint;
  if (steer) {
    input.moveX = clamp(((hint.x ?? 0) - p.x) / 22 - p.vx / 260, -1, 1);
    const ty = hint.y ?? 6;
    input.moveY = clamp((ty - p.y) / 20 - p.vy / 200, -1, 1);
  } else {
    input.moveX = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
    input.moveY = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
  }
  lim.minY = run.groundAt(p.s, p.x) + 10 - rail.positionAt(p.s, _v).y;
  p.update(dt, input, rail, lim);
  run.update(dt, dt);
  game.clock.worldTime += dt;
}

const _m = new Matrix4();
function place(alpha, dt) {
  jet.position.copy(p.pos);
  jet.quaternion.copy(p.quat);
  const cam = rig.camera;
  if (camMode === 'chase') rig.update(p, rail, alpha, dt);
  else {
    const f = rail.frameAt(p.s, rig.frame);
    const T = f.T, R = f.R;
    const [back, up, side, ahead] = camMode === 'high' ? [260, 150, 0, 500] : camMode === 'side' ? [-60, 50, 320, 150] : [700, 650, 0, 1400];
    cam.position.copy(p.pos).addScaledVector(T, -back).addScaledVector(R, side);
    cam.position.y += up;
    _v.copy(p.pos).addScaledVector(T, ahead);
    _m.lookAt(cam.position, _v, new Vector3(0, 1, 0));
    cam.quaternion.setFromRotationMatrix(_m);
    cam.updateMatrixWorld();
  }
}

function render(dt) {
  world.update(dt, rig.camera);
  post.update(rig.camera, WorldUniforms.uSunDir.value, dt, { flareIntensity: 1 });
  post.render(dt);
}

const stats = document.getElementById('stats');
function hud() {
  const h = run.heightAt(p.s, p.x);
  stats.textContent = `${sceneName}  s ${p.s.toFixed(0)}  x ${p.x.toFixed(1)}  y ${p.y.toFixed(1)}\n` +
    `centre ${run.shape.centreAt(p.s).toFixed(1)}  hint ${(stage.autopilotHint.x ?? 0).toFixed(1)} / ${stage.autopilotHint.y?.toFixed(1) ?? '-'}\n` +
    `clearance ${(p.pos.y - h).toFixed(1)}  query ${run.query(p.s, p.x, p.pos.y).toFixed(1)}\n` +
    `caution ${stage.hudExtra.caution ?? '-'}  hits ${hits.length}\n${hits.slice(-4).join('\n')}\n` +
    `trees ${run.streamer.trees?.mesh.count ?? 0}  obstacles ${run.obstacles?.list.length ?? 0}\n` +
    `calls ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k  progs ${renderer.info.programs?.length}`;
  cautionEl.textContent = stage.hudExtra.caution || '';
}

// scene / camera switches
const mk = (id, list, key, cur) => {
  const el = document.getElementById(id);
  for (const v of list) {
    const b = document.createElement('button');
    b.textContent = v;
    if (v === cur) b.className = 'on';
    b.onclick = () => {
      params.set(key, v);
      if (key === 'scene') params.delete('look');
      location.search = params.toString();
    };
    el.appendChild(b);
  }
};
mk('scenes', Object.keys(TERRAIN_EXAMPLES), 'scene', sceneName);
mk('cams', ['chase', 'high', 'side', 'far'], 'cam', camMode);

window.__terrain = { run, stage, player: p, hits, rail };

// like StageState._precompile: every program must exist before the flight starts
place(1, 1 / 60);
world.update(0, rig.camera);
await renderer.compileAsync(world.scene, rig.camera);
render(1 / 60);
const progs0 = renderer.info.programs.length;
const flySec = parseFloat(params.get('fly') || '0');

if (shot && flySec > 0) {
  // program check: fly `fly` seconds (rendering once per second) and report shader programs compiled mid-flight
  const names0 = new Set(renderer.info.programs.map((pr) => pr.name + pr.cacheKey.length));
  for (let i = 0; i < flySec * 120; i++) {
    step(1 / 120);
    if (i % 30 === 0) place(1, 0.25);
    if (i % 120 === 119) {
      render(1 / 60);
      await new Promise((r) => setTimeout(r, 30)); // let worker-built chunks arrive
    }
  }
  const fresh = renderer.info.programs.filter((pr) => !names0.has(pr.name + pr.cacheKey.length)).map((pr) => pr.name);
  hud();
  stats.textContent += `\nprograms at start ${progs0}, after ${flySec}s ${renderer.info.programs.length}${fresh.length ? ' NEW: ' + fresh.join(', ') : ''}`;
  document.body.dataset.ready = '1';
} else if (shot) {
  const n = Math.round(warm * 120);
  for (let i = 0; i < n; i++) {
    step(1 / 120);
    if (i % 30 === 0) place(1, 0.25);
  }
  run.streamer.prime(p.s);
  run.obstacles?.update(p.s);
  for (let i = 0; i < 3; i++) {
    place(1, 1 / 60);
    render(1 / 60);
  }
  renderer.info.reset();
  place(1, 1 / 60);
  render(1 / 60);
  hud();
  document.body.dataset.ready = '1';
} else {
  let last = performance.now(), acc = 0;
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt;
    while (acc >= 1 / 120) {
      step(1 / 120);
      acc -= 1 / 120;
    }
    renderer.info.reset();
    place(1, dt);
    render(dt);
    hud();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
