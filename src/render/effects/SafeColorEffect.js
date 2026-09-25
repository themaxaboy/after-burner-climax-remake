import { Effect, BlendFunction } from 'postprocessing';

// NaN / Inf / negative guard for the HDR scene colour. A single bad pixel from
// a shader (division by zero, pow of a negative number…) survives in half-float
// buffers and bloom smears it into flickering black blocks. Robust test on the
// bit pattern: fast-math compilers may fold `x != x` away.
export const SAFE_COLOR_GLSL = /* glsl */ `
vec3 safeColor(vec3 c) {
  uvec3 b = floatBitsToUint(c) & 0x7fffffffu;
  c = mix(c, vec3(0.0), greaterThanEqual(b, uvec3(0x7f800000u)));
  return clamp(c, 0.0, 65000.0);
}`;

const fragment = /* glsl */ `
${SAFE_COLOR_GLSL}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(safeColor(inputColor.rgb), inputColor.a);
}`;

/** First effect of the first effect pass (cheap: a few ALU ops per pixel). */
export class SafeColorEffect extends Effect {
  constructor() {
    super('SafeColorEffect', fragment, { blendFunction: BlendFunction.SRC });
  }
}

/**
 * Patch a pmndrs LuminanceMaterial (bloom's bright-pass, which reads the raw
 * input buffer before any effect runs) so NaN/Inf can't enter the bloom mips.
 */
export function guardLuminanceMaterial(mat) {
  if (!mat || mat.userData.safeColor) return mat;
  const src = 'vec4 texel=texture2D(inputBuffer,vUv);';
  if (!mat.fragmentShader.includes(src)) return mat;
  mat.fragmentShader = mat.fragmentShader
    .replace('varying vec2 vUv;', `varying vec2 vUv;\n${SAFE_COLOR_GLSL}\n`)
    .replace(src, 'vec4 texel=texture2D(inputBuffer,vUv);texel.rgb=safeColor(texel.rgb);');
  mat.userData.safeColor = true;
  mat.needsUpdate = true;
  return mat;
}
