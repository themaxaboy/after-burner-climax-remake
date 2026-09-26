import { describe, it, expect } from 'vitest';
import { Rail } from '../../src/sim/rail.js';
import { ENEMY_TYPES } from '../../src/sim/enemyTypes.js';
import { BEHAVIORS } from '../../src/sim/enemies.js';
import { FORMATIONS } from '../../src/sim/director.js';
import { LOOKS } from '../../src/world/looks.js';
import { TRACK_IDS } from '../../src/audio/songs/index.js';
import { STAGES, STAGE_BY_ID, getStageDef } from '../../src/stages/campaign.js';
import { ROUTE_GRAPH, forkOf, nextOf, pathFor, bonusUnlocked, routeTo, choiceAt } from '../../src/stages/routes.js';
import { RouteSelect } from '../../src/stages/common/routeSelect.js';
import { gradeFor, statusReport } from '../../src/stages/status.js';
import { SKY_BOX, TERRAIN_BOX } from '../../src/stages/defs/kit.js';
import radioLines from '../../src/stages/radioLines.json';
import stagesEn from '../../src/ui/strings/stages_en.js';
import stagesTh from '../../src/ui/strings/stages_th.js';

// Wave patterns: the ENEMY stream's library (src/sim/waves.js) when present,
// else the documented list (CONTRACTS §5 / waves.js header).
const wavesMod = Object.values(import.meta.glob('../../src/sim/waves.js', { eager: true }))[0];
const PATTERN_NAMES = wavesMod?.PATTERNS
  ? Object.keys(wavesMod.PATTERNS)
  : ['vHeadOn', 'lineHeadOn', 'heavyPair', 'rammerSolo', 'rammerPair', 'overtakeClose', 'crossSweep', 'swarmPass', 'chaserPair', 'heloLine', 'groundSites', 'boatGroup'];

const G = ROUTE_GRAPH;
const ids = Object.keys(G.nodes);
const targetsOf = (n) => [n.next, ...(n.fork || []).map((o) => o.id), n.bonus?.id, n.rejoin].filter(Boolean);

// Build a stage's components against a minimal fake stage so their options
// (radio keys, spawn types) can be checked.
function partsOf(def) {
  const fake = {
    def,
    game: { params: { route: [] } },
    events: { on: () => () => {} },
    hudExtra: {},
    autopilotHint: { x: null, y: null },
    player: { baseSpeed: def.rail.baseSpeed }
  };
  return def.createLogic ? def.createLogic(fake).parts : [];
}

function collect(obj, pred, out = [], seen = new Set()) {
  if (!obj || typeof obj !== 'object' || seen.has(obj)) return out;
  seen.add(obj);
  for (const [k, v] of Object.entries(obj)) {
    if (pred(k, v)) out.push(v);
    if (v && typeof v === 'object') collect(v, pred, out, seen);
  }
  return out;
}

const radioKeysOf = (def) => {
  const keys = def.timeline.filter((ev) => ev.radio).map((ev) => ev.radio);
  for (const p of partsOf(def)) keys.push(...collect(p.opts, (k, v) => typeof v === 'string' && /^r\./.test(v)));
  return [...new Set(keys)];
};

const spawnTypesOf = (def) => {
  const types = [];
  for (const ev of def.timeline) {
    for (const sp of [].concat(ev.spawn || [], ev.eo?.spawn || [])) types.push(sp.type);
  }
  const w = def.waves;
  if (w) types.push(...Object.values(w.types || {}), ...(w.preloadTypes || []));
  types.push(...(def.preloadTypes || []));
  for (const p of partsOf(def)) types.push(...collect(p.opts, (k, v) => k === 'type' && typeof v === 'string'));
  return [...new Set(types)];
};

describe('route graph', () => {
  it('is well formed', () => {
    expect(G.nodes[G.start]).toBeTruthy();
    for (const id of ids) {
      for (const tgt of targetsOf(G.nodes[id])) expect(G.nodes[tgt], `${id} → ${tgt}`).toBeTruthy();
      const lay = G.layout[id];
      expect(lay, `layout ${id}`).toBeTruthy();
      expect(['square', 'sphere']).toContain(lay[2]);
    }
    expect(ids.filter((id) => G.nodes[id].end)).toEqual(['fortress']);
    for (const id of G.statusAfter) expect(G.nodes[id]).toBeTruthy();
    // no two nodes share a map cell
    const cells = ids.map((id) => `${G.layout[id][0]},${G.layout[id][1]}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('reaches every node from the start', () => {
    const seen = new Set([G.start]);
    const queue = [G.start];
    while (queue.length) for (const tgt of targetsOf(G.nodes[queue.shift()])) if (!seen.has(tgt)) seen.add(tgt), queue.push(tgt);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('forks have exactly two options, left and right', () => {
    for (const id of ids) {
      const f = forkOf(id);
      if (!f) continue;
      expect(f.length, id).toBe(2);
      expect(f.map((o) => o.side)).toEqual([-1, 1]);
    }
    expect(forkOf('canyon').map((o) => o.id)).toEqual(['sunset', 'glacier']);
    expect(forkOf('dunes').map((o) => o.id)).toEqual(['storm', 'volcano']);
    for (const id of ['storm', 'volcano']) expect(forkOf(id).map((o) => o.id)).toEqual(['clouds', 'strike']);
    expect(forkOf('nightfleet').map((o) => o.id)).toEqual(['whiteout', 'ravine']);
    for (const id of ['whiteout', 'ravine']) expect(forkOf(id).map((o) => o.id)).toEqual(['jetstream', 'badlands']);
  });

  it('walks both forks to the end', () => {
    expect(pathFor([])).toEqual(['ocean', 'emerald', 'canyon', 'sunset', 'dunes', 'storm', 'clouds', 'nightfleet', 'whiteout', 'jetstream', 'fortress']);
    expect(pathFor(['glacier', 'volcano', 'strike', 'ravine', 'badlands'])).toEqual(['ocean', 'emerald', 'canyon', 'glacier', 'dunes', 'volcano', 'strike', 'nightfleet', 'ravine', 'badlands', 'fortress']);
    // crossing over between the rows
    expect(pathFor(['storm', 'strike', 'ravine', 'jetstream'])).toEqual(['ocean', 'emerald', 'canyon', 'sunset', 'dunes', 'storm', 'strike', 'nightfleet', 'ravine', 'jetstream', 'fortress']);
  });

  it('has 18 stages like the original, 11 per run (13 with both bonus stages)', () => {
    expect(ids.length).toBe(18);
    expect(ids.filter((id) => G.nodes[id].bonusStage)).toEqual(['aurora', 'stratos']);
    const plans = [[], ['glacier', 'volcano', 'strike', 'ravine', 'badlands'], ['storm', 'strike', 'whiteout', 'badlands']];
    for (const plan of plans) expect(pathFor(plan).length).toBe(11);
    const all = pathFor(['aurora', 'stratos']);
    expect(all.length).toBe(13);
    expect(all.indexOf('aurora')).toBe(all.indexOf('dunes') + 1);
    expect(all.indexOf('stratos')).toBe(all.indexOf('nightfleet') + 1);
  });

  it('gates the bonus stage on cleared Emergency Orders', () => {
    const two = { a: true, b: true, c: false };
    const three = { a: true, b: true, c: true };
    expect(bonusUnlocked('dunes', { eoCleared: two, route: [] })).toBe(false);
    expect(bonusUnlocked('dunes', { eoCleared: three, route: [] })).toBe(true);
    expect(pathFor(['volcano'], { eoCleared: two })).not.toContain('aurora');
    expect(pathFor(['volcano'], { eoCleared: three }).slice(0, 7)).toEqual(['ocean', 'emerald', 'canyon', 'sunset', 'dunes', 'aurora', 'volcano']);
    expect(pathFor([], { eoCleared: three })).not.toContain('stratos');
    // ?route=…,aurora forces it (tests); flying it once is enough
    expect(pathFor(['glacier', 'aurora', 'storm']).slice(0, 7)).toEqual(['ocean', 'emerald', 'canyon', 'glacier', 'dunes', 'aurora', 'storm']);
    expect(bonusUnlocked('dunes', { eoCleared: three, route: ['aurora'] })).toBe(false);
    // the bonus rejoins the choice made at the dunes fork
    expect(nextOf('aurora', { choices: { dunes: 'volcano' } })).toBe('volcano');
    expect(nextOf('dunes', { choices: { dunes: 'volcano' }, eoCleared: {} })).toBe('volcano');
  });

  it('gates the second bonus stage on 6 cleared Emergency Orders', () => {
    const five = Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`e${i}`, true]));
    const six = { ...five, e6: true };
    expect(bonusUnlocked('nightfleet', { eoCleared: five, route: [] })).toBe(false);
    expect(bonusUnlocked('nightfleet', { eoCleared: six, route: [] })).toBe(true);
    const p6 = pathFor(['ravine'], { eoCleared: six });
    expect(p6.slice(p6.indexOf('nightfleet'), p6.indexOf('nightfleet') + 3)).toEqual(['nightfleet', 'stratos', 'ravine']);
    expect(nextOf('stratos', { choices: { nightfleet: 'ravine' } })).toBe('ravine');
  });

  it('prefers the recorded choice, then the plan, then the left arrow', () => {
    expect(choiceAt('canyon', {})).toBe('sunset');
    expect(choiceAt('canyon', { routePlan: ['glacier'] })).toBe('glacier');
    expect(choiceAt('canyon', { routePlan: ['glacier'], choices: { canyon: 'sunset' } })).toBe('sunset');
    expect(nextOf('fortress', {})).toBe(null);
  });

  it('places direct entries on the route', () => {
    expect(routeTo('dunes', ['glacier'])).toEqual({ route: ['ocean', 'emerald', 'canyon', 'glacier', 'dunes'], choices: { canyon: 'glacier' }, stageNo: 5 });
    expect(routeTo('aurora', ['strike']).stageNo).toBe(6);
    expect(routeTo('stratos', []).stageNo).toBe(9);
    expect(routeTo('badlands', ['glacier', 'strike']).choices).toEqual({ canyon: 'glacier', dunes: 'storm', storm: 'strike', nightfleet: 'whiteout', whiteout: 'badlands' });
    expect(routeTo('fortress', []).stageNo).toBe(11);
  });
});

describe('stage definitions', () => {
  it('has one def per route node, in route order', () => {
    expect(STAGES.map((s) => s.id).sort()).toEqual([...ids].sort());
    STAGES.forEach((s, i) => expect(s.index).toBe(i + 1));
    expect(getStageDef(1)).toBe(STAGE_BY_ID.ocean);
    expect(getStageDef('3')).toBe(STAGE_BY_ID.canyon);
    expect(getStageDef('glacier')).toBe(STAGE_BY_ID.glacier);
    expect(getStageDef('nope')).toBe(null);
  });

  it.each(STAGES.map((s) => [s.id, s]))('%s lasts 50–65 s', (id, def) => {
    const rail = new Rail(def.rail);
    const sec = rail.length / def.rail.baseSpeed;
    expect(rail.length).toBeGreaterThan(12000);
    expect(rail.length).toBeLessThan(15000);
    expect(def.rail.baseSpeed).toBeGreaterThanOrEqual(235);
    expect(def.rail.baseSpeed).toBeLessThanOrEqual(245);
    expect(sec).toBeGreaterThanOrEqual(50);
    expect(sec).toBeLessThanOrEqual(65);
    // timeline events stay on the rail
    for (const ev of def.timeline) if (typeof ev.at === 'number') expect(ev.at, `${id} event`).toBeLessThan(rail.length);
  });

  it.each(STAGES.map((s) => [s.id, s]))('%s uses a LOOKS preset, the right box and a known track', (id, def) => {
    expect(LOOKS[def.look], def.look).toBeTruthy();
    for (const [k, v] of Object.entries(LOOKS[def.look])) if (k !== 'clouds' && k !== 'ocean') expect(def.env[k], `${id}.env.${k}`).toEqual(v);
    expect(TRACK_IDS).toContain(def.music);
    if (def.terrain) {
      expect(def.rail.box).toEqual(TERRAIN_BOX);
      expect(def.rail.noRoll).toBe(true);
      expect(['canyon', 'valley', 'dunes']).toContain(def.terrain.profile);
      const ss = def.terrain.sections.map((s) => s.s);
      expect(ss).toEqual([...ss].sort((a, b) => a - b));
    } else expect(def.rail.box).toEqual(SKY_BOX);
    expect(def.par.time).toBeGreaterThan(0);
    expect(def.par.combo).toBeGreaterThan(0);
    expect(def.par.downRate).toBeGreaterThan(0);
  });

  it.each(STAGES.map((s) => [s.id, s]))('%s has waves and a short authored timeline', (id, def) => {
    const w = def.waves;
    expect(w).toBeTruthy();
    const lo = def.bonus ? 1.2 : 1.2, hi = def.bonus ? 2.5 : 2.0;
    expect(w.rate.base).toBeGreaterThanOrEqual(lo);
    expect(w.rate.base).toBeLessThanOrEqual(hi);
    for (const sp of w.spans) expect(sp.from).toBeLessThan(sp.to);
    for (const q of w.quiet) expect(q[0]).toBeLessThan(q[1]);
    expect(w.mix.length).toBeGreaterThan(0);
    for (const [name, weight] of w.mix) {
      expect(PATTERN_NAMES, `${id} pattern ${name}`).toContain(name);
      expect(weight).toBeGreaterThan(0);
    }
    expect(def.timeline.length).toBeLessThanOrEqual(15);
  });

  it.each(STAGES.map((s) => [s.id, s]))('%s spawns known enemy types, behaviours and formations', (id, def) => {
    for (const ty of spawnTypesOf(def)) expect(ENEMY_TYPES[ty], `${id}: ${ty}`).toBeTruthy();
    for (const ev of def.timeline) {
      for (const sp of [].concat(ev.spawn || [], ev.eo?.spawn || [])) {
        expect(BEHAVIORS[sp.behavior || 'headOn'], sp.behavior).toBeTruthy();
        if (sp.formation) expect(FORMATIONS[sp.formation], sp.formation).toBeTruthy();
      }
    }
  });

  it('only fork stages end with a route select', () => {
    for (const def of STAGES) {
      const has = partsOf(def).some((p) => p instanceof RouteSelect);
      expect(has, def.id).toBe(!!forkOf(def.id));
    }
  });
});

describe('strings and radio lines', () => {
  const speakers = ['awacs', 'lead', 'wing', 'carrier', 'tanker'];

  it('radio line data is well formed', () => {
    for (const [key, line] of Object.entries(radioLines)) {
      expect(key).toMatch(/^r\.[a-z]+\.[a-zA-Z0-9]+$/);
      expect(STAGE_BY_ID[key.split('.')[1]], key).toBeTruthy();
      expect(speakers).toContain(line.speaker);
      expect(line.variants.length).toBeGreaterThan(0);
      for (const v of line.variants) {
        expect(v.en.length, key).toBeGreaterThan(3);
        expect(v.en.length, `${key} is short`).toBeLessThan(60);
        expect(v.th.length, key).toBeGreaterThan(3);
      }
    }
  });

  it.each(STAGES.map((s) => [s.id, s]))('%s radio keys exist in radioLines.json and both string tables', (id, def) => {
    const keys = radioKeysOf(def);
    expect(keys.length).toBeGreaterThan(1);
    for (const k of keys) {
      expect(radioLines[k], k).toBeTruthy();
      expect(Array.isArray(stagesEn[k]) && stagesEn[k].length === 2, k).toBe(true);
      expect(Array.isArray(stagesTh[k]) && stagesTh[k].length === 2, k).toBe(true);
    }
  });

  it.each(STAGES.map((s) => [s.id, s]))('%s names, brief and EO titles exist in English and Thai', (id, def) => {
    const keys = [`stage.${id}.name`, `stage.${id}.sub`, `brief.${id}`];
    for (const ev of def.timeline) if (ev.eo?.titleKey) keys.push(ev.eo.titleKey);
    for (const p of partsOf(def)) keys.push(...collect(p.opts, (k, v) => k === 'titleKey'));
    for (const k of keys) {
      expect(typeof stagesEn[k], `en ${k}`).toBe('string');
      expect(typeof stagesTh[k], `th ${k}`).toBe('string');
    }
    expect(def.name).toBe(stagesEn[`stage.${id}.name`]);
  });

  it('flow panel labels exist in both languages', () => {
    for (const k of Object.keys(stagesEn).filter((k) => /^(flow|status)\./.test(k))) expect(typeof stagesTh[k], k).toBe('string');
  });
});

describe('status report', () => {
  it('grades ratios AAA–C', () => {
    expect(gradeFor(1.4)).toBe('AAA');
    expect(gradeFor(1.2)).toBe('AA');
    expect(gradeFor(1.0)).toBe('A');
    expect(gradeFor(0.85)).toBe('B');
    expect(gradeFor(0.5)).toBe('C');
    expect(gradeFor(NaN)).toBe('C');
  });

  it('sums a run against the stage pars', () => {
    const a = STAGE_BY_ID.ocean, b = STAGE_BY_ID.emerald;
    const rep = statusReport([
      { stage: a, kills: 40, bestCombo: 30, time: 50, downRate: 90, total: 100000 },
      { stage: b, kills: 50, bestCombo: 12, time: 45, downRate: 80, total: 250000 }
    ]);
    expect(rep.stages).toBe(2);
    expect(rep.downed.value).toBe(90);
    expect(rep.combo.value).toBe(30);
    expect(rep.time.value).toBe(95);
    expect(rep.score.value).toBe(250000);
    expect(['AAA', 'AA']).toContain(rep.downed.grade);
    expect(rep.time.grade).toBe('AA'); // faster than par
  });
});
