import ocean from './defs/ocean.js';
import emerald from './defs/emerald.js';
import canyon from './defs/canyon.js';
import sunset from './defs/sunset.js';
import glacier from './defs/glacier.js';
import dunes from './defs/dunes.js';
import aurora from './defs/aurora.js';
import clouds from './defs/clouds.js';
import strike from './defs/strike.js';
import fortress from './defs/fortress.js';

// Every stage in route order (see ./routes.js for the graph with its forks
// and the bonus stage). `index` is the 1-based position used by ?stage=<n>.
export const STAGES = [ocean, emerald, canyon, sunset, glacier, dunes, aurora, clouds, strike, fortress];
STAGES.forEach((s, i) => (s.index = i + 1));

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));

/**
 * Resolve a stage from a URL/test value: 1-based index (number or numeric
 * string) or a stage id. Returns null when unknown.
 */
export function getStageDef(v) {
  if (v == null || v === '' || v === 0) return null;
  if (typeof v === 'number' || /^\d+$/.test(String(v))) return STAGES[Number(v) - 1] || null;
  return STAGE_BY_ID[v] || null;
}
