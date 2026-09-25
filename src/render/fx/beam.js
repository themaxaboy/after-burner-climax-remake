// Volumetric light cone (searchlights, lasers): an open cone mesh (apex at the
// origin, pointing -Z) shaded additively with soft view-dependent edges,
// distance attenuation, drifting dust and fog extinction. One draw call.
import {
  AddEquation, BufferAttribute, BufferGeometry, Color, CustomBlending, DoubleSide, Mesh, OneFactor, ShaderMaterial,
  ZeroFactor
} from 'three';
import { WORLD_FOG_PARS } from '../worldUniforms.js';

const VS = /* glsl */ `
varying vec3 vWP;
varying vec3 vWN;
varying vec2 vUv;
void main() {
  vUv = uv;
  vWN = normalize(transpose(inverse(mat3(modelMatrix))) * normal); // non-uniform scale
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FS = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uFxTime;
uniform sampler2D uNoise;
varying vec3 vWP;
varying vec3 vWN;
varying vec2 vUv;
${WORLD_FOG_PARS}
void main() {
  float z = vUv.y; // 0 apex .. 1 end
  vec3 V = normalize(cameraPosition - vWP);
  float facing = abs(dot(normalize(vWN), V));
  float soft = pow(facing, 1.6);
  float atten = 1.0 / (1.0 + z * z * 7.0) * (1.0 - smoothstep(0.7, 1.0, z));
  float dust = texture2D(uNoise, vec2(vUv.x * 4.0 + uFxTime * 0.01, z * 3.0 - uFxTime * 0.04)).r;
  float hot = exp(-z * 40.0) * 6.0;
  vec3 rd;
  float fa = worldFogAmount(cameraPosition, vWP, rd);
  vec3 c = uColor * uIntensity * (soft * atten * (0.55 + 0.9 * dust) + hot * soft);
  gl_FragColor = vec4(c * (1.0 - fa), 0.0);
}`;

function coneGeometry(radial = 40, rings = 16) {
  const pos = [], nrm = [], uv = [], idx = [];
  const slope = 1; // unit cone: radius 1 at z = -1 (scaled by mesh.scale)
  for (let r = 0; r <= rings; r++) {
    const v = Math.pow(r / rings, 1.5);
    for (let s = 0; s <= radial; s++) {
      const a = (s / radial) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      pos.push(c * v * slope, sn * v * slope, -v);
      const l = Math.hypot(1, slope);
      nrm.push(c / l, sn / l, slope / l);
      uv.push(s / radial, v);
    }
  }
  const w = radial + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < radial; s++) {
      const a = r * w + s, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, b, c, b, d, c);
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

let sharedCone = null;

export class Beam {
  constructor({ length = 600, radius = 60, color = 0xfff2dd, uniforms, noise }) {
    if (!sharedCone) sharedCone = coneGeometry();
    this.uniforms = {
      uColor: { value: new Color(color) },
      uIntensity: { value: 1 },
      uFxTime: uniforms.uFxTime,
      uNoise: { value: noise },
      ...uniforms.fog
    };
    this.material = new ShaderMaterial({
      name: 'fxBeam',
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
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor
    });
    const mesh = new Mesh(sharedCone, this.material);
    mesh.name = 'fxBeam';
    mesh.scale.set(radius, radius, length);
    mesh.renderOrder = 19;
    this.mesh = mesh;
    this.object = mesh;
  }

  setIntensity(v) {
    this.uniforms.uIntensity.value = v;
    this.mesh.visible = v > 0;
  }

  setColor(c) {
    this.uniforms.uColor.value.set(c);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.material.dispose();
  }
}

export function disposeBeamGeometry() {
  if (sharedCone) {
    sharedCone.dispose();
    sharedCone = null;
  }
}
