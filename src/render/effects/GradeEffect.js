import { Effect, BlendFunction } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

// Parametric colour grade (after tone mapping): lift/gamma/gain, contrast,
// saturation and split toning — the "teal & orange golden hour" look is just a
// preset of these numbers. Cheaper than a 3D LUT and tweakable per stage.
const fragment = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplit;
uniform float uExposureG;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb * uExposureG, 0.0, 1.0);
  // lift / gamma / gain (ASC-CDL-like)
  c = pow(max(c * uGain + uLift * (1.0 - c), 0.0), 1.0 / max(uGamma, vec3(0.01)));
  // contrast around mid grey (in perceptual space)
  c = (c - 0.45) * uContrast + 0.45;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  // split toning
  float hl = smoothstep(0.25, 0.85, l);
  vec3 tint = mix(uShadowTint, uHighlightTint, hl);
  c = mix(c, c * tint * 2.0, uSplit);
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

export const GRADES = {
  neutral: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], contrast: 1, saturation: 1, shadow: [0.5, 0.5, 0.5], highlight: [0.5, 0.5, 0.5], split: 0, exposure: 1 },
  goldenHour: { lift: [0.0, 0.012, 0.03], gamma: [1.02, 1.0, 0.97], gain: [1.04, 1.0, 0.94], contrast: 1.08, saturation: 1.1, shadow: [0.42, 0.52, 0.58], highlight: [0.58, 0.5, 0.42], split: 0.35, exposure: 1.0 },
  canyon: { lift: [0.01, 0.008, 0.012], gamma: [1.0, 0.99, 0.97], gain: [1.05, 1.0, 0.92], contrast: 1.12, saturation: 1.05, shadow: [0.45, 0.5, 0.56], highlight: [0.57, 0.5, 0.43], split: 0.3, exposure: 1.0 },
  twilight: { lift: [0.01, 0.0, 0.03], gamma: [1.0, 0.98, 1.02], gain: [1.06, 0.97, 0.98], contrast: 1.1, saturation: 1.12, shadow: [0.4, 0.45, 0.62], highlight: [0.62, 0.48, 0.42], split: 0.4, exposure: 1.0 },
  hangar: { lift: [0.0, 0.0, 0.01], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.98], contrast: 1.06, saturation: 1.0, shadow: [0.47, 0.5, 0.53], highlight: [0.53, 0.5, 0.47], split: 0.2, exposure: 1 }
};

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uLift', new Uniform(new Vector3())],
        ['uGamma', new Uniform(new Vector3(1, 1, 1))],
        ['uGain', new Uniform(new Vector3(1, 1, 1))],
        ['uContrast', new Uniform(1)],
        ['uSaturation', new Uniform(1)],
        ['uShadowTint', new Uniform(new Vector3(0.5, 0.5, 0.5))],
        ['uHighlightTint', new Uniform(new Vector3(0.5, 0.5, 0.5))],
        ['uSplit', new Uniform(0)],
        ['uExposureG', new Uniform(1)]
      ])
    });
    this.setGrade('neutral');
  }

  setGrade(g) {
    const p = typeof g === 'string' ? GRADES[g] || GRADES.neutral : g;
    const u = this.uniforms;
    u.get('uLift').value.fromArray(p.lift);
    u.get('uGamma').value.fromArray(p.gamma);
    u.get('uGain').value.fromArray(p.gain);
    u.get('uContrast').value = p.contrast;
    u.get('uSaturation').value = p.saturation;
    u.get('uShadowTint').value.fromArray(p.shadow);
    u.get('uHighlightTint').value.fromArray(p.highlight);
    u.get('uSplit').value = p.split;
    u.get('uExposureG').value = p.exposure;
  }
}
