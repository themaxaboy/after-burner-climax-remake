/**
 * Voice clip cache shared by every stage: fetches the manifest and MP3 clips from
 * public/audio/voice/, keeps the encoded bytes (small) and the decoded AudioBuffers of
 * the clips the current stage wants (decoded buffers are large, so they are evicted
 * beyond DECODED_CAP seconds). Decoding needs a ready AudioEngine; clips fetched before
 * that are decoded later by pump().
 */
const BASE = `${(import.meta.env && import.meta.env.BASE_URL) || './'}audio/voice/`;
const DECODED_CAP = 180; // seconds of decoded audio kept across stages (~35 MB at 48 kHz)
const FETCH_CONCURRENCY = 4;

export class VoiceBank {
  constructor(base = BASE) {
    this.base = base;
    this.manifestData = null;
    this._manifestP = null;
    this.raw = new Map(); // file → ArrayBuffer (encoded)
    this.buffers = new Map(); // file → AudioBuffer
    this._fetching = new Map(); // file → Promise
    this._decoding = new Set();
    this._hash = new Map(); // file → content hash (cache busting)
    this._wanted = new Set();
    this._ctx = null; // context the decoded buffers belong to
    this.failed = 0;
  }

  /** Fetch the manifest once (null when missing or offline). */
  manifest() {
    if (!this._manifestP) {
      const f = typeof fetch === 'function' ? fetch : null;
      this._manifestP = !f
        ? Promise.resolve(null)
        : f(`${this.base}manifest.json`, { cache: 'no-cache' })
            .then((r) => (r.ok ? r.json() : null))
            .then((m) => (this.manifestData = m && m.lines ? m : null))
            .catch(() => null);
    }
    return this._manifestP;
  }

  /** Decoded buffer for a clip file, or null. */
  buffer(file) {
    return this.buffers.get(file) || null;
  }

  /** Mark the clips the current stage wants (eviction keeps these). */
  want(plan) {
    this._wanted = new Set(plan.map((c) => c.file));
    for (const c of plan) if (c.hash) this._hash.set(c.file, c.hash);
  }

  /** True when the encoded bytes (or the decoded buffer) are cached. */
  has(file) {
    return this.raw.has(file) || this.buffers.has(file);
  }

  /** Fetch (and decode when the engine is ready) every clip in the plan. */
  async load(plan, getEngine) {
    const queue = plan.filter((c) => !this.buffers.has(c.file));
    const worker = async () => {
      while (queue.length) {
        const c = queue.shift();
        const ab = await this._fetch(c.file);
        if (ab) await this._decode(c.file, getEngine());
      }
    };
    const n = Math.min(FETCH_CONCURRENCY, queue.length);
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
  }

  /** Per frame: decode wanted clips that were fetched before the engine was ready. Cheap. */
  pump(engine) {
    if (!engine || !engine.isReady || this._decoding.size >= 2) return;
    if (engine.ctx !== this._ctx) this._resetDecoded(engine.ctx);
    for (const file of this._wanted) {
      if (this._decoding.size >= 2) break;
      if (this.raw.has(file) && !this.buffers.has(file) && !this._decoding.has(file)) this._decode(file, engine);
    }
  }

  _fetch(file) {
    if (this.raw.has(file)) return Promise.resolve(this.raw.get(file));
    let p = this._fetching.get(file);
    if (!p) {
      const h = this._hash.get(file);
      const url = `${this.base}${encodeURIComponent(file)}${h ? `?h=${h}` : ''}`;
      p = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
        .then((ab) => {
          this._fetching.delete(file);
          if (ab && ab.byteLength) this.raw.set(file, ab);
          else this.failed++;
          return ab;
        });
      this._fetching.set(file, p);
    }
    return p;
  }

  async _decode(file, engine) {
    if (!engine || !engine.isReady || !engine.decodeVoice || this._decoding.has(file) || this.buffers.has(file)) return;
    const ab = this.raw.get(file);
    if (!ab) return;
    if (engine.ctx !== this._ctx) this._resetDecoded(engine.ctx);
    this._decoding.add(file);
    try {
      const buf = await engine.decodeVoice(ab.slice(0));
      if (buf && engine.ctx === this._ctx) {
        this.buffers.set(file, buf);
        this._evict();
      } else if (!buf) this.failed++;
    } finally {
      this._decoding.delete(file);
    }
  }

  _resetDecoded(ctx) {
    this.buffers.clear();
    this._ctx = ctx;
  }

  _evict() {
    let total = 0;
    for (const b of this.buffers.values()) total += b.duration;
    if (total <= DECODED_CAP) return;
    for (const [file, b] of this.buffers) {
      if (this._wanted.has(file)) continue;
      this.buffers.delete(file);
      total -= b.duration;
      if (total <= DECODED_CAP * 0.8) break;
    }
  }

  stats() {
    let decodedSec = 0;
    for (const b of this.buffers.values()) decodedSec += b.duration;
    let rawBytes = 0;
    for (const ab of this.raw.values()) rawBytes += ab.byteLength;
    return { manifest: !!this.manifestData, raw: this.raw.size, rawBytes, decoded: this.buffers.size, decodedSec: Math.round(decodedSec), wanted: this._wanted.size, failed: this.failed };
  }
}

/** Shared across stages. */
export const voiceBank = new VoiceBank();
