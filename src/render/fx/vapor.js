// Transonic vapor cone: a translucent bell-shaped shell around the fuselage
// (local +Z = aft), sharp shock front, streaky condensation flowing aft,
// opaque at grazing angles. Premultiplied alpha, lit by the sun.
import {
  AddEquation, BufferAttribute, BufferGeometry, CustomBlending, DoubleSide, Mesh, OneFactor, OneMinusSrcAlphaFactor,
  ShaderMaterial
} from 'three';
import { WORLD_FOG_PARS } from '../worldUniforms.js';

const VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
void main() {
  vUv = uv;
  vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal); // non-uniform scale
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = /* glsl */ `
uniform float uStrength;
uniform float uFxTime;
uniform float uFxSun;
uniform float uFxAmbient;
uniform sampler2D uNoise;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWP;
${WORLD_FOG_PARS}
void main() {
  float u = vUv.y; // 0 = shock front, 1 = aft end
  float front = smoothstep(0.0, 0.1, u) * (1.0 + 0.6 * exp(-u * 12.0));
  float back = pow(1.0 - u, 2.2);
  float t = uFxTime;
  float s1 = texture2D(uNoise, vec2(vUv.x * 3.0, u * 0.3 - t * 1.4)).r;
  float s2 = texture2D(uNoise, vec2(vUv.x * 9.0 + 0.3, u * 0.7 - t * 2.3)).g;
  float streak = smoothstep(0.3, 0.85, s1 * 0.65 + s2 * 0.55);
  vec3 V = normalize(cameraPosition - vWP);
  float fres = 1.0 - abs(dot(normalize(vN), V));
  fres = 0.2 + 0.8 * pow(fres, 1.6);
  float a = clamp(uStrength * front * back * (0.25 + 0.75 * streak) * fres * 1.1, 0.0, 0.7);
  float ndl = dot(normalize(vN), uSunDir) * 0.5 + 0.5;
  vec3 lit = vec3(0.92, 0.95, 1.0) * (uSunColor * uFxSun * (0.4 + 0.6 * ndl) + uFogColor * uFxAmbient * 1.2);
  lit = applyWorldFog(lit, vWP);
  gl_FragColor = vec4(lit * a, a);
}`;

function bellGeometry(radial = 36, rings = 14) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const rad = 0.22 + 0.78 * Math.pow(v, 0.8);
    const drdv = v > 0 ? 0.78 * 0.8 * Math.pow(v, -0.2) : 2;
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(c * rad, sn * rad, v);
      // normal of the lathe surface (profile slope)
      const nx = c, ny = sn, nz = -drdv * 0.5;
      const l = Math.hypot(nx, ny, nz);
      nrm.push(nx / l, ny / l, nz / l);
      uv.push(s / radial, v);
    }
  }
  const w = radial + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * w + s, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class VaporCone {
  constructor({ uniforms, noise }) {
    this.geometry = bellGeometry();
    this.uniforms = {
      uStrength: { value: 0 },
      uFxTime: uniforms.uFxTime,
      uFxSun: uniforms.uFxSun,
      uFxAmbient: uniforms.uFxAmbient,
      uNoise: { value: noise },
      ...uniforms.fog
    };
    this.material = new ShaderMaterial({
      name: 'fxVaporCone',
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'fxVaporCone';
    this.mesh.renderOrder = 13;
    this.mesh.visible = false;
    this.target = 0;
    this.value = 0;
    this.parent = null;
    this.placement = { z: -4.5, length: 11, radius: 5.5 };
  }

  set(object3D, strength, opts) {
    this.target = strength < 0 ? 0 : strength > 1 ? 1 : strength;
    if (opts) {
      if (opts.z !== undefined) this.placement.z = opts.z;
      if (opts.length !== undefined) this.placement.length = opts.length;
      if (opts.radius !== undefined) this.placement.radius = opts.radius;
    }
    if (object3D && object3D !== this.parent) {
      object3D.add(this.mesh);
      this.parent = object3D;
    }
    const p = this.placement;
    this.mesh.position.set(0, 0, p.z);
    this.mesh.scale.set(p.radius, p.radius, p.length);
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * (this.target > this.value ? 10 : 4));
    this.value += (this.target - this.value) * k;
    if (this.value < 0.003 && this.target === 0) this.value = 0;
    this.uniforms.uStrength.value = this.value;
    this.mesh.visible = this.value > 0 && !!this.parent;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
