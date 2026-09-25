// No-op FX used until/unless the particle library is available (tests, no WebGL).
// Keep it in sync with the public methods of FX (src/render/fx/index.js): the
// unit tests check that every FX method exists here.
const trail = { push() {}, stop() {}, alive: false, index: -1 };
export const FX_STUB = {
  Q: { name: 'stub', count: 1, lights: 0, liteBurst: 3 },
  setLighting() {},
  update() {},
  explosion() {},
  hitSparks() {},
  smokePuff() {},
  smokePlume() {},
  debris() {},
  waterSplash() {},
  muzzleFlash() {},
  flareBurst() {},
  shockRing() {},
  vaporCone() {},
  createTrail: () => trail,
  createSmokeEmitter: () => ({ update() {}, stop() {}, alive: false }),
  tracers: { setData() {} },
  createAfterburner: null,
  createBeam: null,
  clear() {},
  warmup() {},
  stats: () => ({}),
  dispose() {}
};
