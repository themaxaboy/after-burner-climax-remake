import { Effect, BlendFunction } from 'postprocessing';
import { Color, Uniform } from 'three';

// Screen-space "body" effects, applied after tone mapping (LDR):
//   greyout / tunnel vision under high G, red damage flash, cloud whiteout,
//   Climax tint, vignette, cinematic letterbox bars and fade to black/white.
const fragment = /* glsl */ `
uniform float uGrey;
uniform float uRed;
uniform float uDamage;
uniform float uWhite;
uniform float uClimax;
uniform float uVignette;
uniform float uLetterbox;
uniform float uFade;
uniform vec3 uFadeColor;
uniform float uWarn;
uniform float uTimeG;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec2 p = uv - 0.5;
  p.x *= aspect;
  float r = length(p);

  // vignette (always on, subtle)
  float vig = smoothstep(0.35, 1.05, r);
  c *= 1.0 - vig * uVignette;

  // G-induced greyout: desaturate + tunnel
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(lum) * 0.85, uGrey * 0.85);
  float tunnel = smoothstep(0.75 - uGrey * 0.55, 1.05 - uGrey * 0.5, r);
  c *= 1.0 - tunnel * uGrey;

  // redout (negative G / heavy damage)
  c = mix(c, c * vec3(1.2, 0.25, 0.2), uRed * 0.7);

  // damage flash on edges
  float edge = smoothstep(0.25, 0.95, r);
  c = mix(c, vec3(1.0, 0.12, 0.05), uDamage * edge * 0.75);

  // missile warning pulse on edges
  float wp = (0.5 + 0.5 * sin(uTimeG * 18.0)) * uWarn;
  c = mix(c, vec3(1.0, 0.25, 0.1), wp * smoothstep(0.55, 1.0, r) * 0.35);

  // Climax: cool tint, slight desaturation & glowing blue edge
  vec3 cool = mix(vec3(lum), c, 0.75) * vec3(0.85, 0.95, 1.15);
  c = mix(c, cool, uClimax * 0.6);
  c += vec3(0.1, 0.35, 0.9) * uClimax * smoothstep(0.55, 1.1, r) * 0.45;

  // cloud whiteout
  c = mix(c, vec3(0.92, 0.94, 0.96), uWhite);

  // letterbox
  float bar = uLetterbox * 0.12;
  if (uv.y < bar || uv.y > 1.0 - bar) c = vec3(0.0);

  c = mix(c, uFadeColor, uFade);
  outputColor = vec4(c, inputColor.a);
}
`;

export class GForceEffect extends Effect {
  constructor() {
    super('GForceEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uGrey', new Uniform(0)],
        ['uRed', new Uniform(0)],
        ['uDamage', new Uniform(0)],
        ['uWhite', new Uniform(0)],
        ['uClimax', new Uniform(0)],
        ['uVignette', new Uniform(0.35)],
        ['uLetterbox', new Uniform(0)],
        ['uFade', new Uniform(0)],
        ['uFadeColor', new Uniform(new Color(0, 0, 0))],
        ['uWarn', new Uniform(0)],
        ['uTimeG', new Uniform(0)]
      ])
    });
  }

  set(name, v) {
    this.uniforms.get(name).value = v;
  }
}
