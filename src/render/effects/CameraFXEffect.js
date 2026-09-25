import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { Matrix4, Quaternion, Uniform, Vector2, Vector3, Vector4 } from 'three';

// One convolution effect that merges everything that needs to re-sample the
// scene colour: camera motion blur (reconstructed from depth + previous
// view-projection), radial speed blur, chromatic aberration and engine heat haze.
// It is the first effect of the post chain on medium+, so every tap is
// sanitised (NaN/Inf → 0, clamp to the half-float range): a single bad pixel
// from a shader would otherwise be spread by bloom into black blocks.
const fragment = /* glsl */ `
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform float uMotion;       // shutter fraction
uniform float uMaxBlur;      // max blur length in uv
uniform float uNearMask;     // view distance (m) below which motion blur fades out
uniform float uRadial;       // radial (boost) blur strength
uniform vec2 uRadialCenter;
uniform float uCA;           // chromatic aberration
uniform vec4 uHaze0;         // xy center uv, zw radius uv
uniform vec4 uHaze1;
uniform float uHazeStrength;
uniform float uTimeFX;

float fxHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Robust NaN/Inf test on the bit pattern (fast-math compilers may fold x != x).
vec3 fxSafe(vec3 c) {
  uvec3 b = floatBitsToUint(c) & 0x7fffffffu;
  c = mix(c, vec3(0.0), greaterThanEqual(b, uvec3(0x7f800000u)));
  return clamp(c, 0.0, 65000.0);
}

vec2 hazeOffset(vec2 uv, vec4 h) {
  if (h.z <= 0.0) return vec2(0.0);
  vec2 d = (uv - h.xy) / h.zw;
  float r = dot(d, d);
  if (r > 1.0) return vec2(0.0);
  float fall = (1.0 - r);
  float n1 = sin(uv.y * 180.0 + uTimeFX * 23.0) * cos(uv.x * 140.0 - uTimeFX * 17.0);
  float n2 = sin(uv.x * 260.0 + uTimeFX * 31.0 + uv.y * 90.0);
  return vec2(n1, n2) * fall * fall * uHazeStrength * 0.004;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec2 suv = uv + hazeOffset(uv, uHaze0) + hazeOffset(uv, uHaze1);

  // --- camera motion vector from depth reprojection
  vec2 vel = vec2(0.0);
  if (uMotion > 0.0) {
    vec4 ndc = vec4(suv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 wp = uInvViewProj * ndc;
    wp /= wp.w;
    vec4 prev = uPrevViewProj * wp;
    vec2 puv = prev.xy / prev.w * 0.5 + 0.5;
    vel = (suv - puv) * uMotion;
    float viewZ = -getViewZ(depth);
    vel *= smoothstep(uNearMask * 0.6, uNearMask, viewZ);
    float l = length(vel);
    if (l > uMaxBlur) vel *= uMaxBlur / l;
  }

  // --- radial speed blur (stronger toward edges)
  vec2 toC = suv - uRadialCenter;
  vec2 radial = toC * uRadial * 0.06 * smoothstep(0.05, 0.6, length(toC));
  vec2 blur = vel + radial;

  // --- chromatic aberration grows toward the edges
  vec2 caDir = toC * uCA * 0.012 * length(toC);

  const int TAPS = 8;
  float jitter = fxHash(uv * resolution + uTimeFX) - 0.5;
  vec3 acc = vec3(0.0);
  float blurLen = length(blur) * resolution.x;
  if (blurLen < 0.75) {
    acc.r = texture2D(inputBuffer, suv + caDir).r;
    acc.g = texture2D(inputBuffer, suv).g;
    acc.b = texture2D(inputBuffer, suv - caDir).b;
    acc = fxSafe(acc);
  } else {
    for (int i = 0; i < TAPS; i++) {
      float t = (float(i) + 0.5 + jitter) / float(TAPS) - 0.5;
      vec2 o = suv - blur * t;
      acc += fxSafe(vec3(texture2D(inputBuffer, o + caDir).r, texture2D(inputBuffer, o).g, texture2D(inputBuffer, o - caDir).b));
    }
    acc /= float(TAPS);
  }
  outputColor = vec4(acc, inputColor.a);
}
`;

export class CameraFXEffect extends Effect {
  constructor() {
    super('CameraFXEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uInvViewProj', new Uniform(new Matrix4())],
        ['uPrevViewProj', new Uniform(new Matrix4())],
        ['uMotion', new Uniform(0.0)],
        ['uMaxBlur', new Uniform(0.03)],
        ['uNearMask', new Uniform(45)],
        ['uRadial', new Uniform(0)],
        ['uRadialCenter', new Uniform(new Vector2(0.5, 0.5))],
        ['uCA', new Uniform(0.15)],
        ['uHaze0', new Uniform(new Vector4())],
        ['uHaze1', new Uniform(new Vector4())],
        ['uHazeStrength', new Uniform(0)],
        ['uTimeFX', new Uniform(0)]
      ])
    });
    this.motionEnabled = true;
    this.shutter = 0.45;
    this._vp = new Matrix4();
    this._havePrev = false;
    // camera-cut detection (scripted cinematics jump the camera)
    this.cutDistance = 30; // m of unexpected displacement in one frame
    this.cutAngle = (25 * Math.PI) / 180;
    this._pos = new Vector3();
    this._prevPos = new Vector3();
    this._prevStep = new Vector3();
    this._step = new Vector3();
    this._quat = new Quaternion();
    this._prevQuat = new Quaternion();
    this.cuts = 0;
  }

  /** True when the camera jumped since the last frame (cut): no blur this frame. */
  _detectCut(camera) {
    camera.matrixWorld.decompose(this._pos, this._quat, this._step);
    if (!this._havePrev) {
      this._prevStep.set(0, 0, 0);
      return false;
    }
    this._step.subVectors(this._pos, this._prevPos);
    // compare with the previous frame's motion so fast steady flight is not a cut
    const jump = this._step.distanceTo(this._prevStep);
    const angle = this._quat.angleTo(this._prevQuat);
    this._prevStep.copy(this._step);
    return jump > this.cutDistance || angle > this.cutAngle;
  }

  /**
   * Call once per rendered frame after the camera matrices are final.
   * @param {import('three').PerspectiveCamera} camera
   * @param {number} dt real frame time (s)
   */
  updateCamera(camera, dt) {
    const u = this.uniforms;
    this._vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const cut = this._detectCut(camera);
    if (cut) this.cuts++;
    if (!this._havePrev || cut) {
      u.get('uPrevViewProj').value.copy(this._vp);
      this._havePrev = true;
    }
    this._prevPos.copy(this._pos);
    this._prevQuat.copy(this._quat);
    u.get('uInvViewProj').value.copy(this._vp).invert();
    // normalise blur to a 60 Hz reference so high refresh rates look the same
    const ref = 1 / 60;
    u.get('uMotion').value = this.motionEnabled ? this.shutter * (dt > 0 ? Math.min(ref / dt, 3) : 1) : 0;
    u.get('uTimeFX').value += dt;
  }

  /** Must be called after the frame is rendered. */
  endFrame() {
    this.uniforms.get('uPrevViewProj').value.copy(this._vp);
  }

  resetHistory() {
    this._havePrev = false;
  }
}
