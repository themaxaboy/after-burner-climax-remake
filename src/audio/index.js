/**
 * Audio subsystem public entry.
 *
 *   import { AudioEngine } from './audio/index.js';
 *   const audio = new AudioEngine();
 *   await audio.init();           // from a user gesture
 *   audio.play('explosionLarge', { position, velocity });
 *   audio.music.play('stage1');
 */
export { AudioEngine, VoiceHandle, buildEngineGraph, applyEngineParams, buildMasterChain } from './audio.js';
export { MusicPlayer, SongInstance, TRACKS, SONGS, TRACK_IDS, validateSong, compileSong, parseCharPattern, parseTokens, patternLength, stepsPerBar, layerActive } from './music.js';
export { SFX_DEFS, SOUND_NAMES, LOOP_NAMES } from './sfxBank.js';
export { DRUM_DEFS } from './instruments.js';
export {
  SPEED_OF_SOUND,
  clamp,
  noteToMidi,
  noteToFreq,
  midiToFreq,
  pitchClassOf,
  parseChord,
  dopplerRate,
  dopplerRateVec,
  timeScaleToCutoff,
  timeScaleToRate,
  stepDuration,
  stepTime,
  StepClock,
  analyzeChannels,
  generateImpulseResponse,
  crossfadeLoop,
  makeDriveCurve,
  makeSoftClipCurve
} from './synth.js';
