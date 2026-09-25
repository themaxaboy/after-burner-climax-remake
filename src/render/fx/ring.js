// Allocation-free helpers for GPU ring buffers: a FIFO slot allocator and a
// dirty-range accumulator that merges touched element ranges so each frame
// uploads as few bufferSubData ranges as possible.

/** FIFO slot allocator; when full it overwrites the oldest slot. */
export class RingAllocator {
  constructor(capacity) {
    if (!(capacity > 0)) throw new Error('RingAllocator: capacity must be > 0');
    this.capacity = capacity | 0;
    this.head = 0;
    this.total = 0; // lifetime allocations
  }

  alloc() {
    const i = this.head;
    this.head = i + 1 === this.capacity ? 0 : i + 1;
    this.total++;
    return i;
  }

  /** Number of slots that have ever been written (high-water mark). */
  get used() {
    return this.total < this.capacity ? this.total : this.capacity;
  }

  reset() {
    this.head = 0;
    this.total = 0;
  }
}

/**
 * Accumulates [start, start+count) element ranges. `add` is O(1) for the
 * common contiguous case (ring allocation) and never allocates. When more
 * than `maxRanges` disjoint ranges are added, the new range is merged into
 * the nearest existing one (uploading a few untouched elements is cheaper
 * than another GL call). `finalize` sorts + merges ranges closer than
 * `mergeGap` elements.
 */
export class DirtyRanges {
  constructor(maxRanges = 16, mergeGap = 0) {
    this.max = Math.max(1, maxRanges | 0);
    this.gap = Math.max(0, mergeGap | 0);
    this.s = new Int32Array(this.max);
    this.e = new Int32Array(this.max);
    this.count = 0;
  }

  clear() {
    this.count = 0;
  }

  get empty() {
    return this.count === 0;
  }

  add(start, count) {
    if (count <= 0) return;
    const end = start + count;
    const s = this.s, e = this.e;
    const n = this.count;
    if (n > 0) {
      // fast path: extends / overlaps the most recent range
      const l = n - 1;
      if (start <= e[l] + this.gap && end >= s[l] - this.gap) {
        if (start < s[l]) s[l] = start;
        if (end > e[l]) e[l] = end;
        return;
      }
    }
    if (n < this.max) {
      s[n] = start;
      e[n] = end;
      this.count = n + 1;
      return;
    }
    // full: grow the nearest range to cover this one
    let best = 0, bestCost = Infinity;
    for (let i = 0; i < n; i++) {
      const ns = start < s[i] ? start : s[i];
      const ne = end > e[i] ? end : e[i];
      const cost = ne - ns - (e[i] - s[i]);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    if (start < s[best]) s[best] = start;
    if (end > e[best]) e[best] = end;
  }

  /** Sort and merge overlapping / near ranges in place. Returns range count. */
  finalize() {
    const s = this.s, e = this.e;
    let n = this.count;
    // insertion sort by start (n is small)
    for (let i = 1; i < n; i++) {
      const ks = s[i], ke = e[i];
      let j = i - 1;
      while (j >= 0 && s[j] > ks) {
        s[j + 1] = s[j];
        e[j + 1] = e[j];
        j--;
      }
      s[j + 1] = ks;
      e[j + 1] = ke;
    }
    let m = 0;
    for (let i = 1; i < n; i++) {
      if (s[i] <= e[m] + this.gap) {
        if (e[i] > e[m]) e[m] = e[i];
      } else {
        m++;
        s[m] = s[i];
        e[m] = e[i];
      }
    }
    this.count = n = n > 0 ? m + 1 : 0;
    return n;
  }

  /** Total number of elements covered (after finalize). */
  covered() {
    let t = 0;
    for (let i = 0; i < this.count; i++) t += this.e[i] - this.s[i];
    return t;
  }
}

/**
 * Pushes the dirty ranges (in elements) into a three.js BufferAttribute /
 * InterleavedBuffer's `updateRanges` using pooled range objects (three clears
 * the array after upload and does not keep the objects), scaled by `stride`
 * array items per element. Returns the number of ranges pushed.
 */
export function flushRanges(dirty, target, stride, pool) {
  const n = dirty.finalize();
  if (n === 0) return 0;
  const ranges = target.updateRanges;
  ranges.length = 0;
  for (let i = 0; i < n; i++) {
    let r = pool[i];
    if (!r) r = pool[i] = { start: 0, count: 0 };
    r.start = dirty.s[i] * stride;
    r.count = (dirty.e[i] - dirty.s[i]) * stride;
    ranges.push(r);
  }
  target.needsUpdate = true;
  dirty.clear();
  return n;
}
