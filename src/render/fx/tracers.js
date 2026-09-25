// Vulcan tracers: instanced quads billboarded around each bullet's velocity
// axis, streak length = speed * uStreak (0.02 s), HDR additive, one draw call.
import {
  AddEquation, BufferAttribute, CustomBlending, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, OneFactor, ShaderMaterial, ZeroFactor, Color
} from 'three';
import { WORLD_FOG_PARS } from '../worldUniforms.js';

const VS = /* glsl */ `
attribute vec2 corner;
attribute vec3 iPos;
attribute vec3 iVel;
uniform vec2 uViewport;
uniform float uStreak;
uniform float uWidth;
${WORLD_FOG_PARS}
varying vec2 vUv;
varying float vI;
void main() {
  float sp = length(iVel);
  vec3 axis = sp > 1e-3 ? iVel / sp : vec3(0.0, 0.0, -1.0);
  vec3 toCam = cameraPosition - iPos;
  float dist = length(toCam);
  toCam /= max(dist, 1e-3);
  vec3 side = cross(axis, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  float depth = max(-(viewMatrix * vec4(iPos, 1.0)).z, 0.1);
  float pxPerM = projectionMatrix[1][1] * 0.5 * uViewport.y / depth;
  float w = uWidth;
  float e = 1.0;
  if (w * pxPerM < 1.4) { e = w * pxPerM / 1.4; w = 1.4 / pxPerM; }
  float len = sp * uStreak;
  float along = corner.y * 0.5 + 0.5;
  vec3 wp = iPos + side * (corner.x * w) + axis * mix(-len, w, along);
  vUv = corner;
  vec3 rd;
  float fa = worldFogAmount(cameraPosition, iPos, rd);
  vI = e * (1.0 - fa) * smoothstep(1.0, 4.0, dist);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FS = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vI;
void main() {
  float across = exp(-vUv.x * vUv.x * 4.0);
  float core = exp(-vUv.x * vUv.x * 16.0);
  float along = vUv.y * 0.5 + 0.5;
  float head = smoothstep(0.0, 0.9, along) * (1.0 - smoothstep(0.97, 1.0, along) * 0.5);
  vec3 c = uColor * across + vec3(1.0, 0.7, 0.3) * core * 2.2;
  gl_FragColor = vec4(c * head * vI, 0.0);
}`;

export class Tracers {
  constructor({ capacity = 512, uniforms }) {
    this.capacity = capacity;
    const g = new InstancedBufferGeometry();
    g.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
    g.setAttribute('position', new BufferAttribute(new Float32Array(12), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.vel = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.pos.setUsage(DynamicDrawUsage);
    this.vel.setUsage(DynamicDrawUsage);
    g.setAttribute('iPos', this.pos);
    g.setAttribute('iVel', this.vel);
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = {
      uViewport: uniforms.uViewport,
      uStreak: { value: 0.02 },
      uWidth: { value: 0.16 },
      uColor: { value: new Color(2.2, 0.75, 0.12) },
      ...uniforms.fog
    };
    this.material = new ShaderMaterial({
      name: 'fxTracers',
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.name = 'fxTracers';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.count = 0;
    this._r1 = { start: 0, count: 0 };
    this._r2 = { start: 0, count: 0 };
  }

  /** positions / velocities: Float32Array xyz (world). Draws `count` bullets. */
  setData(positions, velocities, count) {
    const n = Math.min(count | 0, this.capacity);
    const f = n * 3;
    const P = this.pos.array, V = this.vel.array;
    for (let i = 0; i < f; i++) {
      P[i] = positions[i];
      V[i] = velocities[i];
    }
    this.count = n;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this._r1.start = 0; this._r1.count = f;
      this._r2.start = 0; this._r2.count = f;
      this.pos.updateRanges.length = 0;
      this.vel.updateRanges.length = 0;
      this.pos.updateRanges.push(this._r1);
      this.vel.updateRanges.push(this._r2);
      this.pos.needsUpdate = true;
      this.vel.needsUpdate = true;
    }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
