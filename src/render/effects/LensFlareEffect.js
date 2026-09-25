import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { Color, Uniform, Vector3 } from 'three';

// Cinematic anamorphic lens flare: horizontal streak through the sun, soft
// glare, a halo ring and chromatic ghosts mirrored across the screen centre.
// Occlusion is estimated per-pixel from a few depth taps around the sun.
const fragment = /* glsl */ `
uniform vec3 uSun;          // xy = sun uv, z = on-screen factor (0..1)
uniform float uIntensity;
uniform vec3 uTint;
uniform float uStreak;

float sunVisibility() {
  vec2 s = uSun.xy;
  float vis = 0.0;
  vec2 px = texelSize * 6.0;
  vis += step(0.9999, readDepth(s));
  vis += step(0.9999, readDepth(s + vec2(px.x, 0.0)));
  vis += step(0.9999, readDepth(s - vec2(px.x, 0.0)));
  vis += step(0.9999, readDepth(s + vec2(0.0, px.y)));
  vis += step(0.9999, readDepth(s - vec2(0.0, px.y)));
  vis += step(0.9999, readDepth(s + px * 2.0));
  vis += step(0.9999, readDepth(s - px * 2.0));
  return vis / 7.0;
}

float ghost(vec2 uv, vec2 c, float r, float soft) {
  vec2 d = (uv - c) * vec2(aspect, 1.0);
  float l = length(d);
  return smoothstep(r, r * (1.0 - soft), l);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float onScreen = uSun.z;
  if (onScreen <= 0.001 || uIntensity <= 0.0) { outputColor = vec4(0.0); return; }
  float vis = sunVisibility() * onScreen;
  if (vis <= 0.001) { outputColor = vec4(0.0); return; }
  vec2 s = uSun.xy;
  vec2 d = (uv - s) * vec2(aspect, 1.0);
  float dist = length(d);

  // anamorphic streak
  float streak = exp(-abs(d.y) * 900.0) * exp(-abs(d.x) * 1.4) * uStreak;
  streak += exp(-abs(d.y) * 160.0) * exp(-abs(d.x) * 5.0) * 0.25 * uStreak;
  // glare
  float glare = exp(-dist * 9.0) * 0.35 + exp(-dist * 40.0) * 0.6;
  // halo ring
  float halo = smoothstep(0.34, 0.36, dist) * smoothstep(0.40, 0.36, dist) * 0.06;

  // ghosts along the axis through the centre
  vec2 axis = vec2(0.5) - s;
  vec3 g = vec3(0.0);
  g += vec3(0.30, 0.55, 1.00) * ghost(uv, s + axis * 0.55, 0.035, 0.5) * 0.18;
  g += vec3(1.00, 0.60, 0.25) * ghost(uv, s + axis * 0.85, 0.06, 0.8) * 0.10;
  g += vec3(0.35, 1.00, 0.55) * ghost(uv, s + axis * 1.25, 0.022, 0.4) * 0.16;
  g += vec3(0.80, 0.40, 1.00) * ghost(uv, s + axis * 1.55, 0.09, 0.9) * 0.07;
  g += vec3(1.00, 0.85, 0.50) * ghost(uv, s + axis * 2.05, 0.05, 0.6) * 0.09;
  g += vec3(0.40, 0.70, 1.00) * ghost(uv, s + axis * 1.9, 0.14, 0.95) * 0.05;

  vec3 streakCol = vec3(0.35, 0.6, 1.0);
  vec3 col = streakCol * streak + uTint * (glare + halo) + g * uTint;
  outputColor = vec4(col * uIntensity * vis, 1.0);
}
`;

export class LensFlareEffect extends Effect {
  constructor() {
    super('LensFlareEffect', fragment, {
      blendFunction: BlendFunction.ADD,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uSun', new Uniform(new Vector3())],
        ['uIntensity', new Uniform(1)],
        ['uTint', new Uniform(new Color(1, 0.85, 0.65))],
        ['uStreak', new Uniform(1)]
      ])
    });
    this._v = new Vector3();
  }

  /** Project the sun direction and compute on-screen fade. */
  updateSun(camera, sunDir, intensity = 1) {
    const v = this._v.copy(sunDir).multiplyScalar(10000).add(camera.position).project(camera);
    const u = this.uniforms.get('uSun').value;
    const behind = v.z > 1;
    const sx = v.x * 0.5 + 0.5, sy = v.y * 0.5 + 0.5;
    const margin = 0.15;
    const edge = Math.min(sx + margin, 1 + margin - sx, sy + margin, 1 + margin - sy) / margin;
    u.set(sx, sy, behind ? 0 : Math.max(0, Math.min(1, edge)) * Math.max(0, Math.min(1, sunDir.y * 12 + 0.4)));
    this.uniforms.get('uIntensity').value = intensity;
  }
}
