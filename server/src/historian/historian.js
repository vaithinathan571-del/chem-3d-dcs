/**
 * In-memory process historian. Samples every registered series at a fixed
 * interval into a shared ring buffer (typed arrays) and serves decimated
 * queries for trend displays.
 */
export class Historian {
  /**
   * @param {{capacity?: number, interval?: number}} opts capacity in samples, interval in seconds
   */
  constructor({ capacity = 14_400, interval = 1 } = {}) {
    this.capacity = capacity;
    this.interval = interval;
    this.times = new Float64Array(capacity);
    this.series = new Map();
    this.head = 0; // next write index
    this.count = 0;
    this.lastSample = -Infinity;
  }

  register(id) {
    if (!this.series.has(id)) this.series.set(id, new Float32Array(this.capacity).fill(NaN));
  }

  get ids() {
    return [...this.series.keys()];
  }

  /** Record a sample if the interval has elapsed. `t` in epoch ms. */
  maybeRecord(t, read) {
    if (t - this.lastSample < this.interval * 1000 - 1e-6) return false;
    this.lastSample = t;
    this.times[this.head] = t;
    for (const [id, arr] of this.series) {
      const v = read(id);
      arr[this.head] = Number.isFinite(v) ? v : NaN;
    }
    this.head = (this.head + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
    return true;
  }

  index(i) {
    // i = 0 is the oldest sample.
    return (this.head - this.count + i + this.capacity) % this.capacity;
  }

  /** Lower bound: first logical index with time >= t. */
  lowerBound(t) {
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[this.index(mid)] < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  get range() {
    if (!this.count) return null;
    return { from: this.times[this.index(0)], to: this.times[this.index(this.count - 1)] };
  }

  /**
   * Query series between `from` and `to` (epoch ms), bucket-averaged down to
   * at most `points` samples.
   */
  query(ids, from = -Infinity, to = Infinity, points = 600) {
    const valid = ids.filter((id) => this.series.has(id));
    const start = this.lowerBound(from);
    const end = this.lowerBound(to + 1e-6);
    const n = Math.max(end - start, 0);
    const maxPts = Math.min(Math.max(points | 0, 2), 5000);
    const step = Math.max(1, Math.ceil(n / maxPts));
    const t = [];
    const data = Object.fromEntries(valid.map((id) => [id, []]));
    for (let i = start; i < end; i += step) {
      const j = Math.min(i + step, end);
      t.push(this.times[this.index(j - 1)]);
      for (const id of valid) {
        const arr = this.series.get(id);
        let sum = 0;
        let cnt = 0;
        for (let k = i; k < j; k += 1) {
          const v = arr[this.index(k)];
          if (!Number.isNaN(v)) {
            sum += v;
            cnt += 1;
          }
        }
        data[id].push(cnt ? Math.round((sum / cnt) * 1e4) / 1e4 : null);
      }
    }
    return { t, series: data };
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.lastSample = -Infinity;
    for (const arr of this.series.values()) arr.fill(NaN);
  }
}
