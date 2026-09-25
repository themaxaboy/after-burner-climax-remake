import { makeTerrainShape } from './profiles.js';

/**
 * Legacy entry point: the canyon height field now lives in profiles.js
 * (profile 'canyon'), which also supports a swinging corridor (`centre`),
 * valleys/fjords and dunes. With no `centre` the heights are unchanged.
 *
 * def: { seed, sections: [{ s, depth, width, clearance | floor }], centre? }
 */
export function makeCanyonShape(def) {
  return makeTerrainShape({ ...def, profile: def.profile || 'canyon' });
}

export { makeTerrainShape };
