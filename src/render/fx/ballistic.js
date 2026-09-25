// Analytic particle motion shared by the CPU (trail followers, delayed
// debris puffs) and the GPU (particle vertex shader, see FX_MOTION_GLSL).
//
// dv/dt = a - k v   with a = (0, ay, 0) (gravity < 0, buoyancy > 0)
//   v(t) = a/k + (v0 - a/k) e^{-kt}
//   p(t) = p0 + (a/k) t + (v0 - a/k) (1 - e^{-kt}) / k
// k -> 0 falls back to the ballistic p0 + v0 t + a t^2 / 2.

const K_MIN = 1e-3;

/** Writes p(t) into out ({x,y,z}). */
export function motionAt(out, px, py, pz, vx, vy, vz, k, ay, t) {
  if (k < K_MIN) {
    out.x = px + vx * t;
    out.y = py + vy * t + 0.5 * ay * t * t;
    out.z = pz + vz * t;
    return out;
  }
  const e = (1 - Math.exp(-k * t)) / k;
  const vt = ay / k;
  out.x = px + vx * e;
  out.y = py + vt * t + (vy - vt) * e;
  out.z = pz + vz * e;
  return out;
}

/** Writes v(t) into out ({x,y,z}). */
export function velocityAt(out, vx, vy, vz, k, ay, t) {
  if (k < K_MIN) {
    out.x = vx;
    out.y = vy + ay * t;
    out.z = vz;
    return out;
  }
  const d = Math.exp(-k * t);
  const vt = ay / k;
  out.x = vx * d;
  out.y = vt + (vy - vt) * d;
  out.z = vz * d;
  return out;
}

export const FX_MOTION_GLSL = /* glsl */ `
vec3 fxMotion(vec3 p0, vec3 v0, float k, float ay, float t) {
  if (k < ${K_MIN}) return p0 + v0 * t + vec3(0.0, 0.5 * ay * t * t, 0.0);
  float e = (1.0 - exp(-k * t)) / k;
  float vt = ay / k;
  return p0 + v0 * e + vec3(0.0, vt * t - vt * e, 0.0);
}
vec3 fxVelocity(vec3 v0, float k, float ay, float t) {
  if (k < ${K_MIN}) return v0 + vec3(0.0, ay * t, 0.0);
  float d = exp(-k * t);
  float vt = ay / k;
  return v0 * d + vec3(0.0, vt - vt * d, 0.0);
}
`;
