// Wave generator: a deterministic pattern library plus a budgeted scheduler
// that keeps enemies coming at ~1.2–1.6 per second between the authored
// set pieces of a stage timeline. Run by the Director (src/sim/director.js).
//
// def.waves (all optional; see docs/overhaul/CONTRACTS.md §5):
//   seed          RNG seed (the schedule is deterministic per seed + player path)
//   rate          {base, perStar} enemies per second (+ perStar × session stars),
//                 or a number (= base)
//   maxAlive      {high, low, medium?} by quality preset, or a number. A pattern
//                 starts only when alive + pending + its size fits.
//   spans         [{from, to}] rail metres where waves run (default: everywhere)
//   quiet         [[from, to]] pauses inside spans (set pieces); pending spawns
//                 of a pattern that runs into a quiet span are dropped
//   mix           [[pattern, weight, {minS, maxS, minRank, maxRank, ...opts}]]
//   types         {light, heavy, helo, site, gun, boat} enemy types the
//                 patterns use (defaults below)
//   preloadTypes  extra types (for the renderer precompile)
//   gap           minimum seconds between pattern starts (>= 1.0)
//   lateral       spawn x limit as a multiple of player.box.x (default 1.1)
//
// Timeline events {at, waves: 'on' | 'off' | {rate, mix, maxAlive, ...}}
// toggle or retune the generator (Director._wavesEvent).
//
// Patterns (name: what it spawns, enemy count). All positions stay within
// ±lateral·box.x and the vertical box (above the ground/sea floor):
//   vHeadOn       V3/V5 of `light` fighters head-on, 25–80 m off the player      3 / 5
//   lineHeadOn    line3/line4 abreast head-on, a little above or below you       3 / 4
//   heavyPair     two `heavy` fighters head-on, slower closing, missile-happy    2
//   rammerSolo    one kamikaze aimed at you (move > ~45 m in the last 1.5 s)     1
//   rammerPair    two kamikazes 0.8 s apart from both sides                      2
//   overtakeClose 2–3 fighters from 250 m behind passing 20–40 m from the camera 2–3
//   crossSweep    3–4 crossing fighters in echelon from one side                 3–4
//   swarmPass     8–12 fighters streaming diagonally across the view             8–12
//   chaserPair    two chasers on your six (hold −300 m, guns + AAMs), overtake   2
//   heloLine      3–4 helicopters in line ahead (EO-style filler)                3–4
//   groundSites   2–3 AA guns / SAM sites on the ground ahead (terrain stages)   2–3
//   boatGroup     2–3 SAM boats on the sea ahead (ocean stages)                  2–3
//
// A pattern is (rng, ctx, opts) → [{dt, type, behavior, x, y, dist, params,
// formation, spread, count, world, ground, heading}] where `dt` is the delay
// from the pattern start. Entries with `rel: true` carry dx/dy offsets that are
// resolved against the player's position at spawn time (aimed patterns).
import { Rng } from '../core/rng.js';
import { clamp } from '../core/math.js';

const TAU = Math.PI * 2;

export const WAVE_TYPES = { light: 'fighterA', heavy: 'stealthB', helo: 'heloCH47', site: 'samSite', gun: 'aaGun', boat: 'samBoat' };

/** Built-in generator used when a stage has no def.waves but `?waves=1` is set. */
export const DEFAULT_WAVES = {
  seed: 7,
  rate: { base: 1.4, perStar: 0.12 },
  maxAlive: { high: 20, medium: 17, low: 14 },
  spans: [{ from: 900, to: 1e9 }],
  quiet: [],
  mix: [
    ['vHeadOn', 4],
    ['lineHeadOn', 2],
    ['rammerSolo', 1.5],
    ['rammerPair', 1.5, { minS: 2500 }],
    ['overtakeClose', 2],
    ['crossSweep', 1.5],
    ['swarmPass', 1.2, { minS: 2000 }],
    ['chaserPair', 1, { minS: 3500 }],
    ['heavyPair', 1, { minS: 1500 }]
  ],
  types: { light: 'fighterA', heavy: 'stealthB' }
};

const DEFAULTS = {
  seed: 1,
  rate: { base: 1.3, perStar: 0.12 },
  maxAlive: { high: 20, low: 14 },
  spans: null,
  quiet: [],
  mix: [['vHeadOn', 1]],
  gap: 1.0,
  lateral: 1.1,
  startBudget: 3
};

// half widths of the formations used below (x, before `spread`)
const HALF = { single: 0, pair: 14, V3: 20, V5: 40, line3: 34, line4: 51 };

// ------------------------------------------------------------------ patterns
function headOnParams(rng, amp = [20, 60]) {
  return { ph: rng.next() * TAU, ax: rng.range(amp[0], amp[1]), fq: rng.range(0.5, 1.0) };
}

export const PATTERNS = {
  vHeadOn(rng, c, o) {
    const five = c.rank >= 2 ? rng.next() < 0.6 : rng.next() < 0.35;
    const form = five ? 'V5' : 'V3';
    const spread = c.fit(rng.range(1.0, 1.3), HALF[form]);
    return [{
      dt: 0, type: o.type || c.types.light, behavior: 'headOn', formation: form, count: five ? 5 : 3, spread,
      rel: true, dx: rng.sign() * rng.range(25, 80), dy: rng.range(-10, 30), half: HALF[form] * spread, vm: 6 * spread,
      dist: rng.range(1350, 1750), params: headOnParams(rng)
    }];
  },

  lineHeadOn(rng, c, o) {
    const four = rng.next() < 0.45;
    const form = four ? 'line4' : 'line3';
    const spread = c.fit(rng.range(1.1, 1.5), HALF[form]);
    return [{
      dt: 0, type: o.type || c.types.light, behavior: 'headOn', formation: form, count: four ? 4 : 3, spread,
      rel: true, dx: rng.range(-40, 40), dy: rng.sign() * rng.range(20, 40), half: HALF[form] * spread, vm: 4,
      dist: rng.range(1400, 1800), params: headOnParams(rng, [20, 35])
    }];
  },

  heavyPair(rng, c, o) {
    const spread = c.fit(2.2, HALF.pair);
    return [{
      dt: 0, type: o.type || c.types.heavy, behavior: 'headOn', formation: 'pair', count: 2, spread,
      rel: true, dx: rng.sign() * rng.range(30, 70), dy: rng.range(0, 30), half: HALF.pair * spread, vm: 4,
      dist: rng.range(1500, 1800), params: { ...headOnParams(rng, [25, 45]), spd: rng.range(120, 160) }
    }];
  },

  rammerSolo(rng, c, o) {
    return [{
      dt: 0, type: o.type || c.types.light, behavior: 'rammer', count: 1,
      rel: true, dx: rng.range(-30, 30), dy: rng.range(-10, 15), half: 0, vm: 4, dist: rng.range(1350, 1650), params: {}
    }];
  },

  rammerPair(rng, c, o) {
    const side = rng.sign();
    const out = [];
    for (let i = 0; i < 2; i++) {
      out.push({
        dt: i * 0.8, type: o.type || c.types.light, behavior: 'rammer', count: 1,
        rel: true, dx: (i ? -side : side) * rng.range(40, 90), dy: rng.range(-10, 25), half: 0, vm: 4,
        dist: rng.range(1400, 1650), params: {}
      });
    }
    return out;
  },

  overtakeClose(rng, c, o) {
    const n = c.rank >= 2 && rng.next() < 0.5 ? 3 : 2;
    let side = rng.sign();
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        dt: i * 0.6, type: o.type || c.types.light, behavior: 'overtakeClose', count: 1,
        rel: true, dx: side * rng.range(25, 60), dy: rng.range(-5, 15), half: 0, vm: 4,
        dist: -250 - i * 40, params: { pass: rng.range(20, 40) }
      });
      side = -side;
    }
    return out;
  },

  crossSweep(rng, c, o) {
    const n = rng.next() < 0.5 ? 4 : 3;
    const side = rng.sign();
    const d0 = rng.range(800, 1100);
    const y0 = c.py + rng.range(-10, 40);
    const v = rng.range(170, 210);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        dt: i * 0.35, type: o.type || c.types.light, behavior: 'crossing', count: 1,
        x: side * c.xLim, y: c.clampY(y0 + i * 6), dist: d0 + i * 40, params: { v }
      });
    }
    return out;
  },

  swarmPass(rng, c, o) {
    const n = c.quality === 'low' ? 8 : rng.int(8, 12);
    const side = rng.sign();
    const y0 = c.py + rng.range(-20, 45);
    const vx = rng.range(140, 170);
    const close = rng.range(170, 210);
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        dt: i * 0.14 + rng.next() * 0.05, type: o.type || c.types.light, behavior: 'swarmPass', count: 1,
        x: c.clampX(side * c.xLim - side * rng.range(0, 30)), y: c.clampY(y0 + rng.range(-15, 15)),
        dist: 950 + rng.range(-80, 120) + i * 25,
        params: { side, vx: vx * rng.range(0.92, 1.08), vy: rng.range(0, 10), close }
      });
    }
    return out;
  },

  chaserPair(rng, c, o) {
    const side = rng.sign();
    const out = [];
    for (let i = 0; i < 2; i++) {
      out.push({
        dt: i * 0.9, type: o.type || c.types.light, behavior: 'chaser', count: 1,
        rel: true, dx: (i ? -side : side) * rng.range(25, 60), dy: rng.range(5, 25), half: 0, vm: 4,
        dist: -450 - i * 40, params: { hold: -300 + rng.range(-30, 30) }
      });
    }
    return out;
  },

  heloLine(rng, c, o) {
    const four = rng.next() < 0.5;
    const form = four ? 'line4' : 'line3';
    const spread = c.fit(1.6, HALF[form]);
    return [{
      dt: 0, type: o.type || c.types.helo, behavior: 'hover', formation: form, count: four ? 4 : 3, spread,
      x: c.clampX(c.px + rng.range(-40, 40), HALF[form] * spread), y: c.clampY(c.py + rng.range(0, 30), 4),
      dist: rng.range(2000, 2400), params: {}
    }];
  },

  groundSites(rng, c, o) {
    const n = rng.next() < 0.5 ? 3 : 2;
    const out = [];
    let d = rng.range(2200, 2600);
    for (let i = 0; i < n; i++) {
      out.push({
        dt: i * 0.3, type: o.type || (rng.next() < 0.5 ? c.types.site : c.types.gun), behavior: 'static', count: 1,
        world: true, ground: true, x: rng.range(-0.9, 0.9) * c.xLim, y: 0, dist: d, heading: rng.range(-30, 30)
      });
      d += rng.range(250, 450);
    }
    return out;
  },

  boatGroup(rng, c, o) {
    const n = rng.next() < 0.5 ? 3 : 2;
    let side = rng.sign();
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
        dt: i * 0.4, type: o.type || c.types.boat, behavior: 'static', count: 1,
        world: true, ground: false, x: side * rng.range(0.3, 1) * c.xLim, y: 0, dist: 2600 + i * 400 + rng.range(-100, 100),
        heading: rng.range(150, 210)
      });
      side = -side;
    }
    return out;
  }
};

/** Enemy types a wave config can spawn (for renderer precompile). */
export function waveTypes(cfg) {
  if (!cfg) return [];
  const types = { ...WAVE_TYPES, ...(cfg.types || {}) };
  const out = new Set(cfg.preloadTypes || []);
  for (const [name, , o] of cfg.mix || DEFAULTS.mix) {
    if (o?.type) out.add(o.type);
    else if (name === 'heavyPair') out.add(types.heavy);
    else if (name === 'heloLine') out.add(types.helo);
    else if (name === 'groundSites') {
      out.add(types.site);
      out.add(types.gun);
    } else if (name === 'boatGroup') out.add(types.boat);
    else out.add(types.light);
  }
  return [...out];
}

// ----------------------------------------------------------------- scheduler
export class WaveGen {
  constructor(cfg = {}) {
    this.rng = new Rng((cfg.seed ?? DEFAULTS.seed) >>> 0);
    this.cfg = { ...DEFAULTS, rate: { ...DEFAULTS.rate }, types: { ...WAVE_TYPES }, quiet: [], spans: null };
    this.configure(cfg);
    this.on = cfg.enabled !== false;
    this.time = 0;
    this.budget = this.cfg.startBudget;
    this.sinceLast = 1e9;
    this.pending = []; // [{at, sp}] sorted by `at`
    this.pendingCount = 0;
    this.next = null; // {name, list, cost, wait}
    this.lastName = null;
    this.spawned = 0;
    this.patterns = 0;
    this._ctx = {
      s: 0, px: 0, py: 0, rank: 0, quality: 'high', types: this.cfg.types, xLim: 77, yLo: -36, yHi: 36,
      clampX: (x, half = 0) => {
        const lim = Math.max(0, this._ctx.xLim - half);
        return clamp(x, -lim, lim);
      },
      clampY: (y, m = 8) => {
        const c = this._ctx;
        const lo = c.yLo + m, hi = c.yHi - m;
        return lo > hi ? (c.yLo + c.yHi) / 2 : clamp(y, lo, hi);
      },
      fit: (spread, half) => (half * spread > this._ctx.xLim ? (this._ctx.xLim / half) * 0.9 : spread)
    };
  }

  /** Merge (part of) a waves config: rate, maxAlive, spans, quiet, mix, types, gap, lateral. */
  configure(w) {
    const c = this.cfg;
    if (w.rate != null) c.rate = typeof w.rate === 'number' ? { ...c.rate, base: w.rate } : { ...c.rate, ...w.rate };
    if (w.maxAlive != null) c.maxAlive = w.maxAlive;
    if (w.spans !== undefined) c.spans = w.spans;
    if (w.quiet) c.quiet = w.quiet;
    if (w.mix) {
      for (const m of w.mix) if (!PATTERNS[m[0]]) throw new Error(`unknown wave pattern ${m[0]}`);
      c.mix = w.mix;
    }
    if (w.types) Object.assign(c.types, w.types);
    if (w.gap != null) c.gap = Math.max(1, w.gap);
    if (w.lateral != null) c.lateral = w.lateral;
    if (w.startBudget != null) c.startBudget = w.startBudget;
  }

  rate(rank = 0) {
    const r = this.cfg.rate;
    return Math.max(0, (r.base ?? 1.3) + (r.perStar ?? 0) * rank);
  }

  maxAlive(quality = 'high') {
    const m = this.cfg.maxAlive;
    if (typeof m === 'number') return m;
    if (quality === 'low') return m.low ?? m.high ?? 14;
    if (quality === 'medium') return m.medium ?? Math.round(((m.high ?? 20) + (m.low ?? m.high ?? 14)) / 2);
    return m.high ?? 20;
  }

  /** Waves run at rail distance s? (inside a span and outside quiet ranges) */
  active(s) {
    const c = this.cfg;
    if (c.spans && c.spans.length) {
      let inSpan = false;
      for (const sp of c.spans) {
        if (s >= sp.from && s <= sp.to) {
          inSpan = true;
          break;
        }
      }
      if (!inSpan) return false;
    }
    for (const q of c.quiet) if (s >= q[0] && s <= q[1]) return false;
    return true;
  }

  /**
   * @param {number} dt world seconds
   * @param {object} player Player (s, x, y, box, boxCenterY, frame)
   * @param {object} dir Director: spawnGroup(sp, player) + api {rank, quality, aliveCount, worldPoint}
   */
  update(dt, player, dir) {
    this.time += dt;
    this.sinceLast += dt;
    if (!this.on || !this.active(player.s)) {
      // leaving a span / entering a quiet range cancels what was still queued
      this.pending.length = 0;
      this.pendingCount = 0;
      this.next = null;
      this.budget = Math.min(this.budget, 1);
      return;
    }
    const api = dir.api;
    const rank = api.rank ? api.rank() : 0;
    const rate = this.rate(rank);
    this.budget = Math.min(this.budget + rate * dt, rate * 4 + 12);

    this._flush(player, dir);

    if (this.sinceLast < this.cfg.gap) return;
    if (!this.next) this.next = this._pick(player, api, rank);
    const n = this.next;
    if (!n) return;
    if (n.cost > this.budget) return; // saving up for it
    const alive = (api.aliveCount ? api.aliveCount() : 0) + this.pendingCount;
    if (alive + n.cost > this.maxAlive(api.quality ? api.quality() : 'high')) {
      n.wait += dt;
      if (n.wait > 2.5) this.next = null; // try a smaller pattern
      return;
    }
    // launch the pattern
    for (const sp of n.list) {
      const at = this.time + (sp.dt || 0);
      let i = this.pending.length;
      while (i > 0 && this.pending[i - 1].at > at) i--;
      this.pending.splice(i, 0, { at, sp });
      this.pendingCount += sp.count ?? 1;
    }
    this.budget -= n.cost;
    this.sinceLast = 0;
    this.lastName = n.name;
    this.patterns++;
    this.next = null;
    this._flush(player, dir);
  }

  _flush(player, dir) {
    const q = this.pending;
    let k = 0;
    while (k < q.length && q[k].at <= this.time + 1e-9) {
      const sp = q[k].sp;
      this.pendingCount -= sp.count ?? 1;
      this._spawn(sp, player, dir);
      k++;
    }
    if (k) q.splice(0, k);
  }

  _spawn(sp, player, dir) {
    if (sp.rel) {
      this._refresh(player, dir.api);
      const c = this._ctx;
      sp.x = c.clampX(player.x + sp.dx, sp.half || 0);
      sp.y = c.clampY(player.y + sp.dy, sp.vm ?? 8);
    }
    const list = dir.spawnGroup(sp, player);
    this.spawned += list ? list.length : 0;
  }

  /** Player-relative spawn bounds (lateral limit, vertical box above the floor). */
  _refresh(player, api) {
    const c = this._ctx;
    c.s = player.s;
    c.px = player.x;
    c.py = player.y;
    c.xLim = this.cfg.lateral * (player.box?.x ?? 70);
    const cy = player.boxCenterY || 0;
    const by = player.box?.y ?? 36;
    let lo = cy - by;
    if (api.worldPoint && player.frame) {
      // keep aircraft ~20 m above the ground / sea ahead
      const g = api.worldPoint(player.s + 1200, 0, 0, true);
      lo = Math.max(lo, g.y - player.frame.pos.y + 20);
    }
    c.yLo = lo;
    c.yHi = Math.max(cy + by, lo + 16);
  }

  _pick(player, api, rank) {
    const c = this._ctx;
    this._refresh(player, api);
    c.rank = rank;
    c.quality = api.quality ? api.quality() : 'high';
    c.types = this.cfg.types;
    const s = player.s;
    let total = 0;
    const mix = this.cfg.mix;
    const ok = this._ok || (this._ok = []);
    ok.length = 0;
    for (const m of mix) {
      const o = m[2];
      if (o) {
        if (o.minS != null && s < o.minS) continue;
        if (o.maxS != null && s > o.maxS) continue;
        if (o.minRank != null && rank < o.minRank) continue;
        if (o.maxRank != null && rank > o.maxRank) continue;
      }
      ok.push(m);
      total += m[1];
    }
    if (!ok.length || total <= 0) return null;
    let pick = this._weighted(ok, total);
    if (pick[0] === this.lastName && ok.length > 1) pick = this._weighted(ok, total); // one re-roll for variety
    const list = PATTERNS[pick[0]](this.rng, c, pick[2] || {});
    let cost = 0;
    for (const sp of list) cost += sp.count ?? 1;
    return { name: pick[0], list, cost, wait: 0 };
  }

  _weighted(ok, total) {
    let r = this.rng.next() * total;
    for (const m of ok) {
      r -= m[1];
      if (r <= 0) return m;
    }
    return ok[ok.length - 1];
  }
}
