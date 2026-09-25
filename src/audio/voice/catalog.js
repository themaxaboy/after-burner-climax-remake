/**
 * Radio line catalog (pure data helpers, no Web Audio).
 *
 * Sources, in lookup order:
 *   1. src/audio/voice/lines.json  (RADIO: generic pools `gen.*` + legacy `r.s1.*`…`r.gen.*`)
 *   2. src/stages/radioLines.json  (STAGES: `r.<stageId>.<name>`; optional)
 *   (3. legacy i18n `t(key)` → [callsign, text], handled by RadioDirector)
 * A line is { speaker, cat?, speed?, variants: [{ en, th, speaker?, say? }] }.
 * The voice manifest (public/audio/voice/manifest.json, written by
 * scripts/voices/generate.py) maps every voiced variant to { file, dur, bytes, hash, en, th }.
 */
import LINES from './lines.json';
import SPEAKERS from './speakers.json';

const STAGE_LINES = Object.values(import.meta.glob('../../stages/radioLines.json', { eager: true, import: 'default' }))[0] || {};

export { LINES, SPEAKERS, STAGE_LINES };

/** Merge line tables (earlier tables win) into a Map key → normalized line. */
export function buildCatalog(...tables) {
  const map = new Map();
  for (const table of tables) {
    for (const key of Object.keys(table || {})) {
      if (map.has(key)) continue;
      const line = table[key];
      const variants = (line && Array.isArray(line.variants) ? line.variants : []).filter((v) => v && v.en);
      if (!variants.length) continue;
      map.set(key, {
        key,
        speaker: line.speaker || variants[0].speaker || 'awacs',
        cat: line.cat || null,
        variants: variants.map((v) => ({ en: v.en, th: v.th || v.en, speaker: v.speaker || line.speaker || 'awacs' }))
      });
    }
  }
  return map;
}

export const CATALOG = buildCatalog(LINES, STAGE_LINES);

/** HUD callsign for a speaker id. */
export function callsignOf(speaker) {
  return SPEAKERS[speaker]?.callsign || String(speaker || '').toUpperCase();
}

/** Subtitle text of a variant in a language ('en' | 'th'). */
export function lineText(variant, lang) {
  return lang === 'th' && variant.th ? variant.th : variant.en;
}

/** Manifest clip for variant i of a line, only when it was voiced from the same text. */
export function clipFor(manifest, key, i, variant) {
  const v = manifest?.lines?.[key]?.variants?.[i];
  if (!v || !v.file) return null;
  return variant && v.en !== variant.en ? null : v;
}

/** Subtitle-only duration estimate (s) for a line of English text. */
export function estimateDuration(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.min(4.5, Math.max(1.1, 0.45 + words * 0.36));
}

/** Generic pools in preload order (most useful first). */
export const GENERIC_ORDER = [
  'gen.missileInbound',
  'gen.kill',
  'gen.hit',
  'gen.fox',
  'gen.stageStart',
  'gen.down',
  'gen.respawn',
  'gen.idle',
  'gen.climaxStart',
  'gen.climaxReady',
  'gen.evade',
  'gen.enemyBehind',
  'gen.nearMiss',
  'gen.bandits',
  'gen.multiKill',
  'gen.strongInbound',
  'gen.rammer',
  'gen.lowArmor',
  'gen.bigKill',
  'gen.climaxAllDown',
  'gen.combo10',
  'gen.combo30',
  'gen.combo50',
  'gen.pullUp',
  'gen.terrainCaution',
  'gen.eoStart',
  'gen.eoClear',
  'gen.eoFail',
  'gen.routeSelect',
  'gen.routeLeft',
  'gen.routeRight',
  'gen.stageClear'
];

/**
 * Keys a stage may say: timeline `radio` actions, `def.radioKeys`, and every catalog
 * key under `r.<def.id>.` (lines triggered from stage logic code).
 */
export function stageKeys(def, catalog = CATALOG) {
  const keys = new Set();
  if (!def) return [];
  for (const ev of def.timeline || []) if (typeof ev?.radio === 'string') keys.add(ev.radio);
  for (const k of def.radioKeys || []) keys.add(k);
  if (def.id) {
    const prefix = `r.${def.id}.`;
    for (const k of catalog.keys()) if (k.startsWith(prefix)) keys.add(k);
  }
  return [...keys];
}

/**
 * Preload plan: clips for `keys` (in order) within `budget` bytes. Round-robin over the
 * variants so every line gets its first clip before any line gets a second one.
 * `keep(file)` (optional) marks clips that are already cached: they are listed but cost nothing.
 * Returns [{ key, i, file, bytes, dur, hash }].
 */
export function planPreload(manifest, catalog, keys, budget, keep = null) {
  const out = [];
  const seen = new Set();
  if (!manifest?.lines) return out;
  const lists = [];
  for (const key of keys) {
    if (seen.has(key)) continue;
    seen.add(key);
    const line = catalog.get(key);
    const mv = manifest.lines[key]?.variants;
    if (!line || !mv) continue;
    const clips = [];
    for (let i = 0; i < line.variants.length; i++) {
      const c = clipFor(manifest, key, i, line.variants[i]);
      if (c) clips.push({ key, i, file: c.file, bytes: c.bytes || 0, dur: c.dur || 0, hash: c.hash || '' });
    }
    if (clips.length) lists.push(clips);
  }
  let used = 0;
  const files = new Set();
  for (let round = 0; ; round++) {
    let any = false;
    for (const clips of lists) {
      const c = clips[round];
      if (!c) continue;
      any = true;
      if (files.has(c.file)) continue;
      const cost = keep && keep(c.file) ? 0 : c.bytes;
      if (used + cost > budget) continue;
      used += cost;
      files.add(c.file);
      out.push(c);
    }
    if (!any) break;
  }
  return out;
}
