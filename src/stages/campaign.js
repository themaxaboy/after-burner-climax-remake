import stage1 from './stage1_ocean.js';
import stage2 from './stage2_canyon.js';
import stage3 from './stage3_twilight.js';

// Stage graph. `next` lists stage ids; more than one entry would show a route
// select map (framework ready for future branching stages).
export const STAGES = [stage1, stage2, stage3];

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
