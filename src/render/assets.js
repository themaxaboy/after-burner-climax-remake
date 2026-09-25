// Lazy access to optional asset modules (procedural models, FX, audio).
// import.meta.glob returns an empty map when a module does not exist yet, so
// the game keeps running with fallbacks while those subsystems are developed.
const modelMods = import.meta.glob('../models/aircraftBuilder.js');
const fxMods = import.meta.glob('./fx/index.js');
const audioMods = import.meta.glob('../audio/index.js');

async function loadOne(map) {
  const key = Object.keys(map)[0];
  if (!key) return null;
  try {
    return await map[key]();
  } catch (e) {
    console.warn('optional module failed to load', key, e);
    return null;
  }
}

let _models, _fx, _audio;
export const loadModels = () => (_models ??= loadOne(modelMods));
export const loadFX = () => (_fx ??= loadOne(fxMods));
export const loadAudio = () => (_audio ??= loadOne(audioMods));
