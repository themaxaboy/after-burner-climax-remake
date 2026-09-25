// Shared GLSL helpers for the FX shaders.
import { WorldUniforms } from '../worldUniforms.js';

export const FX_NOISE_GLSL = /* glsl */ `
float fxHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 fxHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float fxNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash12(i), fxHash12(i + vec2(1.0, 0.0)), u.x),
             mix(fxHash12(i + vec2(0.0, 1.0)), fxHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// interleaved gradient noise (per-pixel dither)
float fxIGN(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}
`;

/** HDR fire colour ramp: heat 0..1 -> linear radiance (deep red ... white-yellow). */
export const FX_FIRE_GLSL = /* glsl */ `
vec3 fxFireRamp(float h) {
  // Calibrated for AgX @ exposure ~0.55 (see labs ?demo=swatch): AgX desaturates and
  // skews bright saturated orange toward salmon, so the orange band stays very
  // saturated and below ~1.5, then jumps quickly to a yellow ratio (G/R > 0.7).
  vec3 c = mix(vec3(0.3, 0.025, 0.003), vec3(1.4, 0.28, 0.02), smoothstep(0.0, 0.5, h));
  c = mix(c, vec3(2.6, 1.9, 0.5), smoothstep(0.5, 0.78, h));
  c = mix(c, vec3(10.0, 8.5, 5.0), smoothstep(0.78, 1.0, h));
  return c * smoothstep(0.0, 0.1, h);
}
`;

/** Uniform references for WORLD_FOG_PARS (shared by reference with the world). */
export function worldFogUniforms() {
  const W = WorldUniforms;
  return {
    uSunDir: W.uSunDir,
    uSunColor: W.uSunColor,
    uFogColor: W.uFogColor,
    uFogSunColor: W.uFogSunColor,
    uFogDensity: W.uFogDensity,
    uFogHeightFalloff: W.uFogHeightFalloff,
    uFogBaseHeight: W.uFogBaseHeight,
    uFogMax: W.uFogMax
  };
}
