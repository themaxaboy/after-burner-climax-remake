/**
 * Radio scheduler: the pure queue logic behind RadioDirector (no Web Audio, no DOM),
 * so it can be unit-tested. Time is whatever `update(dt)` feeds it (real seconds).
 *
 * - One transmission at a time, with `gap` seconds of silence between two lines.
 * - Priority 0 (threat / pull-up / hit) … 3 (idle chatter); lower number wins, then oldest.
 * - Every queued item has a TTL: stale lines are dropped instead of played late.
 * - Category cooldowns and a play chance are checked when a line is offered.
 * - A priority-0 line cuts a playing line of priority >= `preemptFrom` (chatter).
 * - Items flagged `yieldToScript` (generic "EO started", "stage clear"…) are dropped when a
 *   scripted line (`script: true`, from a stage timeline) is queued, playing or just played.
 */
export const RADIO_GAP = 0.35;

export class RadioQueue {
  /**
   * opts: { rng() → [0,1), gap, cutGap, maxQueue, preemptFrom, scriptWindow,
   *         onStart(item) → duration s (<= 0 skips the item), onStop(item, reason) }
   */
  constructor(opts = {}) {
    this.rng = opts.rng || Math.random;
    this.gap = opts.gap ?? RADIO_GAP;
    this.cutGap = opts.cutGap ?? 0.15;
    this.maxQueue = opts.maxQueue ?? 8;
    this.preemptFrom = opts.preemptFrom ?? 2;
    this.scriptWindow = opts.scriptWindow ?? 3;
    this.onStart = opts.onStart || (() => 1);
    this.onStop = opts.onStop || (() => {});
    this.now = 0;
    this.items = [];
    this.playing = null;
    this.gapUntil = 0;
    this.lastEnd = 0;
    this.lastScriptAt = -Infinity;
    this.cool = new Map();
    this._seq = 0;
    this.stats = { offered: 0, accepted: 0, played: 0, cut: 0, dropped: { cooldown: 0, chance: 0, dup: 0, script: 0, full: 0, ttl: 0, cleared: 0 } };
  }

  /** True while a line plays or waits. */
  get busy() {
    return !!this.playing || this.items.length > 0;
  }

  /** Seconds since the radio went quiet (0 while a line plays). */
  get silence() {
    return this.playing ? 0 : this.now - this.lastEnd;
  }

  /**
   * Offer a line. item: { key, cat=key, priority=1, ttl=3, cooldown=0, chance=1, delay=0,
   * script=false, yieldToScript=false, data }. Returns false when dropped.
   */
  offer(o) {
    this.stats.offered++;
    const now = this.now;
    const cat = o.cat || o.key;
    const until = this.cool.get(cat);
    if (until !== undefined && now < until) return this._drop('cooldown');
    const chance = o.chance ?? 1;
    if (chance < 1 && this.rng() >= chance) return this._drop('chance');
    for (let i = 0; i < this.items.length; i++) if (this.items[i].key === o.key) return this._drop('dup');
    const script = !!o.script;
    if (o.yieldToScript && this._scriptActive()) return this._drop('script');
    const delay = o.delay > 0 ? o.delay : 0;
    const it = {
      key: o.key,
      cat,
      priority: o.priority ?? 1,
      script,
      yieldToScript: !!o.yieldToScript,
      readyAt: now + delay,
      expires: now + delay + (o.ttl > 0 ? o.ttl : 3),
      seq: ++this._seq,
      data: o.data ?? null,
      startAt: 0,
      endAt: 0,
      handle: null
    };
    if (o.cooldown > 0) this.cool.set(cat, now + o.cooldown);
    if (script) {
      this.lastScriptAt = now;
      this._purge((q) => q.yieldToScript, 'script');
    }
    this.items.push(it);
    if (this.items.length > this.maxQueue) {
      // drop the least important item (highest priority number, newest first)
      let worst = 0;
      for (let i = 1; i < this.items.length; i++) {
        const a = this.items[i];
        const b = this.items[worst];
        if (a.priority > b.priority || (a.priority === b.priority && a.seq > b.seq)) worst = i;
      }
      const [gone] = this.items.splice(worst, 1);
      this.stats.dropped.full++;
      if (gone === it) return false;
    }
    this.stats.accepted++;
    if (it.priority === 0 && this.playing && this.playing.priority >= this.preemptFrom) this.cut('preempt');
    return true;
  }

  /** Advance time; ends the current line, drops stale items and starts the next one. */
  update(dt) {
    this.now += dt > 0 ? dt : 0;
    const now = this.now;
    if (this.playing && now >= this.playing.endAt) {
      this.playing = null;
      this.lastEnd = now;
      this.gapUntil = now + this.gap;
    }
    if (this.playing || now < this.gapUntil) return null;
    this._purge((q) => q.expires <= now, 'ttl');
    if (this._scriptActive()) this._purge((q) => q.yieldToScript, 'script');
    while (this.items.length) {
      let best = -1;
      for (let i = 0; i < this.items.length; i++) {
        const q = this.items[i];
        if (q.readyAt > now) continue;
        if (best < 0) best = i;
        else {
          const b = this.items[best];
          if (q.priority < b.priority || (q.priority === b.priority && q.seq < b.seq)) best = i;
        }
      }
      if (best < 0) return null;
      const [it] = this.items.splice(best, 1);
      const dur = this.onStart(it);
      if (!(dur > 0)) continue;
      it.startAt = now;
      it.endAt = now + dur;
      this.playing = it;
      this.stats.played++;
      if (it.script) this.lastScriptAt = now;
      return it;
    }
    return null;
  }

  /** The current line finished early (e.g. its audio ended before the queue clock says so). */
  end() {
    if (!this.playing) return false;
    this.playing.endAt = this.now;
    this.playing = null;
    this.lastEnd = this.now;
    this.gapUntil = this.now + this.gap;
    return true;
  }

  /** Stop the current line now (squelch close); the next may start after `cutGap`. */
  cut(reason = 'cut') {
    const p = this.playing;
    if (!p) return false;
    this.playing = null;
    this.lastEnd = this.now;
    this.gapUntil = this.now + this.cutGap;
    this.stats.cut++;
    this.onStop(p, reason);
    return true;
  }

  /** Drop queued (not playing) items with priority >= minPriority. */
  clear(minPriority = 0) {
    this._purge((q) => q.priority >= minPriority, 'cleared');
  }

  /** Drop queued (not playing) items matching pred(item). */
  drop(pred) {
    this._purge(pred, 'cleared');
  }

  /** Forget cooldowns (e.g. new stage). */
  resetCooldowns() {
    this.cool.clear();
  }

  _scriptActive() {
    if (this.now - this.lastScriptAt < this.scriptWindow) return true;
    if (this.playing && this.playing.script) return true;
    for (let i = 0; i < this.items.length; i++) if (this.items[i].script) return true;
    return false;
  }

  _purge(pred, reason) {
    const list = this.items;
    for (let i = list.length - 1; i >= 0; i--) {
      if (pred(list[i])) {
        list.splice(i, 1);
        this.stats.dropped[reason] = (this.stats.dropped[reason] || 0) + 1;
      }
    }
  }

  _drop(reason) {
    this.stats.dropped[reason]++;
    return false;
  }
}

/**
 * Pick a variant index in [0, n) that differs from `last` (no immediate repeats).
 * `ok(i)` (optional) prefers playable variants (e.g. clips already decoded).
 */
export function pickVariant(n, last, rng = Math.random, ok = null) {
  if (n <= 1) return 0;
  const pool = [];
  if (ok) for (let i = 0; i < n; i++) if (i !== last && ok(i)) pool.push(i);
  if (!pool.length) for (let i = 0; i < n; i++) if (i !== last) pool.push(i);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}
