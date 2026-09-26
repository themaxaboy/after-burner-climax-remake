// Example `def.terrain` blocks (CONTRACTS §6), one per profile / palette.
// Used by the dev page (dev/terrain.html) and the unit tests; stage defs can
// copy them as a starting point. Distances assume a rail of ~16 km flown at
// ~240 m/s with the rail 40–60 m above the floor (see EXAMPLE_RAIL).
//
// Fields
//   seed        noise / obstacle seed
//   profile     'canyon' | 'valley' | 'dunes'
//   palette     'desertRed' | 'emerald' | 'glacier' | 'dunes' | 'volcanic' | 'moonsand' (default from the profile)
//   sections    [{ s, floor | clearance, depth, width }] smoothly interpolated along s
//                 canyon: depth = wall height, width = floor half-width (depth < 20 → open desert)
//                 valley: depth = peak height above the floor, width = floor half-width
//                 dunes:  depth = dune amplitude, width = soft corridor half-width
//               floor = absolute altitude (world y); or clearance = rail height above the floor
//   centre      { keys: [[s, off], …] } | { amp, wavelength, from, to, phase }; corridor swing (m),
//               clamped to |dc/ds| ≤ 0.375 and |c| ≤ 150
//   water       { level: 0, preset } — the world ocean plane (y = 0) fills floors below 0
//   river       valley only: { depth: 7, width: 0.32 } channel depth (m) and half-width (× width)
//   snowLine    m above the floor (emerald / glacier palettes, trees stop below it)
//   trees       { density: 0..1 } instanced pines on valley slopes (medium+ quality)
//   obstacles   explicit { s, l, kind, h?, w?, r? } (l relative to the corridor centre) and
//               scatter { from, to, every: [min, max], kinds, lat: [lo, hi], h?, r?, seed? }
//               kinds: 'pillar' | 'spire' | 'arch' | 'tower' | 'bridge'
//               arch/bridge: h = clearance under the beam/deck above the floor, w = span / deck length

/** Red canyon run with a snaking corridor, rock arches and pillars. */
export const CANYON_EXAMPLE = {
  seed: 21,
  profile: 'canyon',
  palette: 'desertRed',
  sections: [
    { s: 0, floor: 0, depth: 0, width: 320 },
    { s: 1200, floor: 0, depth: 0, width: 320 },
    { s: 2400, floor: -6, depth: 170, width: 140 },
    { s: 3600, floor: -10, depth: 250, width: 100 },
    { s: 9000, floor: -12, depth: 280, width: 88 },
    { s: 12500, floor: -8, depth: 250, width: 110 },
    { s: 14200, floor: 0, depth: 0, width: 320 }
  ],
  centre: { amp: 125, wavelength: 2600, from: 2600, to: 13000 },
  obstacles: [
    { s: 5200, l: 0, kind: 'arch', h: 72 },
    { s: 10400, l: 0, kind: 'arch', h: 62 },
    { from: 3200, to: 12600, every: [380, 640], kinds: ['pillar', 'spire', 'pillar'], lat: [-0.8, 0.8] }
  ]
};

/** Emerald river valley: green slopes, snowy peaks, pines, turquoise river. */
export const VALLEY_EXAMPLE = {
  seed: 9,
  profile: 'valley',
  palette: 'emerald',
  sections: [
    { s: 0, floor: 2, depth: 380, width: 220 },
    { s: 3000, floor: 2, depth: 480, width: 140 },
    { s: 8000, floor: 3, depth: 560, width: 110 },
    { s: 12000, floor: 2, depth: 460, width: 150 }
  ],
  river: { depth: 8, width: 0.34 },
  water: { level: 0, preset: 'glacierRiver' },
  snowLine: 300,
  trees: { density: 0.8 },
  centre: { amp: 140, wavelength: 2700, from: 1800, to: 13500 },
  obstacles: [
    { s: 6200, l: 0, kind: 'bridge', h: 52 },
    { from: 2400, to: 13000, every: [650, 1000], kinds: ['tower', 'spire'], lat: [-0.7, 0.7] }
  ]
};

/** Glacier fjord: water between steep blue-grey walls, snow and ice, sea stacks. */
export const FJORD_EXAMPLE = {
  seed: 5,
  profile: 'valley',
  palette: 'glacier',
  sections: [
    { s: 0, floor: -30, depth: 420, width: 230 },
    { s: 3000, floor: -30, depth: 520, width: 135 },
    { s: 8000, floor: -26, depth: 580, width: 110 },
    { s: 12000, floor: -30, depth: 480, width: 160 }
  ],
  water: { level: 0, preset: 'glacierRiver' },
  snowLine: 160,
  trees: { density: 0.45 },
  centre: { amp: 140, wavelength: 2700, from: 1800, to: 13500 },
  obstacles: [
    { s: 7400, l: 0, kind: 'arch', h: 60 },
    { from: 2400, to: 13000, every: [420, 720], kinds: ['spire', 'pillar'], lat: [-0.75, 0.75] }
  ]
};

/** Golden dunes: soft corridor between big dunes, sandstone spires and radio towers. */
export const DUNES_EXAMPLE = {
  seed: 13,
  profile: 'dunes',
  palette: 'dunes',
  sections: [
    { s: 0, floor: 0, depth: 30, width: 160 },
    { s: 3000, floor: 0, depth: 46, width: 110 },
    { s: 12000, floor: 0, depth: 52, width: 100 }
  ],
  centre: { amp: 115, wavelength: 2400, from: 1500, to: 14000 },
  obstacles: [{ from: 2000, to: 13500, every: [420, 760], kinds: ['spire', 'pillar', 'tower'], lat: [-0.8, 0.8] }]
};

export const TERRAIN_EXAMPLES = { canyon: CANYON_EXAMPLE, valley: VALLEY_EXAMPLE, fjord: FJORD_EXAMPLE, dunes: DUNES_EXAMPLE };

/** Rail segments that fit the examples (buildRail({ start, heading, seed, step, segs })). */
export const EXAMPLE_RAIL = {
  start: [0, 55, 0],
  heading: 0,
  seed: 3,
  step: 150,
  segs: [
    { len: 2000, turn: 0, alt: 55 },
    { len: 2500, turn: 18, alt: 50 },
    { len: 2000, turn: -24, alt: 44 },
    { len: 2200, turn: 26, alt: 42 },
    { len: 2000, turn: -30, alt: 42 },
    { len: 2500, turn: 20, alt: 46 },
    { len: 2400, turn: -14, alt: 50 },
    { len: 1500, turn: 0, alt: 60 }
  ]
};
