/**
 * Sequence-of-events journal / audit trail. Every alarm transition, operator
 * action, SIS action and instructor intervention is recorded with the
 * simulation timestamp and the user responsible.
 */
export const EVENT_CATEGORIES = ['ALARM', 'OPERATOR', 'ENGINEER', 'SIS', 'INSTRUCTOR', 'TRAINING', 'SYSTEM'];

export class EventLog {
  constructor({ capacity = 5000, clock } = {}) {
    this.capacity = capacity;
    this.clock = clock ?? (() => Date.now());
    this.items = [];
    this.seq = 0;
  }

  add({ category = 'SYSTEM', priority, tag, user, message, alarmId }) {
    this.seq += 1;
    const entry = { seq: this.seq, t: this.clock(), category, message };
    if (priority) entry.priority = priority;
    if (tag) entry.tag = tag;
    if (user) entry.user = user;
    if (alarmId) entry.alarmId = alarmId;
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    return entry;
  }

  /** Entries with sequence number greater than `seq`. */
  since(seq) {
    if (seq >= this.seq) return [];
    let i = this.items.length;
    while (i > 0 && this.items[i - 1].seq > seq) i -= 1;
    return this.items.slice(i);
  }

  query({ limit = 200, category, tag, before } = {}) {
    let out = this.items;
    if (category) out = out.filter((e) => e.category === category);
    if (tag) out = out.filter((e) => e.tag === tag);
    if (before) out = out.filter((e) => e.seq < before);
    return out.slice(-Math.min(Math.max(limit, 1), 2000));
  }

  clear() {
    this.items = [];
  }
}
