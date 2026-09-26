// Stage names, subtitles, briefings, EO titles, route/flow panel labels and
// stage radio lines (English). Owned by the stages/routes work; merged over
// en.js by i18n.js.
import radioLines from '../../stages/radioLines.json';

// Radio speakers → on-screen callsigns (all original). The RADIO stream owns
// the voiced lines; until it switches to radioLines.json, `radio.say(key)`
// reads `[callsign, text]` from these tables.
export const CALLSIGNS = { awacs: 'SKYWATCH', lead: 'HAWK', wing: 'ROOK', carrier: 'BOSS', tanker: 'TEXACO' }; // same as src/audio/voice/speakers.json

/** `{ key: [CALLSIGN, text] }` for every stage radio line in `lang` (first variant). */
export function radioStrings(lang) {
  const out = {};
  for (const [key, line] of Object.entries(radioLines)) {
    const v = line.variants[0];
    out[key] = [CALLSIGNS[line.speaker] || line.speaker.toUpperCase(), v[lang] || v.en];
  }
  return out;
}

export default {
  ...radioStrings('en'),

  'stage.ocean.name': 'BLUE HORIZON',
  'stage.ocean.sub': 'SORTIE',
  'brief.ocean': 'Catapult off the carrier and sweep the enemy fighters from the open sea.',
  'stage.emerald.name': 'EMERALD PEAKS',
  'stage.emerald.sub': 'HIGHLANDS',
  'brief.emerald': 'Fly the green valley under the snow peaks. Stop the troop helicopters before they cross the pass.',
  'eo.emerald': 'DOWN 8 TRANSPORT HELICOPTERS',
  'stage.canyon.name': 'RED CANYON',
  'stage.canyon.sub': 'THE GAUNTLET',
  'brief.canyon': 'Thread the red canyon: under the arches, around the pillars. The route splits at the exit.',
  'eo.canyon': 'DESTROY THE CANYON BOMBER',
  'stage.sunset.name': 'SUNSET ARMADA',
  'stage.sunset.sub': 'FLEET ACTION',
  'brief.sunset': 'Break the enemy fleet at sundown and stop the heavy bomber. A tanker waits at the end of the run.',
  'eo.sunset': 'SPLASH THE HEAVY BOMBER',
  'stage.glacier.name': 'GLACIER FJORD',
  'stage.glacier.sub': 'COLD STEEL',
  'brief.glacier': 'Stay low along the frozen fjord, dodge the ice and knock out the flak sites on the banks.',
  'eo.glacier': 'DESTROY 6 AA SITES',
  'stage.dunes.name': 'GOLDEN DUNES',
  'stage.dunes.sub': 'SANDSTORM PURSUIT',
  'brief.dunes': 'They will chase you across the desert. Gun down the cruise missiles — they cannot be locked.',
  'eo.dunes': 'SHOOT DOWN 3 CRUISE MISSILES — GUN ONLY',
  'stage.clouds.name': 'SEA OF CLOUDS',
  'stage.clouds.sub': 'ACE HIGH',
  'brief.clouds': 'Above the cloud sea at dusk, their best pilot is waiting for you.',
  'eo.clouds': 'DEFEAT THE ENEMY ACE',
  'stage.strike.name': 'CANYON STRIKE',
  'stage.strike.sub': 'UNDER THE RADAR',
  'brief.strike': 'Stay under the radar ceiling and beat the clock, then pop up and hit the target.',
  'eo.strike': 'DESTROY THE TARGET',
  'stage.fortress.name': 'SKY FORTRESS',
  'stage.fortress.sub': 'FINAL LINE',
  'brief.fortress': 'The flying fortress. Knock out its four engines, then bring it home to the boat.',
  'eo.fortress': 'DESTROY THE SKY FORTRESS',
  'stage.aurora.name': 'AURORA',
  'stage.aurora.sub': 'SECRET SORTIE',
  'brief.aurora': 'A secret sky under the aurora. They will not fire back — down them all.',

  'stage.storm.name': 'THUNDERHEAD',
  'stage.storm.sub': 'STORM FRONT',
  'brief.storm': 'Low under the storm wall. A heavy bomber is hiding in the weather.',
  'eo.storm': 'SPLASH THE STORM BOMBER',
  'stage.volcano.name': 'ASH RIDGE',
  'stage.volcano.sub': 'FIRE MOUNTAIN',
  'brief.volcano': 'Black rock and red ash. Knock out the flak sites dug into the slopes.',
  'eo.volcano': 'DESTROY 6 AA SITES',
  'stage.nightfleet.name': 'MIDNIGHT ARMADA',
  'stage.nightfleet.sub': 'NIGHT RAID',
  'brief.nightfleet': 'The enemy fleet runs dark tonight. Sink the escort destroyers.',
  'eo.nightfleet': 'SINK 3 ESCORT DESTROYERS',
  'stage.whiteout.name': 'WHITEOUT',
  'stage.whiteout.sub': 'SNOWFIELD',
  'brief.whiteout': 'A white valley in a white haze. Gun down the cruise missiles skimming the snow.',
  'eo.whiteout': 'SHOOT DOWN 4 CRUISE MISSILES — GUN ONLY',
  'stage.ravine.name': 'DUSK RAVINE',
  'stage.ravine.sub': 'KNIFE EDGE',
  'brief.ravine': 'The tightest canyon on the map. Stay under the radar and catch the bomber.',
  'eo.ravine': 'DESTROY THE RAVINE BOMBER',
  'stage.jetstream.name': 'JET STREAM',
  'stage.jetstream.sub': 'HIGH ALTITUDE',
  'brief.jetstream': 'Dawn above the clouds. Two of their aces are flying together.',
  'eo.jetstream': 'DEFEAT THE ACE PAIR',
  'stage.badlands.name': 'MOONLIT BADLANDS',
  'stage.badlands.sub': 'NIGHT CROSSING',
  'brief.badlands': 'Silver dunes under the moon. Stop the night airlift before the fortress.',
  'eo.badlands': 'DOWN 8 TRANSPORT HELICOPTERS',
  'stage.stratos.name': 'STRATOSPHERE',
  'stage.stratos.sub': 'EDGE OF SPACE',
  'brief.stratos': 'The top of the sky. They will not fire back — down them all.',

  'flow.pleaseWait': 'PLEASE WAIT',
  'flow.route': 'ROUTE',
  'flow.stage': 'STAGE',
  'flow.paintOf': '{scheme} PAINT',
  'flow.ready': 'PRESS START',
  'flow.bonus': 'SECRET ROUTE OPEN',
  'flow.bonusLocked': 'SECRET ROUTE CLOSED — EMERGENCY ORDERS {n}/{need}',
  'flow.next': 'NEXT',
  'status.title': 'STATUS REPORT',
  'status.midgame': 'MID-GAME RESULT',
  'status.score': 'SCORE',
  'status.downed': 'DOWNED TOTAL',
  'status.combo': 'MAX COMBO',
  'status.time': 'PLAY TIME',
  'status.grade': 'GRADE'
};
