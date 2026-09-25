import stage1 from './stage1_ocean.js';
import stage2 from './stage2_canyon.js';

// Stage graph. `next` lists stage ids; more than one entry would show a route
// select map (framework ready for future branching stages).
export const STAGES = [stage1, stage2];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s]));
