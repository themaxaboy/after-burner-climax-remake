import { Effect, BlendFunction } from 'postprocessing';
import { Uniform, Vector2, Vector3 } from 'three';

// Parametric colour grade (after tone mapping): lift/gamma/gain, contrast,
// saturation, vibrance, a hue focus and split toning. Cheaper than a 3D LUT
// and tweakable per stage.
//   vibrance   extra saturation weighted toward the less saturated pixels
//              (hazy sky and sea get punchier, already-vivid colours don't clip)
//   hue focus  pushes chroma of pixels near the stage's dominant hue (and pulls
//              their hue slightly toward it): one saturated hue per stage.
// Contrast pivots in a perceptual (square-root) space so it does not darken
// the mid-tones of a high-key image.
const fragment = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform float uContrast;
uniform float uSaturation;
uniform float uVibrance;
uniform vec2 uFocusDir;      // dominant hue as a unit vector in the (Cb, Cr) plane
uniform vec3 uFocus;         // x amount, y cos(half width), z hue pull
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uSplit;
uniform float uExposureG;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = clamp(inputColor.rgb * uExposureG, 0.0, 1.0);
  // lift / gamma / gain (ASC-CDL-like)
  c = pow(max(c * uGain + uLift * (1.0 - c), 0.0), 1.0 / max(uGamma, vec3(0.01)));
  // contrast around mid grey in a perceptual space
  vec3 pc = sqrt(c);
  pc = max((pc - 0.5) * uContrast + 0.5, 0.0);
  c = pc * pc;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  // vibrance: boost the dull pixels more than the vivid ones
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 1e-4);
  c = mix(vec3(l), c, 1.0 + uVibrance * (1.0 - sat) * (1.0 - sat));
  // hue focus in the luma-preserving (Cb, Cr) plane
  if (uFocus.x > 0.0) {
    vec2 ch = vec2(c.b - l, c.r - l);
    float cl = length(ch);
    if (cl > 1e-4) {
      vec2 dir = ch / cl;
      float w = smoothstep(uFocus.y, 1.0, dot(dir, uFocusDir));
      dir = normalize(mix(dir, uFocusDir, uFocus.z * w));
      ch = dir * cl * (1.0 + uFocus.x * w);
      c.b = l + ch.x;
      c.r = l + ch.y;
      c.g = (l - 0.2126 * c.r - 0.0722 * c.b) / 0.7152;
    }
  }
  // split toning
  float hl = smoothstep(0.25, 0.85, l);
  vec3 tint = mix(uShadowTint, uHighlightTint, hl);
  c = mix(c, c * tint * 2.0, uSplit);
  outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
}
`;

const N = { shadow: [0.5, 0.5, 0.5], highlight: [0.5, 0.5, 0.5], split: 0 };

// "Arcade vivid" base: clean, bright, saturated; no lift, no teal/orange crush.
const arcade = (focus, o = {}) => ({
  lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], contrast: 1.05, saturation: 1.25, vibrance: 0.35,
  focus, focusAmount: 0.3, focusWidth: 50, focusPull: 0.15, exposure: 1, ...N, ...o
});

export const GRADES = {
  neutral: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], contrast: 1, saturation: 1, shadow: [0.5, 0.5, 0.5], highlight: [0.5, 0.5, 0.5], split: 0, exposure: 1 },
  goldenHour: { lift: [0.0, 0.012, 0.03], gamma: [1.02, 1.0, 0.97], gain: [1.04, 1.0, 0.94], contrast: 1.08, saturation: 1.1, shadow: [0.42, 0.52, 0.58], highlight: [0.58, 0.5, 0.42], split: 0.35, exposure: 1.0 },
  canyon: { lift: [0.01, 0.008, 0.012], gamma: [1.0, 0.99, 0.97], gain: [1.05, 1.0, 0.92], contrast: 1.12, saturation: 1.05, shadow: [0.45, 0.5, 0.56], highlight: [0.57, 0.5, 0.43], split: 0.3, exposure: 1.0 },
  twilight: { lift: [0.01, 0.0, 0.03], gamma: [1.0, 0.98, 1.02], gain: [1.06, 0.97, 0.98], contrast: 1.1, saturation: 1.12, shadow: [0.4, 0.45, 0.62], highlight: [0.62, 0.48, 0.42], split: 0.4, exposure: 1.0 },
  hangar: { lift: [0.0, 0.0, 0.01], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.98], contrast: 1.06, saturation: 1.0, shadow: [0.47, 0.5, 0.53], highlight: [0.53, 0.5, 0.47], split: 0.2, exposure: 1 },

  // ---- arcade vivid (one dominant hue per stage; focus = that hue as RGB)
  arcadeOcean: arcade([0.05, 0.35, 1.0], { saturation: 1.22 }),
  arcadeEmerald: arcade([0.3, 0.85, 0.2], { saturation: 1.25, gain: [1.0, 1.02, 0.98] }),
  arcadeCanyon: arcade([1.0, 0.35, 0.12], { saturation: 1.22, gain: [1.03, 1.0, 0.97], focusAmount: 0.25 }),
  arcadeSunset: arcade([1.0, 0.5, 0.1], { saturation: 1.3, gain: [1.04, 1.0, 0.95], focusAmount: 0.3 }),
  arcadeGlacier: arcade([0.1, 0.85, 0.85], { saturation: 1.22, focusAmount: 0.3 }),
  arcadeDunes: arcade([1.0, 0.82, 0.12], { saturation: 1.3, gain: [1.04, 1.02, 0.96], focusAmount: 0.45, focusWidth: 40, focusPull: 0.3 }),
  arcadeClouds: arcade([1.0, 0.68, 0.28], { saturation: 1.32, gain: [1.03, 1.0, 0.96], focusAmount: 0.35 }),
  arcadeFortress: arcade([1.0, 0.62, 0.25], { saturation: 1.2, contrast: 1.07, focusAmount: 0.22 }),
  arcadeAurora: arcade([0.1, 1.0, 0.75], { saturation: 1.3, contrast: 1.06, focusAmount: 0.4, focusWidth: 45 }),
  arcadeStrike: arcade([1.0, 0.45, 0.2], { saturation: 1.2, contrast: 1.07, focusAmount: 0.2 }),
  arcadeStorm: arcade([0.25, 0.55, 1.0], { saturation: 1.18, contrast: 1.1, focusAmount: 0.25 }),
  arcadeVolcano: arcade([1.0, 0.25, 0.05], { saturation: 1.28, contrast: 1.1, gain: [1.05, 0.98, 0.94], focusAmount: 0.4 }),
  arcadeNight: arcade([0.1, 0.45, 1.0], { saturation: 1.25, contrast: 1.06, focusAmount: 0.35, focusWidth: 45 }),
  arcadeWhiteout: arcade([0.35, 0.75, 1.0], { saturation: 1.18, gain: [0.98, 1.0, 1.03], focusAmount: 0.25 }),
  arcadeRavine: arcade([1.0, 0.35, 0.6], { saturation: 1.28, gain: [1.04, 0.98, 1.0], focusAmount: 0.35 }),
  arcadeJetstream: arcade([1.0, 0.55, 0.7], { saturation: 1.3, gain: [1.03, 1.0, 1.0], focusAmount: 0.35 }),
  arcadeBadlands: arcade([0.3, 0.55, 1.0], { saturation: 1.22, contrast: 1.07, focusAmount: 0.3 }),
  arcadeStratos: arcade([0.1, 0.3, 1.0], { saturation: 1.3, contrast: 1.08, focusAmount: 0.4, focusWidth: 45 }),
  arcadeHangar: arcade([0.1, 0.4, 1.0], { saturation: 1.12, vibrance: 0.2, focusAmount: 0.1 })
};

export const ARCADE_GRADES = Object.keys(GRADES).filter((k) => k.startsWith('arcade'));

/** Unit (Cb, Cr) direction of an RGB colour, same convention as the shader. */
export function hueDir(rgb, out = new Vector2()) {
  const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  out.set(rgb[2] - l, rgb[0] - l);
  const len = out.length();
  return len > 1e-6 ? out.multiplyScalar(1 / len) : out.set(1, 0);
}

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
        ['uVibrance', new Uniform(0)],
        ['uFocusDir', new Uniform(new Vector2(1, 0))],
        ['uFocus', new Uniform(new Vector3(0, 1, 0))],
        ['uShadowTint', new Uniform(new Vector3(0.5, 0.5, 0.5))],
        ['uHighlightTint', new Uniform(new Vector3(0.5, 0.5, 0.5))],
        ['uSplit', new Uniform(0)],
        ['uExposureG', new Uniform(1)]
      ])
    });
    this.setGrade('neutral');
  }

  /** @param {string|object} g preset name (GRADES) or a grade object */
  setGrade(g) {
    this._last = g;
    const p = typeof g === 'string' ? GRADES[g] || GRADES.neutral : g;
    const u = this.uniforms;
    u.get('uLift').value.fromArray(p.lift || [0, 0, 0]);
    u.get('uGamma').value.fromArray(p.gamma || [1, 1, 1]);
    u.get('uGain').value.fromArray(p.gain || [1, 1, 1]);
    u.get('uContrast').value = p.contrast ?? 1;
    u.get('uSaturation').value = p.saturation ?? 1;
    u.get('uVibrance').value = p.vibrance ?? 0;
    if (p.focus) {
      hueDir(p.focus, u.get('uFocusDir').value);
      u.get('uFocus').value.set(p.focusAmount ?? 0.3, Math.cos((((p.focusWidth ?? 50) * Math.PI) / 180)), p.focusPull ?? 0.15);
    } else u.get('uFocus').value.set(0, 1, 0);
    u.get('uShadowTint').value.fromArray(p.shadow || N.shadow);
    u.get('uHighlightTint').value.fromArray(p.highlight || N.highlight);
    u.get('uSplit').value = p.split ?? 0;
    u.get('uExposureG').value = p.exposure ?? 1;
  }
}
