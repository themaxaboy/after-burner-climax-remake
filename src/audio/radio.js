import { t } from '../ui/i18n.js';

/**
 * Radio chatter director for a stage. Scripted lines come from stage
 * timelines/logic via say(key); dynamic chatter reacts to `stage.events`.
 * Shows the subtitle on the HUD and plays the radio bed (voice clips when
 * available). See docs/overhaul/CONTRACTS.md.
 */
export class RadioDirector {
  constructor(game, stage) {
    this.game = game;
    this.stage = stage;
    this.rng = stage.rng;
    this._off = [];
    const ev = stage.events;
    const on = (type, fn) => this._off.push(ev.on(type, fn));
    on('kill', () => this.rng.next() < 0.18 && this.say('r.gen.goodKill', { priority: 2 }));
    on('fox', () => this.rng.next() < 0.12 && this.say('r.gen.fox2', { priority: 2 }));
    on('missileLaunch', (m) => m.owner !== 'player' && this.rng.next() < 0.35 && this.say('r.gen.missile', { priority: 0 }));
    on('climax', (e) => e.phase === 'start' && this.say('r.gen.climax', { priority: 2 }));
    on('playerHit', (e) => e.kind !== 'gun' && this.stage.player.alive && this.rng.next() < 0.5 && this.say('r.gen.hit', { priority: 0 }));
    on('playerDown', () => this.say('r.gen.down', { priority: 0 }));
  }

  /**
   * Speak a line. key: string id (see strings / voice manifest).
   * opts: { priority 0..3 (0 = most urgent), ttl seconds }
   */
  say(key, opts = {}) {
    void opts;
    const line = t(key);
    if (!Array.isArray(line)) return false;
    this.game.hud.radio(line[0], line[1]);
    this.game.audio?.radio?.(line[0]);
    return true;
  }

  /** Stage load: preload the voice clips this stage may use. */
  async preload() {}

  /** Per rendered frame (real dt). */
  update(realDt) {
    void realDt;
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
  }
}
