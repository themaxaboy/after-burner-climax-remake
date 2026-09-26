// Procedural liveries: paint scheme presets, decal atlas and uniform packing.
//
// All paint is evaluated in the fragment shader from OBJECT-SPACE position
// (pre-instance), so no UV unwrapping is needed. See materials.js for GLSL.

import { CanvasTexture, Color, DataTexture, LinearMipmapLinearFilter, LinearFilter, RGBAFormat, SRGBColorSpace, Vector3, Vector4 } from 'three';

export const MAX_DECALS = 12;
export const ZONE_COUNT = 10;

// Zone ids written into the aZone vertex attribute.
export const ZONE = {
  PAINT: 0,
  INTERIOR: 1, // intake ducts, recesses (near black)
  RADOME: 2, // dielectric panels, sensor fairings
  RUBBER: 3, // tyres, seals
  WHITE: 4, // missile bodies, gear
  WALKWAY: 5, // dark anti-slip / deck
  YELLOW: 6, // warhead bands
  TAN: 7, // rocket motor bands
  RED: 8, // hull bottom / warning
  GLASSDARK: 9 // dark sensor windows
};

const DEFAULT_ZONES = [
  ['#000000', 0.5],
  ['#111214', 0.8],
  ['#8e9092', 0.45],
  ['#141414', 0.9],
  ['#dcdcd6', 0.4],
  ['#3a3d40', 0.9],
  ['#d4a52a', 0.5],
  ['#8c6a42', 0.55],
  ['#7a2420', 0.7],
  ['#0d1418', 0.1]
];

// ---- scheme presets (sRGB hex colours) -------------------------------------
export const PRESETS = {
  navyGull: {
    top: '#a4a6a4',
    bottom: '#ecece6',
    counter: [-0.3, 0.14],
    rough: 0.42,
    tail: '#18223a',
    ink: '#141414',
    grime: 0.55,
    soot: 1.0
  },
  navyCamo: {
    top: '#7d8a95',
    bottom: '#b3bcc2',
    counter: [-0.35, 0.1],
    camo: { mode: 1, colors: ['#56636f', '#a3adb4'], t1: 0.52, t2: 0.56 },
    rough: 0.62,
    ink: '#1c2024',
    decalTint: [0.35, 0.7, 0.9],
    grime: 0.6,
    soot: 1.0
  },
  vandyBlack: {
    top: '#0b0b0d',
    bottom: '#0e0e10',
    counter: [-0.5, 0.2],
    rough: 0.22,
    metal: 0.08,
    clearcoat: 0.8,
    tail: '#c99a2e',
    ink: '#d9ad45',
    stripe: { a: '#d8a93c', b: '#a41c1c' },
    grime: 0.25,
    soot: 0.6,
    toneVar: 0.02
  },
  navyTps: {
    top: '#7c838a',
    bottom: '#a4abb1',
    counter: [-0.15, 0.25],
    rough: 0.66,
    ink: '#4e555b',
    decalTint: [0.0, 0.55, 0.85],
    grime: 0.7,
    soot: 0.9,
    toneVar: 0.09
  },
  hornetTps: {
    top: '#848b92',
    bottom: '#a8aeb3',
    counter: [-0.2, 0.2],
    rough: 0.58,
    ink: '#303438',
    decalTint: [0.6, 0.85, 1.0],
    grime: 0.6,
    soot: 1.0,
    tail: '#2a3140'
  },
  desertCamo: {
    top: '#c3a77c',
    bottom: '#d8d2c2',
    counter: [-0.35, 0.1],
    camo: { mode: 1, colors: ['#8a6a46', '#6f7457'], t1: 0.5, t2: 0.58 },
    rough: 0.7,
    ink: '#2a2218',
    decalTint: [0.4, 0.7, 0.9],
    grime: 0.6,
    soot: 1.0
  },
  blueStreak: {
    top: '#0f1830',
    bottom: '#131b30',
    counter: [-0.5, 0.2],
    rough: 0.24,
    clearcoat: 0.8,
    tail: '#e0a024',
    ink: '#f0c050',
    stripe: { a: '#f2b12a', b: '#d23a16' },
    grime: 0.25,
    soot: 0.6,
    toneVar: 0.02
  },
  gunship: {
    top: '#4b5157',
    bottom: '#50565c',
    counter: [-0.3, 0.2],
    rough: 0.62,
    ink: '#16181a',
    decalTint: [0.25, 0.6, 1.0],
    grime: 0.7,
    soot: 1.1,
    toneVar: 0.08
  },
  euroCamo: {
    top: '#4b5a48',
    bottom: '#6b7278',
    counter: [-0.3, 0.12],
    camo: { mode: 1, colors: ['#2f3931', '#5f666b'], t1: 0.5, t2: 0.55 },
    rough: 0.66,
    ink: '#141614',
    decalTint: [0.3, 0.6, 0.95],
    grime: 0.6,
    soot: 1.0
  },
  bronzeGold: {
    top: '#26100f',
    bottom: '#2b1413',
    counter: [-0.5, 0.2],
    rough: 0.25,
    metal: 0.25,
    clearcoat: 0.9,
    tail: '#c8962e',
    ink: '#e2b24c',
    stripe: { a: '#dcae48', b: '#101010' },
    grime: 0.2,
    soot: 0.6,
    toneVar: 0.02
  },
  darkTps: {
    top: '#5d646b',
    bottom: '#7c848b',
    counter: [-0.2, 0.25],
    rough: 0.66,
    ink: '#3c4247',
    decalTint: [0.0, 0.5, 0.8],
    grime: 0.7,
    soot: 1.0,
    toneVar: 0.08
  },
  // --- enemies ---------------------------------------------------------------
  // High-contrast enemy paint (what the stages use): dark silhouettes against
  // bright sky, cloud and sand, with bold red-orange accents. Accent geometry
  // (fin bands, wing tips, stripes) is set per design in its `schemes.enemy`.
  enemyCharcoal: {
    top: '#282d33',
    bottom: '#3c434b',
    counter: [-0.35, 0.12],
    camo: { mode: 2, colors: ['#1f2328', '#32383f'], t1: 0.4, t2: 0.72 },
    rough: 0.62,
    metal: 0.06,
    tail: '#ea4a1a',
    stripe: { a: '#ff5a1c', b: '#a3210f' },
    ink: '#d9d4c8',
    grime: 0.35,
    soot: 0.8,
    toneVar: 0.04
  },
  enemyStealthBlack: {
    top: '#1b1e23',
    bottom: '#2a2f36',
    counter: [-0.3, 0.2],
    rough: 0.5,
    metal: 0.1,
    tail: '#ff6a1a',
    stripe: { a: '#ff6a1a', b: '#1b1e23' },
    ink: '#e0dccf',
    grime: 0.25,
    soot: 0.7,
    toneVar: 0.03
  },
  enemyHeloDark: {
    top: '#383d33',
    bottom: '#4b5046',
    counter: [-0.3, 0.2],
    rough: 0.7,
    stripe: { a: '#ff6a1a', b: '#2a2e27' },
    ink: '#d9d4c8',
    grime: 0.6,
    soot: 1.1
  },
  enemyBomberDark: {
    top: '#3a4047',
    bottom: '#59616a',
    counter: [-0.3, 0.2],
    rough: 0.6,
    metal: 0.06,
    tail: '#ea4a1a',
    stripe: { a: '#ff5a1c', b: '#a3210f' },
    ink: '#d9d4c8',
    grime: 0.45,
    soot: 1.0
  },
  // older sky-camouflage schemes (kept for the hangar / showcase)
  enemySplinterBlue: {
    top: '#8398a8',
    bottom: '#b9c7d0',
    counter: [-0.35, 0.1],
    camo: { mode: 2, colors: ['#566b7d', '#a9b6be'], t1: 0.36, t2: 0.7 },
    rough: 0.6,
    ink: '#b3261e',
    grime: 0.6,
    soot: 1.0
  },
  enemyStealth: {
    top: '#6c7a88',
    bottom: '#8d9aa5',
    counter: [-0.3, 0.2],
    camo: { mode: 2, colors: ['#4c5968', '#93a2ae'], t1: 0.4, t2: 0.72 },
    rough: 0.5,
    metal: 0.12,
    ink: '#b3261e',
    grime: 0.4,
    soot: 1.0
  },
  enemyDesert: {
    top: '#b59e74',
    bottom: '#cfc6b0',
    counter: [-0.35, 0.1],
    camo: { mode: 2, colors: ['#86704f', '#6a6c55'], t1: 0.38, t2: 0.7 },
    rough: 0.66,
    ink: '#b3261e',
    grime: 0.7,
    soot: 1.2
  },
  enemyWhite: {
    top: '#e6e6e0',
    bottom: '#dcdcd6',
    counter: [-0.3, 0.2],
    camo: { mode: 2, colors: ['#c9cbc8', '#f0f0ea'], t1: 0.5, t2: 0.8 },
    rough: 0.38,
    ink: '#b3261e',
    grime: 0.5,
    soot: 1.2
  },
  tankerGray: {
    top: '#6f767c',
    bottom: '#7a8187',
    counter: [-0.3, 0.2],
    rough: 0.55,
    ink: '#1b1d20',
    grime: 0.6,
    soot: 1.0
  },
  olive: {
    top: '#4c5234',
    bottom: '#555b3d',
    counter: [-0.3, 0.2],
    rough: 0.75,
    ink: '#111111',
    decalTint: [0.3, 0.7, 1.0],
    grime: 0.8,
    soot: 1.2
  },
  missileWhite: {
    top: '#e2e2de',
    bottom: '#dcdcd8',
    counter: [-0.3, 0.2],
    rough: 0.4,
    ink: '#222222',
    grime: 0.25,
    soot: 0.0,
    panelStrength: 0.4
  },
  navalHaze: {
    top: '#8b9398',
    bottom: '#7f878c',
    counter: [-0.2, 0.3],
    rough: 0.7,
    ink: '#f2f2f2',
    grime: 0.8,
    soot: 1.0,
    toneVar: 0.04
  }
};

const DEFAULTS = {
  top: '#909090',
  bottom: '#b0b0b0',
  counter: [-0.3, 0.15],
  camo: null,
  camoScale: 0.18,
  stripe: null,
  tail: null,
  tailTipY: 1e9,
  tailZ: -1e9,
  panel: [1.5, 0.75],
  groove: 0.005,
  panelStrength: 1.0,
  grime: 0.5,
  soot: 1.0,
  sootRange: null, // [z0, z1, |x| max]
  radomeZ: null,
  radomeColor: null, // null: derived from the top colour
  antiGlare: null,
  antiGlareColor: '#26292c',
  waterline: null,
  rough: 0.5,
  metal: 0.06,
  roughVar: 0.08,
  toneVar: 0.05,
  bump: 1.0,
  clearcoat: 0,
  ink: '#151515',
  decalTint: [1, 1, 1],
  zones: {}
};

/**
 * Resolve the livery parameters for a design + scheme name.
 * design.schemes maps scheme -> preset name | { preset, ...overrides }.
 * design.livery supplies geometry-bound params (panel sizes, sootRange, radomeZ,
 * antiGlare, tailTipY, camoScale, stripe geometry, waterline).
 */
export function resolveLivery(design, scheme) {
  const map = design.schemes || {};
  let entry = map[scheme] ?? map[design.defaultScheme] ?? Object.values(map)[0] ?? {};
  if (typeof entry === 'string') entry = { preset: entry };
  const preset = PRESETS[entry.preset] || {};
  const geo = design.livery || {};
  const liv = { ...DEFAULTS, ...preset, ...entry, ...geo };
  const stripeCol = entry.stripe || preset.stripe;
  liv.stripe = stripeCol ? { ...(geo.stripe || {}), ...stripeCol } : null;
  liv.zones = { ...(geo.zones || {}), ...(preset.zones || {}), ...(entry.zones || {}) };
  liv.scheme = map[scheme] !== undefined ? scheme : design.defaultScheme;
  return liv;
}

const col = (hex) => new Color(hex); // sRGB hex -> linear working space

/** Build the uniform objects for a body material. */
export function liveryUniforms(liv, decals, atlas) {
  const zones = [];
  for (let i = 0; i < ZONE_COUNT; i++) {
    const z = liv.zones[i] || DEFAULT_ZONES[i];
    const c = col(z[0]);
    zones.push(new Vector4(c.r, c.g, c.b, z[1]));
  }
  const st = liv.stripe;
  const camo = liv.camo;
  const soot = liv.sootRange || [1e9, 1e9 + 1, 0];
  const U = {
    uLivTop: { value: col(liv.top) },
    uLivBottom: { value: col(liv.bottom) },
    uLivCounter: { value: new Vector4(liv.counter[0], liv.counter[1], 0, 0) },
    uLivCamoA: { value: col(camo ? camo.colors[0] : liv.top) },
    uLivCamoB: { value: col(camo ? camo.colors[1] : liv.top) },
    uLivCamo: { value: new Vector4(camo ? camo.mode : 0, liv.camoScale, camo ? camo.t1 : 0.5, camo ? camo.t2 : 0.5) },
    uLivStripeA: { value: col(st?.a || '#ffffff') },
    uLivStripeB: { value: col(st?.b || '#ffffff') },
    uLivStripe: { value: new Vector4(st ? 1 : 0, st?.y ?? 0, st?.amp ?? 0.2, st?.width ?? 0.1) },
    uLivStripe2: { value: new Vector4(st?.z0 ?? -100, st?.z1 ?? 100, st?.period ?? 3, st?.sideMin ?? 0.45) },
    uLivStripe3: { value: new Vector4(st?.wingZ ?? 0, st?.wingK ?? 0.4, st?.wingWidth ?? 0.16, st?.wingXMin ?? st?.fuseHalf ?? 2.2) },
    uLivTail: { value: col(liv.tail || '#000000') },
    uLivTailP: { value: new Vector4(liv.tail ? 1 : 0, liv.tailTipY, liv.tailZ, 0) },
    uLivPanel: { value: new Vector4(liv.panel[0], liv.panel[1], liv.groove, liv.panelStrength) },
    uLivWear: { value: new Vector4(liv.grime, liv.soot, soot[0], soot[1]) },
    uLivMisc: { value: new Vector4(soot[2], liv.toneVar, liv.roughVar, liv.bump) },
    uLivRadome: { value: new Vector4(liv.radomeZ ?? -1e9, liv.radomeZ != null ? 1 : 0, 0, 0) },
    uLivRadomeCol: { value: liv.radomeColor ? col(liv.radomeColor) : col(liv.top).multiplyScalar(0.8) },
    uLivGlare: {
      value: liv.antiGlare ? new Vector4(liv.antiGlare[0], liv.antiGlare[1], liv.antiGlare[2], 1) : new Vector4(0, 0, 0, 0)
    },
    uLivGlareCol: { value: col(liv.antiGlareColor) },
    uLivWater: { value: liv.waterline ? new Vector4(liv.waterline[0], liv.waterline[1], 1, 0) : new Vector4(0, 0, 0, 0) },
    uLivMat: { value: new Vector4(liv.rough, liv.metal, 0, 0) },
    uLivZones: { value: zones },
    uLivInk: { value: col(liv.ink) },
    uLivDecalTex: { value: atlas.texture },
    uLivDecC: { value: [] },
    uLivDecU: { value: [] },
    uLivDecV: { value: [] },
    uLivDecN: { value: [] },
    uLivDecR: { value: [] },
    uLivDecTint: { value: new Vector4(liv.decalTint[0], liv.decalTint[1], liv.decalTint[2], 0) }
  };
  packDecals(U, decals, liv.scheme, atlas);
  return U;
}

function axisVec(a) {
  if (a === 'x') return new Vector3(1, 0, 0);
  if (a === 'y') return new Vector3(0, 1, 0);
  if (a === 'z') return new Vector3(0, 0, 1);
  return new Vector3(a[0], a[1], a[2]).normalize();
}

/** Expand decal specs (+ mirrored copies) and write them into uniform arrays. */
function packDecals(U, decals = [], scheme, atlas) {
  const list = [];
  for (const d of decals) {
    if (d.schemes && !d.schemes.includes(scheme)) continue;
    if (d.notSchemes && d.notSchemes.includes(scheme)) continue;
    list.push(d);
    if (d.mirror) {
      const ax = Array.isArray(d.axis) ? [-d.axis[0], d.axis[1], d.axis[2]] : d.axis;
      list.push({ ...d, mirror: false, center: [-d.center[0], d.center[1], d.center[2]], axis: ax });
    }
  }
  const C = U.uLivDecC.value;
  const UU = U.uLivDecU.value;
  const V = U.uLivDecV.value;
  const N = U.uLivDecN.value;
  const R = U.uLivDecR.value;
  let count = 0;
  for (let i = 0; i < MAX_DECALS; i++) {
    const d = list[i];
    const rect = d ? atlas.rects[d.tex] || d.texRect : null;
    if (!d || !rect || !atlas.ready) {
      C.push(new Vector4());
      UU.push(new Vector4());
      V.push(new Vector4());
      N.push(new Vector4());
      R.push(new Vector4());
      continue;
    }
    count = i + 1;
    const n = axisVec(d.axis);
    let up = d.up ? new Vector3(...d.up) : Math.abs(n.y) > 0.8 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    up = up.sub(n.clone().multiplyScalar(up.dot(n))).normalize();
    const u = new Vector3().crossVectors(up, n).normalize();
    if (d.flipU) u.negate();
    const ink = d.ink ?? atlas.ink[d.tex] ?? false;
    const side = d.side ?? 0;
    C.push(new Vector4(d.center[0], d.center[1], d.center[2], side + (ink ? 4 : 0)));
    UU.push(new Vector4(u.x, u.y, u.z, 1 / d.size[0]));
    V.push(new Vector4(up.x, up.y, up.z, 1 / d.size[1]));
    N.push(new Vector4(n.x, n.y, n.z, d.depth ?? 0.5));
    R.push(new Vector4(rect[0], rect[1], rect[2], rect[3]));
  }
  U.uLivDecTint.value.w = count;
}

// ---- decal atlas ---------------------------------------------------------------
// 1024 x 1024 canvas. rect = [u0, v0, du, dv] in texture space (v up).

const ATLAS_SIZE = 1024;
const LAYOUT = {
  // text cells 256 x 128 (white "ink" glyphs, recoloured per scheme)
  n100: [0, 0, 256, 128, 'ink'],
  n205: [256, 0, 256, 128, 'ink'],
  n301: [512, 0, 256, 128, 'ink'],
  n07: [768, 0, 256, 128, 'ink'],
  tailCode: [0, 128, 256, 128, 'ink'],
  tailCode2: [256, 128, 256, 128, 'ink'],
  hull71: [512, 128, 256, 128, 'ink'],
  rescue: [768, 128, 256, 128],
  roundel: [0, 256, 256, 256],
  emblemBolt: [256, 256, 256, 256],
  emblemEagle: [512, 256, 256, 256],
  emblemEnemy: [768, 256, 256, 256],
  warnTri: [0, 512, 256, 256],
  noStep: [256, 512, 256, 128, 'ink'],
  n512: [256, 640, 256, 128, 'ink'],
  emblemHornet: [512, 512, 256, 256],
  emblemTanker: [768, 512, 256, 256],
  n27: [0, 768, 256, 128, 'ink'],
  n33: [256, 768, 256, 128, 'ink'],
  n88: [512, 768, 256, 128, 'ink'],
  stencil: [768, 768, 256, 128, 'ink'],
  emblemNavy: [0, 896, 256, 128]
};

let _atlas = null;

function makeCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = ATLAS_SIZE;
    return c;
  }
  return null;
}

export function getDecalAtlas() {
  if (_atlas) return _atlas;
  const rects = {};
  const ink = {};
  for (const [k, r] of Object.entries(LAYOUT)) {
    rects[k] = [r[0] / ATLAS_SIZE, 1 - (r[1] + r[3]) / ATLAS_SIZE, r[2] / ATLAS_SIZE, r[3] / ATLAS_SIZE];
    ink[k] = r[4] === 'ink';
  }
  const canvas = makeCanvas();
  let texture;
  let ready = false;
  if (canvas) {
    try {
      drawAtlas(canvas.getContext('2d'));
      texture = new CanvasTexture(canvas);
      ready = true;
    } catch {
      texture = null; // no 2D canvas (e.g. worker without fonts): decals disabled
    }
  }
  if (!texture) {
    texture = new DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1, RGBAFormat);
    texture.needsUpdate = true;
  }
  texture.colorSpace = SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.anisotropy = 8;
  texture.minFilter = ready ? LinearMipmapLinearFilter : LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = ready;
  _atlas = { texture, rects, ink, ready };
  return _atlas;
}

const FONT = "'Arial Black', 'Helvetica Neue', Impact, 'DejaVu Sans', Arial, sans-serif";

function text(ctx, str, cell, { size = 96, color = '#fff', outline = null, italic = false, stretch = 1 } = {}) {
  const [x, y, w, h] = cell;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(stretch, 1);
  ctx.font = `${italic ? 'italic ' : ''}900 ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = outline;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, 0, size * 0.04);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, 0, size * 0.04);
  ctx.restore();
}

function star(ctx, cx, cy, n, r0, r1, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r1 : r0;
    const a = rot + (i * Math.PI) / n;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawAtlas(ctx) {
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const L = LAYOUT;
  // numbers / codes (white ink with dark keyline so they stay readable)
  text(ctx, '100', L.n100, { size: 104, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, '205', L.n205, { size: 104, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, '301', L.n301, { size: 104, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, '07', L.n07, { size: 110, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, 'XR', L.tailCode, { size: 118, stretch: 1.1 });
  text(ctx, 'SJ', L.tailCode2, { size: 118, stretch: 1.1 });
  text(ctx, '71', L.hull71, { size: 118, outline: 'rgba(0,0,0,0.85)' });
  text(ctx, 'NO STEP', L.noStep, { size: 58 });
  text(ctx, '512', L.n512, { size: 104, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, '27', L.n27, { size: 112, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, '33', L.n33, { size: 112, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, '88', L.n88, { size: 112, outline: 'rgba(0,0,0,0.9)' });
  text(ctx, 'AF-9 214', L.stencil, { size: 50 });

  // RESCUE arrow (yellow / black)
  {
    const [x, y, w, h] = L.rescue;
    ctx.save();
    ctx.fillStyle = '#e8b21c';
    ctx.beginPath();
    ctx.moveTo(x + 14, y + 34);
    ctx.lineTo(x + w - 60, y + 34);
    ctx.lineTo(x + w - 60, y + 14);
    ctx.lineTo(x + w - 8, y + h / 2);
    ctx.lineTo(x + w - 60, y + h - 14);
    ctx.lineTo(x + w - 60, y + h - 34);
    ctx.lineTo(x + 14, y + h - 34);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    text(ctx, 'RESCUE', [x - 20, y, w, h], { size: 40, color: '#111' });
  }

  // roundel (fictional): navy disc, white ring, red core with white 4-point star
  {
    const [x, y, w] = L.roundel;
    const cx = x + w / 2;
    const cy = y + w / 2;
    ctx.save();
    ctx.fillStyle = '#1b2f63';
    ctx.beginPath();
    ctx.arc(cx, cy, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f2ee';
    ctx.beginPath();
    ctx.arc(cx, cy, 92, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c1272d';
    ctx.beginPath();
    ctx.arc(cx, cy, 66, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f2ee';
    star(ctx, cx, cy, 4, 58, 16, -Math.PI / 2);
    ctx.fill();
    ctx.restore();
  }
  // squadron emblem: black shield, gold bolt, stars
  {
    const [x, y, w] = L.emblemBolt;
    const cx = x + w / 2;
    ctx.save();
    ctx.fillStyle = '#d8aa3e';
    ctx.beginPath();
    ctx.moveTo(cx - 100, y + 20);
    ctx.lineTo(cx + 100, y + 20);
    ctx.lineTo(cx + 100, y + 130);
    ctx.quadraticCurveTo(cx + 96, y + 210, cx, y + 244);
    ctx.quadraticCurveTo(cx - 96, y + 210, cx - 100, y + 130);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#101012';
    ctx.beginPath();
    ctx.moveTo(cx - 88, y + 32);
    ctx.lineTo(cx + 88, y + 32);
    ctx.lineTo(cx + 88, y + 128);
    ctx.quadraticCurveTo(cx + 84, y + 200, cx, y + 230);
    ctx.quadraticCurveTo(cx - 84, y + 200, cx - 88, y + 128);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e6b84a';
    ctx.beginPath();
    ctx.moveTo(cx + 20, y + 44);
    ctx.lineTo(cx - 42, y + 140);
    ctx.lineTo(cx - 2, y + 138);
    ctx.lineTo(cx - 24, y + 214);
    ctx.lineTo(cx + 46, y + 110);
    ctx.lineTo(cx + 6, y + 112);
    ctx.lineTo(cx + 34, y + 44);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c1272d';
    star(ctx, cx - 56, y + 64, 5, 16, 7);
    ctx.fill();
    star(ctx, cx + 58, y + 150, 5, 16, 7);
    ctx.fill();
    ctx.restore();
  }
  // eagle-like chevron emblem
  {
    const [x, y, w] = L.emblemEagle;
    const cx = x + w / 2;
    const cy = y + w / 2;
    ctx.save();
    ctx.fillStyle = '#9c1c20';
    ctx.beginPath();
    ctx.arc(cx, cy, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9c35a';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 70);
    ctx.lineTo(cx + 118, cy + 20);
    ctx.lineTo(cx + 40, cy + 6);
    ctx.lineTo(cx, cy + 70);
    ctx.lineTo(cx - 40, cy + 6);
    ctx.lineTo(cx - 118, cy + 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f1e6';
    star(ctx, cx, cy - 8, 5, 22, 9);
    ctx.fill();
    ctx.restore();
  }
  // enemy emblem (original): red 4-point star, white border, dark centre
  {
    const [x, y, w] = L.emblemEnemy;
    const cx = x + w / 2;
    const cy = y + w / 2;
    ctx.save();
    ctx.fillStyle = '#f2f2ee';
    star(ctx, cx, cy, 4, 124, 46, -Math.PI / 2);
    ctx.fill();
    ctx.fillStyle = '#b8201c';
    star(ctx, cx, cy, 4, 104, 34, -Math.PI / 2);
    ctx.fill();
    ctx.fillStyle = '#f2f2ee';
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1f2c';
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // ejection warning triangle
  {
    const [x, y, w] = L.warnTri;
    const cx = x + w / 2;
    ctx.save();
    ctx.fillStyle = '#c42420';
    ctx.beginPath();
    ctx.moveTo(cx, y + 18);
    ctx.lineTo(cx + 116, y + 220);
    ctx.lineTo(cx - 116, y + 220);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#f4f0e6';
    ctx.beginPath();
    ctx.moveTo(cx, y + 62);
    ctx.lineTo(cx + 78, y + 198);
    ctx.lineTo(cx - 78, y + 198);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.fillRect(cx - 8, y + 100, 16, 60);
    ctx.fillRect(cx - 8, y + 170, 16, 16);
    ctx.restore();
  }
  // hornet-like emblem: yellow/black striped stinger
  {
    const [x, y, w] = L.emblemHornet;
    const cx = x + w / 2;
    const cy = y + w / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 116);
    ctx.lineTo(cx + 90, cy + 90);
    ctx.lineTo(cx - 90, cy + 90);
    ctx.closePath();
    ctx.fillStyle = '#141414';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#f0c020';
    for (let i = -6; i < 8; i += 2) ctx.fillRect(cx - 120, cy + i * 20, 240, 20);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#141414';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 116);
    ctx.lineTo(cx + 90, cy + 90);
    ctx.lineTo(cx - 90, cy + 90);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  // tanker emblem: blue disc with white wings
  {
    const [x, y, w] = L.emblemTanker;
    const cx = x + w / 2;
    const cy = y + w / 2;
    ctx.save();
    ctx.fillStyle = '#20407a';
    ctx.beginPath();
    ctx.arc(cx, cy, 100, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(cx - 96, cy - 10, 192, 20);
    star(ctx, cx, cy, 5, 50, 20);
    ctx.fill();
    ctx.restore();
  }
  // fictional service text
  text(ctx, 'NAVAL AIR', L.emblemNavy, { size: 44, color: '#111' });
}
