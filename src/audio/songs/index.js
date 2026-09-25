/** Song registry. Track ids used by audio.music.play(trackId). */
import title from './title.js';
import stage1 from './stage1.js';
import stage2 from './stage2.js';
import stage3 from './stage3.js';
import anthem from './anthem.js';
import results from './results.js';

export const SONGS = { title, stage1, stage2, stage3, anthem, results };
export const TRACK_IDS = Object.keys(SONGS);
