// No-op FX used until/unless the particle library is available.
const trail = { push() {}, stop() {} };
export const FX_STUB = {
  update() {},
  explosion() {},
  hitSparks() {},
  smokePuff() {},
  debris() {},
  waterSplash() {},
  muzzleFlash() {},
  flareBurst() {},
  shockRing() {},
  vaporCone() {},
  createTrail: () => trail,
  createSmokeEmitter: () => ({ update() {}, stop() {} }),
  tracers: { setData() {} },
  createAfterburner: null,
  createBeam: null,
  warmup() {},
  stats: () => ({}),
  dispose() {}
};
