// FX Lab: standalone test bench for src/render/fx mirroring the game's
// pipeline (HDR RenderPass -> Bloom(mipmap, threshold 1) + AgX -> SMAA).
//
// Live:   /labs/fx-lab.html            buttons for every emitter, orbit camera
// Shots:  /labs/fx-lab.html?demo=explosions&t=1.5
//         demo = explosions | surface | combat | trails | afterburner | side | all
//         t    = seconds simulated at a fixed 60 Hz step, then one frame is
//                rendered and document.body.dataset.ready = '1'
//         env  = gold (default) | noon | game (real Sky + Ocean of stage 1)
//         q    = low | medium | high | ultra,  slow=1 -> timeScale 0.3
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode
} from 'postprocessing';
import { FX } from '../src/render/fx/index.js';
import { FX_FIRE_GLSL } from '../src/render/fx/glsl.js';
import { WorldUniforms, WORLD_FOG_PARS, applyWorldFog } from '../src/render/worldUniforms.js';
import { ATMOS_DEFAULTS, atmosphereJS, sunColorJS, sunDirFromAngles } from '../src/world/atmosphere.js';

const params = new URLSearchParams(location.search);
const demo = params.get('demo') || 'all';
const T = params.has('t') ? parseFloat(params.get('t')) : null;
const envName = params.get('env') || 'game';
const quality = params.get('q') || 'high';
const shot = T !== null;
let timeScale = params.get('slow') === '1' ? 0.3 : 1;
if (shot) document.body.classList.add('shot');

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(shot ? 1 : Math.min(devicePixelRatio || 1, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping; // AgX in post
renderer.info.autoReset = false;

let scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1.2, 32000);
let world = null;

// ------------------------------------------------------------------ environment
const ENVS = {
  gold: { elev: 5.5, azim: 28, rayleigh: 1.25, mie: 1.05, mieG: 0.82, sunIntensity: 22, fogDensity: 0.00011, fogFalloff: 0.0012, toneExposure: 0.55 },
  noon: { elev: 38, azim: 150, rayleigh: 1.0, mie: 1.0, mieG: 0.8, sunIntensity: 22, fogDensity: 0.0001, fogFalloff: 0.0014, toneExposure: 0.5 }
};

const SKY_GLSL = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uSunDisc;
vec3 skyColor(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 hflat = normalize(vec3(d.x, 0.0, d.z) + 1e-5);
  vec3 sflat = normalize(vec3(uSunDir.x, 0.0, uSunDir.z) + 1e-5);
  float toward = pow(max(dot(hflat, sflat), 0.0), 3.0);
  vec3 hz = mix(uFogColor, uFogSunColor, toward * 0.85);
  vec3 col = mix(hz, uZenith, pow(h, 0.42));
  float mu = max(dot(d, uSunDir), 0.0);
  col += uFogSunColor * pow(mu, 12.0) * 0.8 * (1.0 - h);
  col += uSunDisc * smoothstep(0.99985, 0.99993, mu);
  return col;
}`;

function setupSimpleEnv(e) {
  const p = { ...ATMOS_DEFAULTS, ...e };
  const sd = sunDirFromAngles(e.elev, e.azim, new THREE.Vector3());
  const sunCol = sunColorJS(sd, p, 200, new THREE.Color());
  WorldUniforms.uSunDir.value.copy(sd);
  WorldUniforms.uSunColor.value.copy(sunCol);
  const d = new THREE.Vector3();
  const away = new THREE.Vector3(-sd.x, 0, -sd.z).normalize();
  const toward = new THREE.Vector3(sd.x, 0, sd.z).normalize();
  const side = new THREE.Vector3(-toward.z, 0, toward.x);
  const c1 = atmosphereJS(d.copy(away).setY(0.04).normalize(), sd, p, 200, new THREE.Color());
  const c2 = atmosphereJS(d.copy(side).setY(0.04).normalize(), sd, p, 200, new THREE.Color());
  const c3 = atmosphereJS(d.copy(side).negate().setY(0.04).normalize(), sd, p, 200, new THREE.Color());
  WorldUniforms.uFogColor.value.copy(c1.add(c2).add(c3).multiplyScalar(1 / 3));
  WorldUniforms.uFogSunColor.value.copy(atmosphereJS(d.copy(toward).setY(0.04).normalize(), sd, p, 200, new THREE.Color()));
  WorldUniforms.uFogDensity.value = e.fogDensity;
  WorldUniforms.uFogHeightFalloff.value = e.fogFalloff;
  WorldUniforms.uFogBaseHeight.value = 0;
  const zenith = atmosphereJS(new THREE.Vector3(0, 1, 0), sd, p, 200, new THREE.Color());
  const sunI = p.sunIntensity;
  const fogU = {
    uSunDir: WorldUniforms.uSunDir, uSunColor: WorldUniforms.uSunColor, uFogColor: WorldUniforms.uFogColor,
    uFogSunColor: WorldUniforms.uFogSunColor, uFogDensity: WorldUniforms.uFogDensity,
    uFogHeightFalloff: WorldUniforms.uFogHeightFalloff, uFogBaseHeight: WorldUniforms.uFogBaseHeight, uFogMax: WorldUniforms.uFogMax,
    uZenith: { value: zenith }, uSunDisc: { value: sunCol.clone().multiplyScalar(sunI * 60) }, uTime: WorldUniforms.uTime
  };
  // sky dome
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: fogU,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir; ${WORLD_FOG_PARS} ${SKY_GLSL} void main(){ gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0); }`
  }));
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.scale.setScalar(30000);
  sky.onBeforeRender = (r, s, cam) => sky.position.copy(cam.position);
  scene.add(sky);
  // sea
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: fogU,
    vertexShader: `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vWP; uniform float uTime; ${WORLD_FOG_PARS} ${SKY_GLSL}
      float h(vec2 p){ return sin(p.x*0.021 + p.y*0.013 + uTime*0.6)*0.6 + sin(p.x*-0.011 + p.y*0.037 - uTime*0.9)*0.4
        + sin(p.x*0.083 + p.y*0.061 + uTime*1.7)*0.18 + sin(p.x*-0.17 + p.y*0.12 + uTime*2.3)*0.08; }
      void main(){
        vec3 V = normalize(vWP - cameraPosition);
        float dist = length(vWP - cameraPosition);
        float e = 1.0;
        float fade = 1.0 - smoothstep(400.0, 6000.0, dist);
        vec2 p = vWP.xz;
        vec3 N = normalize(vec3(-(h(p + vec2(e,0.0)) - h(p)) * 0.9 * fade, 1.0, -(h(p + vec2(0.0,e)) - h(p)) * 0.9 * fade));
        vec3 R = reflect(V, N); R.y = abs(R.y);
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
        vec3 col = vec3(0.004, 0.028, 0.045) * (uSunColor * 1.2 + uFogColor * 0.3) + skyColor(R) * fres;
        col += uSunColor * 90.0 * pow(max(dot(R, uSunDir), 0.0), 900.0);
        gl_FragColor = vec4(applyWorldFog(col, vWP), 1.0);
      }`
  }));
  sea.frustumCulled = false;
  sea.renderOrder = -10;
  sea.onBeforeRender = (r, s, cam) => { sea.position.x = cam.position.x; sea.position.z = cam.position.z; sea.updateMatrixWorld(); };
  scene.add(sea);
  const sun = new THREE.DirectionalLight(sunCol, sunI * 0.16);
  sun.position.copy(sd).multiplyScalar(1000);
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x0a1a24, 0.7));
  renderer.toneMappingExposure = e.toneExposure;
  return sunI * 0.16;
}

async function setupGameEnv() {
  const { World } = await import('../src/world/world.js');
  const { PRESETS } = await import('../src/core/quality.js');
  const stage = (await import('../src/stages/stage1_ocean.js')).default;
  world = new World(renderer, { ...PRESETS.high, shadows: 0 }, camera);
  world.configure(stage.env);
  scene = world.scene;
  renderer.toneMappingExposure = stage.env.toneExposure ?? 0.55;
  scene.add(new THREE.HemisphereLight(0x8899aa, 0x0a1a24, 0.4));
  return world.sun.intensity;
}

// ------------------------------------------------------------------ post (mirrors the game)
function makeComposer() {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, intensity: 0.9, radius: 0.72, levels: 8 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  composer.addPass(new EffectPass(camera, bloom, tone));
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  return composer;
}

// ------------------------------------------------------------------ dummy jet
function makeJet() {
  const g = new THREE.Group();
  const mat = applyWorldFog(new THREE.MeshStandardMaterial({ color: 0x7d868f, metalness: 0.45, roughness: 0.45 }));
  const dark = applyWorldFog(new THREE.MeshStandardMaterial({ color: 0x2a2e33, metalness: 0.6, roughness: 0.35 }));
  const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
  add(new THREE.BoxGeometry(2.0, 1.4, 13), mat, 0, 0, 0.5);
  const nose = add(new THREE.ConeGeometry(0.95, 4.5, 12), mat, 0, 0, -8.2);
  nose.rotation.x = -Math.PI / 2;
  add(new THREE.BoxGeometry(12.5, 0.22, 4.2), mat, 0, 0, 1.6);
  add(new THREE.BoxGeometry(6.4, 0.18, 2.0), mat, 0, 0, 6.3);
  for (const s of [-1, 1]) {
    const fin = add(new THREE.BoxGeometry(0.18, 2.8, 2.4), mat, s * 1.25, 1.6, 5.4);
    fin.rotation.z = s * 0.35;
    const nac = add(new THREE.CylinderGeometry(0.56, 0.62, 5.5, 16, 1, true), dark, s * 0.58, -0.1, 5.3);
    nac.rotation.x = Math.PI / 2;
  }
  add(new THREE.BoxGeometry(0.9, 0.7, 2.8), applyWorldFog(new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.9, roughness: 0.1 })), 0, 0.9, -4.5);
  return g;
}
const NOZZLES = [
  { position: new THREE.Vector3(-0.58, -0.1, 8.0), radius: 0.46, direction: new THREE.Vector3(0, 0, 1) },
  { position: new THREE.Vector3(0.58, -0.1, 8.0), radius: 0.46, direction: new THREE.Vector3(0, 0, 1) }
];

// ------------------------------------------------------------------ scenario
let fx;
let composer;
let simTime = 0;
let worldTime = 0;
const events = [];
const actors = [];
const at = (t, fn) => events.push({ t, fn, done: false });
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ui = { throttle: 0.8, ab: 1, vapor: 0, dist: 300, tracers: false, emitter: null, missile: null, paused: false };

function missileCircler(center, radius, speed, phase = 0, kind = 'missile', tilt = 0.25) {
  const pos = new THREE.Vector3();
  const trail = fx.createTrail({ kind });
  const w = speed / radius;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3, 8).rotateX(Math.PI / 2),
    applyWorldFog(new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 })));
  scene.add(body);
  const a = {
    trail, body,
    update(t) {
      const ang = phase + t * w;
      pos.set(center.x + Math.cos(ang) * radius, center.y + Math.sin(ang * 2) * radius * tilt * 0.3 + Math.sin(ang) * radius * tilt, center.z + Math.sin(ang) * radius);
      body.position.copy(pos);
      body.lookAt(center.x + Math.cos(ang + 0.05) * radius, pos.y, center.z + Math.sin(ang + 0.05) * radius);
      trail.push(pos);
    }
  };
  actors.push(a);
  return a;
}

function linearMover(p0, vel, onUpdate) {
  const pos = p0.clone();
  const a = { pos, vel, update(t) { pos.copy(p0).addScaledVector(vel, t - a.t0); onUpdate && onUpdate(pos, t); }, t0: 0 };
  actors.push(a);
  return a;
}

function makeTracerStream(gun, target, rate = 90) {
  const max = 512;
  const P = new Float32Array(max * 3), Vv = new Float32Array(max * 3), born = new Float32Array(max).fill(-10);
  const origin = new Float32Array(max * 3);
  let head = 0, acc = 0;
  const dir = new THREE.Vector3();
  const s = {
    enabled: true,
    update(t, dt) {
      if (s.enabled) {
        acc += dt * rate;
        while (acc >= 1) {
          acc -= 1;
          dir.copy(target()).sub(gun()).normalize();
          dir.x += (Math.random() - 0.5) * 0.012; dir.y += (Math.random() - 0.5) * 0.012;
          dir.normalize().multiplyScalar(1050);
          const g = gun();
          origin.set([g.x, g.y, g.z], head * 3);
          Vv.set([dir.x, dir.y, dir.z], head * 3);
          born[head] = t;
          head = (head + 1) % max;
        }
      }
      let n = 0;
      for (let i = 0; i < max; i++) {
        const age = t - born[i];
        if (age < 0 || age > 1.2) continue;
        P[n * 3] = origin[i * 3] + Vv[i * 3] * age;
        P[n * 3 + 1] = origin[i * 3 + 1] + Vv[i * 3 + 1] * age;
        P[n * 3 + 2] = origin[i * 3 + 2] + Vv[i * 3 + 2] * age;
        n++;
      }
      // compact velocities to match
      let m = 0;
      const tmpV = s._v || (s._v = new Float32Array(max * 3));
      for (let i = 0; i < max; i++) {
        const age = t - born[i];
        if (age < 0 || age > 1.2) continue;
        tmpV[m * 3] = Vv[i * 3]; tmpV[m * 3 + 1] = Vv[i * 3 + 1]; tmpV[m * 3 + 2] = Vv[i * 3 + 2];
        m++;
      }
      fx.tracers.setData(P, tmpV, n);
    }
  };
  actors.push(s);
  return s;
}

let jet = null, ab = null;
function addJet(pos) {
  jet = makeJet();
  jet.position.copy(pos);
  scene.add(jet);
  ab = fx.createAfterburner(NOZZLES);
  jet.add(ab.object);
  ab.set(ui.throttle, ui.ab);
  return jet;
}

function setupDemo(name) {
  switch (name) {
    case 'explosions': {
      camera.position.set(0, 72, 40);
      camera.lookAt(0, 80, -300);
      at(0.0, () => fx.explosion(V(-62, 76, -150), { size: 1, vel: V(20, 0, -120), seed: 11 }));
      at(0.0, () => fx.explosion(V(95, 110, -430), { size: 1, kind: 'big', vel: V(-20, 0, -60), seed: 22 }));
      at(0.0, () => fx.explosion(V(12, 62, -70), { size: 1, kind: 'missile', seed: 33 }));
      break;
    }
    case 'swatch': {
      // calibration: fire ramp (top), and three alternative ramps below, heat 0..1 left to right
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      const mat = new THREE.ShaderMaterial({
        depthTest: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: FX_FIRE_GLSL + `varying vec2 vUv;
          void main(){
            float h = floor(vUv.x * 12.0) / 11.0;
            float row = floor(vUv.y * 4.0);
            vec3 c = fxFireRamp(h);
            if (row == 2.0) {
              c = mix(vec3(0.25, 0.03, 0.004), vec3(1.0, 0.2, 0.018), smoothstep(0.0, 0.45, h));
              c = mix(c, vec3(1.9, 1.1, 0.25), smoothstep(0.45, 0.72, h));
              c = mix(c, vec3(9.0, 7.0, 3.8), smoothstep(0.72, 1.0, h));
              c *= smoothstep(0.0, 0.1, h);
            }
            if (row == 1.0) {
              c = mix(vec3(0.3, 0.025, 0.003), vec3(1.4, 0.28, 0.02), smoothstep(0.0, 0.5, h));
              c = mix(c, vec3(2.6, 1.9, 0.5), smoothstep(0.5, 0.78, h));
              c = mix(c, vec3(10.0, 8.5, 5.0), smoothstep(0.78, 1.0, h));
              c *= smoothstep(0.0, 0.1, h);
            }
            if (row == 0.0) c = vec3(1.0, 0.22, 0.02) * pow(2.0, h * 6.0 - 3.0);
            gl_FragColor = vec4(c, 1.0);
          }`
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(14, 6), mat);
      m.renderOrder = 100;
      scene.add(m);
      break;
    }
    case 'beam': {
      // canyon-style searchlights sweeping over the water
      camera.position.set(0, 40, 60);
      camera.lookAt(0, 70, -250);
      for (let i = 0; i < 4; i++) {
        const b = fx.createBeam({ length: 700, radius: 45, color: i === 3 ? 0xff5533 : 0xfff0d8 });
        b.object.position.set(-240 + i * 160, 0, -380 - i * 40);
        scene.add(b.object);
        b.setIntensity(i === 3 ? 2.0 : 1.4);
        actors.push({ update(t) { b.object.rotation.set(Math.PI / 2 + 0.5 + 0.35 * Math.sin(t * 0.7 + i), 0, 0.4 * Math.sin(t * 0.5 + i * 1.7)); } });
      }
      break;
    }
    case 'closeup': {
      // one fighter kill at 70 m, slightly side-lit
      camera.position.set(0, 70, 0);
      camera.lookAt(-10, 72, -70);
      at(0.0, () => fx.explosion(V(-12, 72, -70), { size: 1, vel: V(40, 0, -60), seed: 11 }));
      break;
    }
    case 'surface': {
      camera.position.set(0, 35, 60);
      camera.lookAt(0, 30, -300);
      at(0.0, () => fx.explosion(V(-80, 0, -220), { size: 1, kind: 'water', seed: 4 }));
      at(0.0, () => fx.waterSplash(V(70, 0, -180), 1.2));
      at(0.0, () => fx.explosion(V(30, 0, -480), { size: 1.2, kind: 'ground', seed: 5 }));
      break;
    }
    case 'combat': {
      camera.position.set(0, 64, 30);
      camera.lookAt(0, 62, -200);
      const target = new THREE.Mesh(new THREE.BoxGeometry(10, 2, 14), applyWorldFog(new THREE.MeshStandardMaterial({ color: 0x556070, metalness: 0.4, roughness: 0.5 })));
      target.position.set(18, 60, -190);
      scene.add(target);
      const hit = new THREE.Vector3();
      let acc = 0;
      actors.push({ update(t, dt) { acc += dt; while (acc > 0.07) { acc -= 0.07; hit.set(18 + (Math.random() - 0.5) * 6, 60 + (Math.random() - 0.5) * 1.5, -183 + (Math.random() - 0.5) * 4); fx.hitSparks(hit, V(0.1, 0, -1), 12); } } });
      const gun = V(-6, 58, 10);
      makeTracerStream(() => gun, () => target.position, 90);
      let macc = 0;
      actors.push({ update(t, dt) { macc += dt; while (macc > 1 / 30) { macc -= 1 / 30; fx.muzzleFlash(gun, V(0.12, 0.01, -1).normalize()); } } });
      at(0.0, () => fx.flareBurst(V(-90, 85, -260), V(230, 0, -40)));
      at(0.0, () => fx.debris(V(-40, 72, -150), V(0, 0, -50), 10));
      at(0.05, () => fx.shockRing(V(120, 95, -520), 60));
      const wreck = linearMover(V(140, 150, -420), V(-45, -22, 20));
      const em = fx.createSmokeEmitter({ fire: true });
      actors.push({ update() { em.update(wreck.pos, wreck.vel, 1); } });
      break;
    }
    case 'trails': {
      camera.position.set(0, 80, 30);
      camera.lookAt(0, 82, -200);
      // circling missile ~130-310 m away, a fire trail further out
      missileCircler(V(-20, 88, -220), 90, 260, 0.6, 'missile');
      missileCircler(V(160, 110, -520), 90, 220, 2, 'fire', 0.5);
      // player's missile: launched just ahead of the camera, accelerating away with a lazy S-curve
      const mp = new THREE.Vector3();
      const mTrail = fx.createTrail({ kind: 'missile' });
      actors.push({ update(t) { const d = 60 * t + 90 * t * t; mp.set(6 + Math.sin(t * 1.7) * 12 * t, 76 + 8 * t, 5 - d); mTrail.push(mp); } });
      // high contrail, crossing damaged jet with a smoke trail, low jet with wingtip vortices
      const cjet = linearMover(V(-600, 380, -900), V(260, 0, 0));
      const con = fx.createTrail({ kind: 'contrail' });
      const vl = fx.createTrail({ kind: 'vortex' }), vr = fx.createTrail({ kind: 'vortex' });
      const vj = linearMover(V(-220, 70, -90), V(240, 3, 0));
      const smk = fx.createTrail({ kind: 'smoke' });
      const sj = linearMover(V(250, 150, -300), V(-120, -18, 10));
      const tmp = new THREE.Vector3();
      actors.push({
        update() {
          con.push(cjet.pos);
          vl.push(tmp.copy(vj.pos).add(V(0, 0, -6.2)));
          vr.push(tmp.copy(vj.pos).add(V(0, 0, 6.2)));
          smk.push(sj.pos);
        }
      });
      break;
    }
    case 'afterburner':
    case 'side': {
      addJet(V(0, 60, 0));
      if (name === 'side') {
        camera.position.set(9, 60.8, 11.5);
        camera.lookAt(0, 59.9, 11.5);
      } else if (params.get('view') === 'quarter') {
        camera.position.set(22, 68, 26);
        camera.lookAt(0, 60, 2);
      } else {
        camera.position.set(0, 64.2, 17);
        camera.lookAt(0, 61.5, -90);
      }
      ui.throttle = params.has('thr') ? parseFloat(params.get('thr')) : 1;
      ui.ab = params.has('ab') ? parseFloat(params.get('ab')) : 1;
      ab.set(ui.throttle, ui.ab);
      if (name === 'afterburner') ui.vapor = params.has('vapor') ? parseFloat(params.get('vapor')) : 0.85;
      break;
    }
    case 'atlas': {
      // debug: show the procedural atlas (left) and noise (right)
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      const mk = (tex, x, alphaView) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.ShaderMaterial({
          uniforms: { t: { value: tex } }, depthTest: false,
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: alphaView
            ? 'uniform sampler2D t; varying vec2 vUv; void main(){ vec4 c = texture2D(t, vUv); gl_FragColor = vec4(c.r, c.a * c.r, c.g * c.r, 1.0); }'
            : 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(t, vUv).rgb, 1.0); }'
        }));
        m.position.set(x, 0, 0);
        m.renderOrder = 100;
        scene.add(m);
      };
      mk(fx.textures.atlas, -3.7, true);
      mk(fx.textures.atlas, 3.7, false);
      camera.position.set(0, 0, 9.5);
      break;
    }
    default: {
      // 'all': chase view + explosions ahead + circling missile + tracers
      addJet(V(0, 60, 0));
      camera.position.set(0, 64.2, 17);
      camera.lookAt(0, 61.5, -90);
      missileCircler(V(-30, 90, -380), 120, 280, 0, 'missile');
      at(0.0, () => fx.explosion(V(-60, 75, -420), { size: 1, vel: V(0, 0, -150), seed: 7 }));
      at(0.35, () => fx.explosion(V(90, 95, -700), { size: 1, kind: 'big', seed: 8 }));
      const gun = V(-1.2, 60.3, -8);
      const tgt = V(-20, 70, -600);
      ui.tracers = true;
      ui.tracerStream = makeTracerStream(() => gun, () => tgt, 60);
    }
  }
}

// ------------------------------------------------------------------ loop
function step(dt) {
  simTime += dt;
  const wdt = dt * timeScale;
  worldTime += wdt;
  WorldUniforms.uTime.value = worldTime;
  WorldUniforms.uRealTime.value = simTime;
  for (const e of events) if (!e.done && e.t <= worldTime) { e.done = true; e.fn(); }
  for (const a of actors) a.update(worldTime, wdt);
  if (ab) ab.set(ui.throttle, ui.ab);
  if (jet) fx.vaporCone(jet, ui.vapor);
  fx.update(dt, worldTime, camera);
  if (world) world.update(dt, camera);
}

function render() {
  renderer.info.reset();
  composer.render(1 / 60);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ UI
function spawnPoint(out) {
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  return out.copy(camera.position).addScaledVector(d, ui.dist);
}
function buildUI(controls) {
  const btns = document.getElementById('buttons');
  const p = new THREE.Vector3();
  const B = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => fn(spawnPoint(p)); btns.appendChild(b); return b; };
  B('Air', (q) => fx.explosion(q, { size: 1 }));
  B('Big', (q) => fx.explosion(q, { size: 1, kind: 'big' }));
  B('Missile', (q) => fx.explosion(q, { kind: 'missile' }));
  B('Ground', (q) => fx.explosion(q.setY(0), { kind: 'ground' }));
  B('Water', (q) => fx.explosion(q.setY(0), { kind: 'water' }));
  B('Splash', (q) => fx.waterSplash(q.setY(0), 1));
  B('Hit sparks', (q) => { for (let i = 0; i < 6; i++) setTimeout(() => fx.hitSparks(q, V(0, 0, -1)), i * 60); });
  B('Smoke puff', (q) => fx.smokePuff(q, V(0, 2, 0), 6, 3));
  B('Debris', (q) => fx.debris(q, V(0, 0, 0), 10));
  B('Muzzle', (q) => fx.muzzleFlash(q, V(0, 0, -1)));
  B('Flares', (q) => fx.flareBurst(q, V(200, 0, -80)));
  B('Shock ring', (q) => fx.shockRing(q, 60));
  const tg = document.getElementById('toggles');
  const T = (label, get, set) => { const b = document.createElement('button'); b.textContent = label; const sync = () => b.classList.toggle('on', !!get()); b.onclick = () => { set(!get()); sync(); }; sync(); tg.appendChild(b); };
  T('Slow-mo 0.3', () => timeScale < 1, (v) => (timeScale = v ? 0.3 : 1));
  T('Pause', () => ui.paused, (v) => (ui.paused = v));
  T('Smoke emitter', () => !!ui.emitter, (v) => {
    if (v) {
      const em = fx.createSmokeEmitter({ fire: true });
      const mv = linearMover(spawnPoint(new THREE.Vector3()).add(V(0, 60, 0)), V(-50, -18, 25));
      mv.t0 = worldTime;
      ui.emitter = { em, mv, a: { update() { em.update(mv.pos, mv.vel, 1); } } };
      actors.push(ui.emitter.a);
    } else if (ui.emitter) {
      ui.emitter.em.stop();
      actors.splice(actors.indexOf(ui.emitter.a), 1);
      actors.splice(actors.indexOf(ui.emitter.mv), 1);
      ui.emitter = null;
    }
  });
  T('Missile', () => !!ui.missile, (v) => {
    if (v) ui.missile = missileCircler(V(0, 90, -300), 120, 280, 0, 'missile');
    else if (ui.missile) { ui.missile.trail.stop(); scene.remove(ui.missile.body); actors.splice(actors.indexOf(ui.missile), 1); ui.missile = null; }
  });
  T('Tracers', () => ui.tracers, (v) => {
    ui.tracers = v;
    if (v && !ui.tracerStream) {
      const gun = V(-1.2, 60.3, -8), tgt = V(-20, 70, -600);
      ui.tracerStream = makeTracerStream(() => (jet ? gun : camera.position), () => tgt, 60);
    }
    if (ui.tracerStream) ui.tracerStream.enabled = v;
  });
  T('Panel', () => true, () => document.getElementById('panel').classList.add('hidden'));
  const slider = (id, key) => { const el = document.getElementById(id); el.value = ui[key]; el.oninput = () => (ui[key] = parseFloat(el.value)); };
  slider('throttle', 'throttle');
  slider('ab', 'ab');
  slider('vapor', 'vapor');
  slider('dist', 'dist');
  addEventListener('keydown', (e) => { if (e.key === 'h') document.getElementById('panel').classList.toggle('hidden'); });
  void controls;
}

// ------------------------------------------------------------------ boot
async function main() {
  const sunLight = envName === 'game' ? await setupGameEnv() : setupSimpleEnv(ENVS[envName] || ENVS.gold);
  fx = new FX({ scene, renderer, quality });
  fx.setLighting(sunLight, 0.55);
  composer = makeComposer();
  resize();
  addEventListener('resize', resize);
  setupDemo(demo);
  if (world) world.update(0, camera);

  fx.warmup();
  await renderer.compileAsync(scene, camera);
  window.__fx = fx;
  window.__lab = { renderer, scene, camera, get worldTime() { return worldTime; } };

  if (shot) {
    const dt = 1 / 60;
    const n = Math.round(T / dt);
    for (let i = 0; i < n; i++) step(dt);
    if (n === 0) step(0);
    render();
    const info = renderer.info.render;
    window.__shot = { calls: info.calls, triangles: info.triangles, stats: fx.stats(), worldTime };
    document.body.dataset.ready = '1';
    return;
  }

  // read the demo's view direction before OrbitControls re-aims the camera at its default target
  const tgt = new THREE.Vector3();
  camera.getWorldDirection(tgt);
  const focus = camera.position.clone().addScaledVector(tgt, jet ? 30 : 250);
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(focus);
  controls.update();
  buildUI(controls);
  const perf = document.getElementById('perf');
  let last = performance.now(), fpsS = 60, acc = 0;
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!ui.paused) step(dt);
    render();
    fpsS += (1 / Math.max(dt, 1e-3) - fpsS) * 0.05;
    if ((acc += dt) > 0.25) {
      acc = 0;
      const s = fx.stats();
      const i = renderer.info.render;
      perf.textContent = `fps ${fpsS.toFixed(0)}  world x${timeScale}\ncalls ${i.calls}  tris ${i.triangles}\nfx calls ${s.drawCalls}\nparticles ${s.particles} (smoke ${s.smoke} / add ${s.additive})\ntrails ${s.trails}  emitters ${s.emitters}\nquality ${fx.quality}`;
    }
    requestAnimationFrame(frame);
  };
  document.body.dataset.ready = '1';
  requestAnimationFrame(frame);
}

main().catch((e) => {
  console.error(e);
  document.body.dataset.ready = 'error';
});
