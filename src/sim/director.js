// Stage director: walks the authored timeline (keyed by rail distance so
// flying FAST really does shorten reaction time), spawns formations, fires
// cues/radio/messages and runs Emergency Orders.

// Formation offsets [x, y, trail]: `trail` = distance behind the leader along
// its direction of travel.
export const FORMATIONS = {
  single: [[0, 0, 0]],
  pair: [[-14, 0, 0], [14, 0, 12]],
  V3: [[0, 0, 0], [-20, -2, 20], [20, -2, 20]],
  V5: [[0, 0, 0], [-20, -2, 20], [20, -2, 20], [-40, -4, 40], [40, -4, 40]],
  line3: [[-34, 0, 0], [0, 0, 0], [34, 0, 0]],
  line4: [[-51, 0, 0], [-17, 0, 0], [17, 0, 0], [51, 0, 0]],
  echelonL4: [[0, 0, 0], [-18, -2, 18], [-36, -4, 36], [-54, -6, 54]],
  echelonR4: [[0, 0, 0], [18, -2, 18], [36, -4, 36], [54, -6, 54]],
  diamond4: [[0, 0, 0], [-18, -3, 18], [18, -3, 18], [0, -6, 36]],
  box4: [[-16, 6, 0], [16, 6, 0], [-16, -6, 30], [16, -6, 30]],
  wall6: [[-40, 8, 0], [0, 8, 0], [40, 8, 0], [-40, -8, 0], [0, -8, 0], [40, -8, 0]],
  trail3: [[0, 0, 0], [0, 0, 60], [0, 0, 120]],
  trail5: [[0, 0, 0], [8, 3, 55], [-8, -3, 110], [8, 3, 165], [0, 0, 220]],
  swarm8: [[0, 0, 0], [-30, 12, 40], [30, -8, 30], [-55, -10, 90], [55, 10, 80], [-15, 20, 140], [20, -18, 150], [0, 5, 200]]
};

const DEFAULTS = {
  headOn: { dist: 3000, dir: 1 },
  overtake: { dist: -380, dir: -1, y: 12 },
  crossing: { dist: 1300, dir: 1 },
  formation: { dist: 2300, dir: -1 },
  chaser: { dist: -650, dir: -1 },
  strafe: { dist: 2800, dir: 1, y: 170 },
  bomber: { dist: -700, dir: -1, y: 50 },
  hover: { dist: 2600, dir: -1 },
  ace: { dist: -450, dir: -1 },
  static: { dist: 3500, dir: 1 }
};

export class Director {
  /**
   * @param {object} def stage definition
   * @param {object} api {spawn(type, opts), cue(name, ev), radio(key, ev), message(key, ev), eoEvent(kind, eo), end(ev), rank()}
   */
  constructor(def, api) {
    this.def = def;
    this.api = api;
    this.events = def.timeline.map((ev, i) => ({ ...ev, _i: i, _done: false }));
    this.distEvents = this.events.filter((e) => typeof e.at === 'number').sort((a, b) => a.at - b.at);
    this.timeEvents = this.events.filter((e) => e.at && typeof e.at === 'object' && e.at.t != null);
    this.triggerEvents = this.events.filter((e) => e.at && typeof e.at === 'object' && e.at.event);
    this.cursor = 0;
    this.time = 0;
    this.eo = null;
    this.eoResults = [];
    this.flags = {};
    this.ended = false;
  }

  /** Skip all distance events before s (fast-forward / checkpoints). */
  seek(s) {
    while (this.cursor < this.distEvents.length && this.distEvents[this.cursor].at < s) {
      const ev = this.distEvents[this.cursor++];
      ev._done = true;
      if (ev.cue && ev.persistent) this.api.cue(ev.cue, ev);
    }
  }

  update(dt, player) {
    this.time += dt;
    const rank = this.api.rank ? this.api.rank() : 0;
    while (this.cursor < this.distEvents.length && this.distEvents[this.cursor].at <= player.s) {
      const ev = this.distEvents[this.cursor++];
      this._run(ev, player, rank);
    }
    for (const ev of this.timeEvents) {
      if (!ev._done && this.time >= ev.at.t) this._run(ev, player, rank);
    }
    if (this.eo && this.eo.status === 'active') this._updateEO(dt);
  }

  /** Notify the director of gameplay events (kills, escapes...). */
  notify(event, tag) {
    for (const ev of this.triggerEvents) {
      if (ev._done) continue;
      if (ev.at.event === event && (!ev.at.tag || ev.at.tag === tag)) {
        if (ev.at.delay) {
          ev.at = { t: this.time + ev.at.delay };
          this.timeEvents.push(ev);
        } else this._run(ev, this.api.player?.(), 0);
      }
    }
    const eo = this.eo;
    if (eo && eo.status === 'active' && eo.tags.includes(tag)) {
      if (event === 'killed') {
        eo.remaining--;
        if (eo.remaining <= 0) this._eoDone(true);
      } else if (event === 'escaped') {
        this._eoDone(false);
      }
    }
  }

  _run(ev, player, rank) {
    ev._done = true;
    if (ev.minRank != null && rank < ev.minRank) return;
    if (ev.maxRank != null && rank > ev.maxRank) return;
    if (ev.flag && !this.flags[ev.flag]) return;
    if (ev.spawn) this.spawnGroup(ev.spawn, player);
    if (ev.cue) this.api.cue(ev.cue, ev);
    if (ev.radio) this.api.radio(ev.radio, ev);
    if (ev.message) this.api.message(ev.message, ev);
    if (ev.eo) this._eoStart(ev.eo, player);
    if (ev.eoCheck) this._eoCheck(ev.eoCheck);
    if (ev.end) {
      this.ended = true;
      this.api.end(ev);
    }
  }

  spawnGroup(sp, player) {
    const beh = sp.behavior || 'headOn';
    const d = DEFAULTS[beh] || DEFAULTS.headOn;
    const form = FORMATIONS[sp.formation || 'single'];
    const dist = sp.dist ?? d.dist;
    const baseX = sp.x ?? 0;
    const baseY = sp.y ?? d.y ?? 0;
    const spawned = [];
    const count = sp.count ?? form.length;
    for (let i = 0; i < count; i++) {
      const off = form[i % form.length];
      const extra = Math.floor(i / form.length);
      const trail = off[2] + extra * 80;
      const o = {
        behavior: beh,
        rs: player.s + dist + trail * d.dir,
        rx: baseX + off[0] * (sp.spread || 1) * (sp.mirror ? -1 : 1),
        ry: baseY + off[1] * (sp.spread || 1),
        tag: sp.tag || null,
        params: sp.params || {},
        timeLimit: sp.timeLimit,
        hpMul: sp.hpMul,
        countable: sp.countable
      };
      if (beh === 'static' || sp.world) {
        o.world = this.api.worldPoint(player.s + dist + trail, o.rx, sp.y ?? 0, sp.ground !== false);
        o.heading = this.api.railHeading(player.s + dist) + (sp.heading || 0) * (Math.PI / 180);
        o.behavior = 'static';
      }
      const e = this.api.spawn(sp.type, o);
      if (e) spawned.push(e);
    }
    return spawned;
  }

  _eoStart(eo, player) {
    this.eo = {
      id: eo.id,
      title: eo.title,
      kind: eo.kind || 'destroy',
      tags: eo.tags || (eo.spawn ? [eo.spawn.tag] : []),
      remaining: eo.count || 1,
      timeLimit: eo.timeLimit || 0,
      t: 0,
      bonus: eo.bonus || 50000,
      status: 'active'
    };
    if (eo.spawn) {
      const list = Array.isArray(eo.spawn) ? eo.spawn : [eo.spawn];
      let n = 0;
      for (const sp of list) n += this.spawnGroup({ ...sp, timeLimit: sp.timeLimit ?? eo.timeLimit }, player).filter((e) => e.tag && this.eo.tags.includes(e.tag)).length;
      if (!eo.count) this.eo.remaining = Math.max(1, n);
    }
    this.api.eoEvent('start', this.eo);
  }

  _updateEO(dt) {
    const eo = this.eo;
    eo.t += dt;
    // targets report 'escaped' when they leave; this is only a safety net
    if (eo.kind === 'destroy' && eo.timeLimit && eo.t > eo.timeLimit + 45) this._eoDone(false);
  }

  /** For avoid-type orders: explicit success/failure checks from the stage. */
  _eoCheck(result) {
    if (!this.eo || this.eo.status !== 'active') return;
    if (result === 'fail') this._eoDone(false);
    else if (result === 'pass') this._eoDone(true);
  }

  failEO() {
    if (this.eo && this.eo.status === 'active') this._eoDone(false);
  }

  _eoDone(ok) {
    const eo = this.eo;
    eo.status = ok ? 'cleared' : 'failed';
    this.eoResults.push({ id: eo.id, ok });
    this.api.eoEvent(ok ? 'cleared' : 'failed', eo);
  }
}
