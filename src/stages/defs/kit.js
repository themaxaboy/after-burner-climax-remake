import { buildRail, polylineLength } from '../railBuilder.js';
import { t } from '../../ui/i18n.js';
import { LOOKS } from '../../world/looks.js';

// Shared pieces for the v2 stage definitions (docs/overhaul/CONTRACTS.md §3–§10).

/** Movement boxes: ocean / sky stages and terrain stages (walls come from terrainRun). */
export const SKY_BOX = Object.freeze({ x: 240, y: 100 });
export const TERRAIN_BOX = Object.freeze({ x: 200, y: 80 });

/** Rail points from segments + an estimate of the arc length (m). */
export function makeRail(opts) {
  const points = buildRail(opts);
  const segEnds = [];
  let acc = 0;
  for (const sg of opts.segs) segEnds.push((acc += sg.len));
  return { points, length: polylineLength(points), segEnds };
}

/**
 * Finish a stage def:
 * - `env` = the LOOKS preset named by `def.look` (§7; never hand-tuned colours)
 *   with the few overrides in `def.env` (cloud counts, the ocean plane);
 * - localized `name`, `subtitle` and `brief` getters read `stage.<id>.name`,
 *   `stage.<id>.sub` and `brief.<id>` in the current language.
 */
export function defineStage(def) {
  const id = def.id;
  const look = LOOKS[def.look];
  if (!look) throw new Error(`stage ${id}: unknown look ${def.look}`);
  def.env = { ...look, ...(def.env || {}) };
  Object.defineProperties(def, {
    name: { get: () => t(`stage.${id}.name`), enumerable: true },
    subtitle: { get: () => t(`stage.${id}.sub`), enumerable: true },
    brief: { get: () => t(`brief.${id}`), enumerable: true }
  });
  return def;
}

/** Emergency Order object with a localized `title` getter (read by the Director at start). */
export function eo(key, order) {
  Object.defineProperty(order, 'title', { get: () => t(key), enumerable: true });
  order.titleKey = key;
  return order;
}

/** Where the route-select component opens on a rail of length L (keep in sync with routeSelect). */
export function routeSelectAt(L, speed, duration = 7, outro = 1.6) {
  return L - (duration + outro + 2.4) * speed;
}
