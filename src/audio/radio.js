import { t, getLang } from '../ui/i18n.js';
import { rngStream } from '../core/rng.js';
import { RadioQueue, pickVariant } from './voice/scheduler.js';
import { CATALOG, SPEAKERS, GENERIC_ORDER, callsignOf, clipFor, estimateDuration, lineText, planPreload, stageKeys } from './voice/catalog.js';
import { voiceBank } from './voice/clips.js';

/** Per-stage voice preload budget (encoded bytes) and the longest stage-start wait. */
export const PRELOAD_BUDGET = 600 * 1024;
export const PRELOAD_WAIT_MS = 1500;
/** Idle chatter after this many seconds of radio silence. */
export const IDLE_AFTER = 6;

/**
 * Dynamic chatter rules: pool key, priority (0 urgent … 3 idle), ttl (s in the queue),
 * category cooldown (s), play chance, start delay, and whether a scripted stage line
 * on the same moment replaces it (yieldToScript).
 */
export const RULES = {
  missileInbound: { key: 'gen.missileInbound', cat: 'threat', priority: 0, ttl: 1.2, cooldown: 4 },
  strongInbound: { key: 'gen.strongInbound', cat: 'threat', priority: 0, ttl: 1.2, cooldown: 4 },
  pullUp: { key: 'gen.pullUp', cat: 'pullUp', priority: 0, ttl: 1, cooldown: 4 },
  hit: { key: 'gen.hit', cat: 'hit', priority: 0, ttl: 1.2, cooldown: 3 },
  down: { key: 'gen.down', cat: 'down', priority: 0, ttl: 2.5 },
  lowArmor: { key: 'gen.lowArmor', cat: 'lowArmor', priority: 1, ttl: 2.5, cooldown: 12 },
  rammer: { key: 'gen.rammer', cat: 'rammer', priority: 1, ttl: 1.5, cooldown: 9, chance: 0.75 },
  enemyBehind: { key: 'gen.enemyBehind', cat: 'enemyBehind', priority: 1, ttl: 2, cooldown: 10, delay: 0.3, yieldToScript: true },
  terrainCaution: { key: 'gen.terrainCaution', cat: 'terrain', priority: 1, ttl: 2, cooldown: 10 },
  climaxReady: { key: 'gen.climaxReady', cat: 'climaxReady', priority: 1, ttl: 3, cooldown: 15 },
  climaxStart: { key: 'gen.climaxStart', cat: 'climax', priority: 1, ttl: 1.5, cooldown: 10 },
  climaxAllDown: { key: 'gen.climaxAllDown', cat: 'climaxAllDown', priority: 1, ttl: 3, cooldown: 8 },
  respawn: { key: 'gen.respawn', cat: 'respawn', priority: 1, ttl: 4, delay: 0.6 },
  eoStart: { key: 'gen.eoStart', cat: 'eo', priority: 1, ttl: 3, cooldown: 2, delay: 0.5, yieldToScript: true },
  eoClear: { key: 'gen.eoClear', cat: 'eo', priority: 1, ttl: 3, cooldown: 2, delay: 0.5, yieldToScript: true },
  eoFail: { key: 'gen.eoFail', cat: 'eo', priority: 1, ttl: 3, cooldown: 2, delay: 0.5, yieldToScript: true },
  routeSelect: { key: 'gen.routeSelect', cat: 'route', priority: 1, ttl: 3, cooldown: 6, delay: 0.2, yieldToScript: true },
  routeLeft: { key: 'gen.routeLeft', cat: 'routeCommit', priority: 1, ttl: 2.5, cooldown: 4 },
  routeRight: { key: 'gen.routeRight', cat: 'routeCommit', priority: 1, ttl: 2.5, cooldown: 4 },
  stageStart: { key: 'gen.stageStart', cat: 'stageStart', priority: 2, ttl: 3, delay: 1.2, yieldToScript: true },
  stageClear: { key: 'gen.stageClear', cat: 'stageClear', priority: 1, ttl: 3.5, delay: 0.8, yieldToScript: true },
  bigKill: { key: 'gen.bigKill', cat: 'bigKill', priority: 1, ttl: 2.5, cooldown: 6 },
  kill: { key: 'gen.kill', cat: 'kill', priority: 2, ttl: 2, cooldown: 3.5, chance: 0.35 },
  multiKill: { key: 'gen.multiKill', cat: 'multiKill', priority: 2, ttl: 2, cooldown: 6 },
  fox: { key: 'gen.fox', cat: 'fox', priority: 2, ttl: 1.2, cooldown: 7, chance: 0.3 },
  evade: { key: 'gen.evade', cat: 'evade', priority: 2, ttl: 1.5, cooldown: 6, chance: 0.7 },
  nearMiss: { key: 'gen.nearMiss', cat: 'nearMiss', priority: 2, ttl: 1.5, cooldown: 5, chance: 0.5 },
  combo10: { key: 'gen.combo10', cat: 'combo', priority: 2, ttl: 2.5, cooldown: 12 },
  combo30: { key: 'gen.combo30', cat: 'combo', priority: 2, ttl: 2.5, cooldown: 12 },
  combo50: { key: 'gen.combo50', cat: 'combo', priority: 2, ttl: 2.5, cooldown: 12 },
  bandits: { key: 'gen.bandits', cat: 'contact', priority: 2, ttl: 2, cooldown: 15, chance: 0.7 },
  idle: { key: 'gen.idle', cat: 'idle', priority: 3, ttl: 2, cooldown: 9 }
};

const LOW_ARMOR = 35;
const MULTI_KILL_WINDOW = 1.5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Radio chatter director for a stage. Scripted lines come from stage timelines/logic
 * via say(key); dynamic chatter reacts to `stage.events` and a few polled states (low
 * armour, rammers, chasers, wave arrivals, Climax gauge, combo tiers, idle silence).
 * One line at a time through a priority queue (./voice/scheduler.js); each line shows
 * its subtitle (`hud.radio`, current language) and plays its voice clip through the
 * AudioEngine's radio chain, or the squelch/static bed when the clip is missing.
 * See docs/overhaul/CONTRACTS.md §9.
 */
export class RadioDirector {
  constructor(game, stage) {
    this.game = game;
    this.stage = stage;
    const seed = ((game?.params?.seed || 1) ^ 0x5ad10) >>> 0;
    this.rng = rngStream(seed, `radio:${stage?.def?.id ?? ''}`);
    const rnd = () => this.rng.next();
    this.queue = new RadioQueue({ rng: rnd, onStart: (it) => this._start(it), onStop: (it) => this._stop(it) });
    this.lastVariant = new Map();
    this.lastLine = null; // {key, who, text, voiced, dur}
    this.stats = { said: 0, voiced: 0, fallback: 0 };
    this.live = false;
    this.disposed = false;
    this._off = [];
    this._armorOk = true;
    this._behind = false;
    this._behindT = 0;
    this._rammers = new Set();
    this._rammerT = 0;
    this._spawnMark = 0;
    this._spawnT = 0;
    this._climaxReady = false;
    this._comboTier = 0;
    this._comboN = 0;
    this._kills = [];
    this._salvo = null;
    this._caution = null;

    const ev = stage.events;
    if (!ev) return;
    const on = (type, fn) => this._off.push(ev.on(type, fn));
    on('stageStart', () => this._onStageStart());
    on('stageEnd', () => this._onStageEnd());
    on('kill', (e) => this._onKill(e));
    on('fox', () => !this.stage.climax?.active && this.rule('fox'));
    on('missileLaunch', (m) => m && m.owner !== 'player' && this.rule(m.strong ? 'strongInbound' : 'missileInbound'));
    on('playerHit', (e) => this._onHit(e));
    on('nearMiss', () => this.rule('nearMiss'));
    on('evade', () => this.rule('evade'));
    on('climax', (e) => this._onClimax(e));
    on('combo', (e) => this._onCombo(e?.n));
    on('eo', (e) => {
      const k = e?.kind;
      if (k === 'start' || k === 'cleared' || k === 'failed') this.rule(k === 'start' ? 'eoStart' : k === 'cleared' ? 'eoClear' : 'eoFail');
    });
    on('routeSelect', (e) => this._onRoute(e));
    on('caution', (e) => e?.on && this.rule(e.kind === 'pullup' ? 'pullUp' : 'terrainCaution'));
    on('playerDown', () => this._onDown());
    on('respawn', () => {
      this._armorOk = true;
      this.rule('respawn');
    });
  }

  /* ------------------------------------------------------------ public */

  /**
   * Speak a line. key: lines.json / radioLines.json key, or a legacy i18n radio key.
   * opts: { priority 0..3 (0 = most urgent, default 1), ttl s, cat, cooldown, chance,
   * delay, script (default: true for non-`gen.` keys), yieldToScript }. False when dropped.
   */
  say(key, opts = {}) {
    if (this.disposed || !this._line(key)) return false;
    const script = opts.script ?? !key.startsWith('gen.');
    if (!this.live && !script) return false;
    return this.queue.offer({
      key,
      cat: opts.cat,
      priority: opts.priority ?? 1,
      ttl: opts.ttl ?? (script ? 8 : 3),
      cooldown: opts.cooldown,
      chance: opts.chance,
      delay: opts.delay,
      script,
      yieldToScript: opts.yieldToScript,
      data: this.live ? null : { simT: this.stage.time || 0 }
    });
  }

  /** Offer a dynamic chatter rule (see RULES). */
  rule(name) {
    const r = RULES[name];
    if (!r || !this.live) return false;
    const st = this.stage;
    if (st.finished && name !== 'stageClear') return false;
    if (st.dead && name !== 'down') return false;
    return this.say(r.key, { ...r, script: false });
  }

  /** Stage load: fetch + decode the clips this stage may use (never blocks > ~1.5 s). */
  async preload() {
    const work = voiceBank
      .manifest()
      .then(async (man) => {
        if (!man || this.disposed) return;
        const keys = [...stageKeys(this.stage.def, CATALOG), ...GENERIC_ORDER];
        const plan = planPreload(man, CATALOG, keys, PRELOAD_BUDGET, (f) => voiceBank.has(f));
        voiceBank.want(plan);
        await voiceBank.load(plan, () => this._engine());
      })
      .catch((e) => console.warn('[radio] voice preload failed', e));
    await Promise.race([work, sleep(PRELOAD_WAIT_MS)]);
  }

  /** Per rendered frame (real dt). */
  update(realDt) {
    if (this.disposed || this.stage.paused) return;
    const dt = realDt > 0 ? Math.min(realDt, 0.1) : 0;
    if (this.live) this._poll(dt);
    // a voiced line ends on the audio clock (the frame clock is capped and can lag behind)
    if (this.queue.playing?.handle?.done) this.queue.end();
    this.queue.update(dt);
    voiceBank.pump(this._engine());
  }

  dispose() {
    for (const off of this._off) off();
    this._off.length = 0;
    this.queue.clear();
    this.queue.cut('dispose');
    this.disposed = true;
    this.live = false;
  }

  /* ----------------------------------------------------------- playback */

  _engine() {
    const a = this.game?.audio;
    return a && a.isReady ? a : null;
  }

  /** Line data for a key: catalog first, then a legacy i18n radio string. */
  _line(key) {
    const line = CATALOG.get(key);
    if (line) return line;
    const legacy = t(key);
    return Array.isArray(legacy) ? { key, legacy: true } : null;
  }

  _start(item) {
    const line = this._line(item.key);
    if (!line) return 0;
    let who;
    let text;
    let en;
    let buf = null;
    let gain = 1;
    if (line.legacy) {
      [who, text] = t(item.key);
      en = text;
    } else {
      const vs = line.variants;
      const man = voiceBank.manifestData;
      const playable = (i) => {
        const c = clipFor(man, item.key, i, vs[i]);
        return !!(c && voiceBank.buffer(c.file));
      };
      const i = pickVariant(vs.length, this.lastVariant.get(item.key) ?? -1, () => this.rng.next(), playable);
      this.lastVariant.set(item.key, i);
      const v = vs[i];
      who = callsignOf(v.speaker);
      text = lineText(v, getLang());
      en = v.en;
      const clip = clipFor(man, item.key, i, v);
      buf = clip ? voiceBank.buffer(clip.file) : null;
      gain = SPEAKERS[v.speaker]?.gain ?? 1;
    }
    const a = this._engine();
    let dur = 0;
    let voiced = false;
    if (buf && a?.playVoice) {
      const h = a.playVoice(buf, { callsign: who, gain });
      if (h && h.duration > 0) {
        item.handle = h;
        dur = h.duration;
        voiced = true;
      }
    }
    if (!voiced) {
      const est = estimateDuration(en);
      const bed = a?.radio ? a.radio(who, { duration: est }) : 0;
      dur = bed > 0 ? bed : est;
    }
    this.game?.hud?.radio?.(who, text, dur + 1.2);
    this.stats.said++;
    if (voiced) this.stats.voiced++;
    else this.stats.fallback++;
    this.lastLine = { key: item.key, who, text, voiced, dur };
    return dur;
  }

  _stop(item) {
    item.handle?.stop?.();
    item.handle = null;
  }

  /* ------------------------------------------------------------- events */

  _onStageStart() {
    // keep lines from stage init (e.g. the launch call); drop what a warp/fast-forward queued
    this.queue.drop((q) => !q.data || q.data.simT > 0.5);
    this.queue.resetCooldowns();
    this.live = true;
    this.queue.lastEnd = this.queue.now;
    this._spawnMark = this.stage.enemies?.spawned ?? 0;
    if (!this._earlyScript()) this.rule('stageStart');
  }

  /** Does the stage open with its own radio call (init or the first ~1.2 km of the timeline)? */
  _earlyScript() {
    if (this.queue.busy || this.stage.stageLogic?.skipIntroMessage) return true;
    const p0 = this.stage.player?.s ?? 0;
    for (const ev of this.stage.def?.timeline || []) {
      if (typeof ev?.radio === 'string' && typeof ev.at === 'number' && ev.at >= p0 && ev.at < p0 + 1200) return true;
    }
    return false;
  }

  _onStageEnd() {
    this.queue.clear(2);
    this.rule('stageClear');
  }

  _onKill(ev) {
    if (!ev || ev.src === 'collision') return;
    const now = this.queue.now;
    if (this._salvo) {
      if (ev.src === 'missile') this._salvo.kills++;
      if (this._salvo.kills >= this._salvo.n) {
        this._salvo = null;
        this.rule('climaxAllDown');
      }
      return;
    }
    if (this.stage.climax?.active) return;
    if (ev.e?.def?.big) {
      this.rule('bigKill');
      return;
    }
    const k = this._kills;
    k.push(now);
    while (k.length && now - k[0] > MULTI_KILL_WINDOW) k.shift();
    if (k.length >= 3 && this.rule('multiKill')) {
      k.length = 0;
      return;
    }
    this.rule('kill');
  }

  _onHit(ev) {
    const p = this.stage.player;
    if (p && p.alive === false) return; // the down call covers it
    if (ev?.kind === 'gun' && this.rng.next() > 0.3) return;
    this.rule('hit');
  }

  _onClimax(ev) {
    const phase = ev?.phase;
    if (phase === 'ready') this._sayClimaxReady();
    else if (phase === 'start') {
      this._climaxReady = false;
      this.rule('climaxStart');
    } else if (phase === 'end') {
      const n = ev.salvo | 0;
      this._salvo = n >= 3 ? { n, kills: 0, t: 0 } : null;
    } else if (phase === 'allDown' || phase === 'clear') {
      this._salvo = null;
      this.rule('climaxAllDown');
    }
  }

  _sayClimaxReady() {
    if (this._climaxReady) return;
    this._climaxReady = true;
    this.rule('climaxReady');
  }

  _onCombo(n) {
    if (!(n >= 0)) return;
    if (n < this._comboN) this._comboTier = 0; // chain broke
    this._comboN = n;
    const tier = n >= 50 ? 50 : n >= 30 ? 30 : n >= 10 ? 10 : 0;
    if (tier > this._comboTier) {
      this._comboTier = tier;
      this.rule(`combo${tier}`);
    }
  }

  _onRoute(ev) {
    if (!ev) return;
    if (ev.phase === 'open') this.rule('routeSelect');
    else if (ev.phase === 'commit') this.rule(ev.side < 0 ? 'routeLeft' : 'routeRight');
  }

  _onDown() {
    this.queue.clear();
    this.queue.cut('down');
    this._salvo = null;
    this.rule('down');
  }

  /* -------------------------------------------------------------- polls */

  _poll(dt) {
    const st = this.stage;
    const p = st.player;
    if (!p || st.dead || st.finished) return;
    // low armour
    const armor = p.armor;
    if (typeof armor === 'number') {
      if (armor <= LOW_ARMOR && armor > 0 && this._armorOk) {
        this._armorOk = false;
        this.rule('lowArmor');
      } else if (armor > LOW_ARMOR + 15) this._armorOk = true;
    }
    // Climax gauge full (also sent as a 'climax' {phase:'ready'} event)
    const cl = st.climax;
    if (cl) {
      if (cl.ready && !cl.active) this._sayClimaxReady();
      else if (!cl.ready && !cl.active) this._climaxReady = false;
    }
    // combo tiers (also sent as 'combo' events)
    if (st.scoring && typeof st.scoring.combo === 'number') this._onCombo(st.scoring.combo);
    // Climax salvo tracking window
    if (this._salvo && (this._salvo.t += dt) > 5) {
      if (this._salvo.kills >= 3) this.rule('multiKill');
      this._salvo = null;
    }
    // chasers (rising edge)
    if ((this._behindT -= dt) <= 0) {
      this._behindT = 0.4;
      const b = !!st.enemyOps?.enemyBehind?.();
      if (b && !this._behind) this.rule('enemyBehind');
      this._behind = b;
    }
    // rammers
    if ((this._rammerT -= dt) <= 0) {
      this._rammerT = 0.3;
      const list = st.enemies?.list;
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const e = list[i];
          if (!e.rammer || !e.active || e.dead || this._rammers.has(e.id)) continue;
          this._rammers.add(e.id);
          if (this._rammers.size > 256) this._rammers.clear();
          this.rule('rammer');
          break;
        }
      }
    }
    // wave arrivals: several spawns within a second
    if ((this._spawnT += dt) >= 1) {
      const spawned = st.enemies?.spawned ?? 0;
      if (spawned - this._spawnMark >= 4) this.rule('bandits');
      this._spawnMark = spawned;
      this._spawnT = 0;
    }
    // terrain caution via the HUD extras (also sent as 'caution' events)
    const c = st.hudExtra?.caution || null;
    if (c !== this._caution) {
      if (c === 'PULL UP') this.rule('pullUp');
      else if (c) this.rule('terrainCaution');
      this._caution = c;
    }
    // idle chatter
    if (!this.queue.busy && this.queue.silence > IDLE_AFTER) this.rule('idle');
  }
}
