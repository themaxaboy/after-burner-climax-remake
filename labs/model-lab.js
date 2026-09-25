// Standalone viewer for the procedural aircraft / vehicle models.
// Query params: ?id=f14d&scheme=camo&lod=0&cam=front|side|top|threeq|rear|below
//               &ui=0 (hide panel) &ab=0..1 &speed=0..1 &roll= &pitch= &yaw= &flaps= &gear=0..1 &env=sky|room
//               &zoom= &tx=&ty=&tz= (camera target) &instanced=N (InstancedMesh preview) &bench=1

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  AIRCRAFT_IDS,
  VEHICLE_IDS,
  SCHEMES,
  PLAYER_JETS,
  buildAircraft,
  buildAircraftGeometry,
  buildVehicle,
  createAircraftMaterials,
  clearModelCache,
  prebuildAll,
  getModelInfo
} from '../src/models/aircraftBuilder.js';
import { applyWorldFog, WorldUniforms } from '../src/render/worldUniforms.js';

const qs = new URLSearchParams(location.search);
const STILL = (qs.get('ui') === '0' || qs.get('still') === '1') && qs.get('still') !== '0';
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer --
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

// --------------------------------------------------------------- lighting ---
const SUN_DIR = new THREE.Vector3(0.55, 0.75, -0.38).normalize();

function skyEnvironment() {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSun: { value: SUN_DIR } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSun;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 zenith = vec3(0.10, 0.22, 0.52);
        vec3 horizon = vec3(0.72, 0.78, 0.86);
        vec3 ground = vec3(0.16, 0.15, 0.14);
        vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.55)) : mix(horizon * 0.55, ground, pow(-h, 0.4));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.85, 0.65) * (pow(s, 8.0) * 0.5 + pow(s, 900.0) * 60.0);
        gl_FragColor = vec4(col, 1.0);
      }`
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), mat));
  return envScene;
}

const pmrem = new THREE.PMREMGenerator(renderer);
const envKind = qs.get('env') || 'sky';
const envTex =
  envKind === 'room'
    ? pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    : pmrem.fromScene(skyEnvironment(), 0.0).texture;
scene.environment = envTex;
scene.background = envTex;
scene.backgroundBlurriness = 0.45;
scene.backgroundIntensity = 0.85;
scene.environmentIntensity = 0.9;

const sun = new THREE.DirectionalLight(0xfff1e0, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun, sun.target);
WorldUniforms.uSunDir.value.copy(SUN_DIR);
WorldUniforms.uFogDensity.value = 0.00002;

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1, 96),
  new THREE.MeshStandardMaterial({ color: 0x5d6064, roughness: 0.92, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// ------------------------------------------------------------------- UI -----
const ALL = [...AIRCRAFT_IDS, ...VEHICLE_IDS];
for (const id of ALL) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = PLAYER_JETS.find((p) => p.id === id)?.name || getModelInfo(id).name;
  $('id').appendChild(o);
}
const state = { roll: 0, pitch: 0, yaw: 0, speed01: 0, flaps: 0, gear: 0, time: 0, afterburner: 0 };
const params = {
  id: qs.get('id') || 'f14d',
  scheme: qs.get('scheme') || null,
  lod: Number(qs.get('lod') || 0),
  cam: qs.get('cam') || 'threeq'
};
for (const k of ['roll', 'pitch', 'yaw', 'flaps', 'gear']) if (qs.has(k)) state[k] = Number(qs.get(k));
if (qs.has('speed')) state.speed01 = Number(qs.get('speed'));
if (qs.has('ab')) state.afterburner = Number(qs.get('ab'));
if (qs.get('ui') === '0') $('ui').classList.add('hidden');

function schemesFor(id) {
  const info = getModelInfo(id);
  return AIRCRAFT_IDS.slice(0, 3).includes(id) ? SCHEMES : info.schemes;
}

function fillSchemes() {
  const sel = $('scheme');
  sel.innerHTML = '';
  for (const s of schemesFor(params.id)) {
    const o = document.createElement('option');
    o.value = o.textContent = s;
    sel.appendChild(o);
  }
  if (!params.scheme || !schemesFor(params.id).includes(params.scheme)) params.scheme = getModelInfo(params.id).defaultScheme;
  sel.value = params.scheme;
}

let current = null;
let buildMs = 0;
const INSTANCES = Number(qs.get('instanced') || 0);

/** ?instanced=N: static merged geometry + lite materials in InstancedMeshes (enemy path). */
function buildInstanced(id, opts, n) {
  const geo = buildAircraftGeometry(id, opts.lod);
  const materials = createAircraftMaterials(id, opts.scheme, { instanced: true });
  const root = new THREE.Group();
  const cols = Math.ceil(Math.sqrt(n));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  for (const slot of ['body', 'glass', 'emissive', 'metal']) {
    if (!geo[slot]) continue;
    const mesh = new THREE.InstancedMesh(geo[slot], materials[slot], n);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      p.set((c - (cols - 1) / 2) * geo.span * 1.3, (i % 3) * geo.radius * 0.15, r * geo.length * 1.2);
      q.setFromEuler(new THREE.Euler(0, 0, (i % 5) * 0.2 - 0.4));
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    mesh.castShadow = slot !== 'emissive';
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const radius = geo.radius * cols * 1.2;
  return {
    root,
    materials,
    radius,
    length: geo.length,
    span: geo.span,
    triangles: geo.triangles * n,
    animate() {},
    dispose() {
      root.removeFromParent();
    }
  };
}

function load() {
  if (current) current.dispose();
  const t0 = performance.now();
  const opts = { lod: params.lod, scheme: params.scheme };
  if (INSTANCES > 0) current = buildInstanced(params.id, opts, INSTANCES);
  else current = AIRCRAFT_IDS.includes(params.id) ? buildAircraft(params.id, opts) : buildVehicle(params.id, opts);
  buildMs = performance.now() - t0;
  for (const m of Object.values(current.materials)) {
    if (!m.userData.__fog) {
      applyWorldFog(m);
      m.userData.__fog = true;
    }
    m.wireframe = $('wire').checked;
  }
  const r = current.radius;
  // float the model above the ground so the shadow reads (or stand it on its gear)
  const box = new THREE.Box3().setFromObject(current.root);
  const onGear = current.gearContactY != null && state.gear > 0.99;
  const groundY = onGear
    ? current.gearContactY
    : box.min.y - (VEHICLE_IDS.includes(params.id) && params.id !== 'missile' ? 0 : Math.max(1.2, r * 0.12));
  ground.position.y = params.id === 'destroyer' ? -0.5 : groundY;
  ground.scale.setScalar(r * 12);
  ground.visible = params.id !== 'destroyer' || true;
  scene.add(current.root);
  const s = sun.shadow.camera;
  s.left = s.bottom = -r * 1.25;
  s.right = s.top = r * 1.25;
  s.near = 0.5;
  s.far = r * 6;
  s.updateProjectionMatrix();
  sun.position.copy(SUN_DIR).multiplyScalar(r * 3);
  sun.target.position.set(0, 0, 0);
  camera.near = Math.max(0.05, r * 0.01);
  camera.far = r * 200;
  camera.updateProjectionMatrix();
  setCam(params.cam);
  $('title').textContent = PLAYER_JETS.find((p) => p.id === params.id)?.name || getModelInfo(params.id).name.toUpperCase();
  const u = new URL(location.href);
  u.searchParams.set('id', params.id);
  u.searchParams.set('scheme', params.scheme);
  u.searchParams.set('lod', params.lod);
  u.searchParams.set('cam', params.cam);
  history.replaceState(null, '', u);
}

function setCam(kind) {
  const r = current.radius;
  const c = new THREE.Vector3(0, 0, 0);
  const views = {
    front: [0, r * 0.18, -r * 2.5],
    side: [r * 2.75, r * 0.12, 0],
    top: [0, r * 3.1, 0.001],
    threeq: [r * 1.55, r * 0.62, -r * 1.75],
    rear: [r * 1.0, r * 0.45, r * 2.2],
    below: [r * 1.4, -r * 0.9, -r * 1.3]
  };
  const v = views[kind] || views.threeq;
  const zoom = Number(qs.get('zoom') || 1);
  if (qs.has('tx')) c.set(Number(qs.get('tx')), Number(qs.get('ty') || 0), Number(qs.get('tz') || 0));
  camera.position.set(v[0] * zoom, v[1] * zoom, v[2] * zoom).add(c);
  controls.target.copy(c);
  controls.update();
}

$('id').value = params.id;
$('lod').value = String(params.lod);
$('cam').value = params.cam;
fillSchemes();
for (const k of ['roll', 'pitch', 'yaw', 'speed01', 'flaps', 'gear']) $(k).value = state[k];
$('ab').value = state.afterburner;

$('id').onchange = (e) => {
  params.id = e.target.value;
  params.scheme = null;
  fillSchemes();
  load();
};
$('scheme').onchange = (e) => {
  params.scheme = e.target.value;
  load();
};
$('lod').onchange = (e) => {
  params.lod = Number(e.target.value);
  load();
};
$('cam').onchange = (e) => {
  params.cam = e.target.value;
  setCam(params.cam);
};
for (const k of ['roll', 'pitch', 'yaw', 'speed01', 'flaps', 'gear']) $(k).oninput = (e) => (state[k] = Number(e.target.value));
$('ab').oninput = (e) => (state.afterburner = Number(e.target.value));
$('wire').onchange = (e) => {
  for (const m of Object.values(current.materials)) m.wireframe = e.target.checked;
};

load();

// ?bench=1: time a cold build of every design at LOD0 (budget < 400 ms)
let bench = null;
if (qs.get('bench') === '1') {
  clearModelCache();
  const t0 = performance.now();
  const per = prebuildAll(0);
  bench = { totalMs: performance.now() - t0, per };
  console.info('[model-lab] LOD0 build of all designs:', bench.totalMs.toFixed(1), 'ms', per);
  load();
}

// ----------------------------------------------------------------- loop -----
window.__lab = { ready: false, frames: 0, bench, get current() { return current; } };
const clock = new THREE.Timer();
let fpsAcc = 0;
let fpsFrames = 0;
let fps = 0;
let statsT = 1;

function frame() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.1);
  state.time += dt;
  WorldUniforms.uTime.value = state.time;
  WorldUniforms.uRealTime.value = state.time;
  if ($('spin').checked) current.root.rotation.y += dt * 0.3;
  current.animate(state);
  controls.update();
  renderer.render(scene, camera);
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc > 0.5) {
    fps = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
  }
  statsT += dt;
  if (statsT > 0.25) {
    statsT = 0;
    const info = renderer.info.render;
    $('stats').textContent =
      `model tris   ${current.triangles}\n` +
      `drawn tris   ${info.triangles}\n` +
      `draw calls   ${info.calls}\n` +
      `build ms     ${buildMs.toFixed(1)}\n` +
      `radius       ${current.radius.toFixed(2)} m\n` +
      `len x span   ${current.length.toFixed(1)} x ${current.span.toFixed(1)} m\n` +
      `fps          ${fps.toFixed(0)}` +
      (bench ? `\nall LOD0     ${bench.totalMs.toFixed(0)} ms` : '');
  }
  window.__lab.frames++;
  if (window.__lab.frames > 2) window.__lab.ready = true;
  // screenshot mode (?ui=0): stop after a few frames so capture is cheap on CPU GL
  if (STILL && window.__lab.ready) return;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
