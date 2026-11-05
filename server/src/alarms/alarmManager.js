/**
 * Alarm management following the ISA-18.2 state model:
 *
 *   NORMAL ──active──▶ UNACK ──ack──▶ ACKED ──clear──▶ NORMAL
 *                        │                          ▲
 *                        └──clear──▶ RTN_UNACK ──ack─┘
 *
 * plus SHELVED (temporarily hidden by the operator, auto-unshelves) and
 * DISABLED (removed from service by an engineer). Analog limit alarms use a
 * deadband and an on-delay to prevent chattering.
 */
import { PRIORITIES } from '../plant/plantConfig.js';

export const ALARM_TYPES = {
  HIHI: { label: 'HIHI', high: true },
  HI: { label: 'HI', high: true },
  LO: { label: 'LO', high: false },
  LOLO: { label: 'LOLO', high: false },
};

export class AlarmManager {
  /** @param {(entry: object) => void} log */
  constructor(log) {
    this.log = log;
    this.defs = new Map();
    this.states = new Map();
    this.byTag = new Map();
    this.floodWindow = [];
  }

  /**
   * @param {{id: string, tag: string, type: string, priority: string, message: string,
   *          limit?: number, deadband?: number, delay?: number, units?: string, decimals?: number}} def
   */
  define(def) {
    const d = { deadband: 0, delay: 0, enabled: true, ...def };
    this.defs.set(d.id, d);
    this.states.set(d.id, this.emptyState());
    if (!this.byTag.has(d.tag)) this.byTag.set(d.tag, []);
    this.byTag.get(d.tag).push(d);
    return d;
  }

  emptyState() {
    return { active: false, acked: true, pending: null, activeAt: null, clearedAt: null, value: null, shelvedUntil: null, shelvedBy: null };
  }

  /** Evaluate the analog limit alarms of one tag. */
  evaluateAnalog(tag, value, quality, now) {
    const defs = this.byTag.get(tag);
    if (!defs) return;
    for (const d of defs) {
      if (!ALARM_TYPES[d.type]) continue;
      if (quality === 'BAD') continue; // limit alarms are held while the PV is BAD
      const st = this.states.get(d.id);
      const high = ALARM_TYPES[d.type].high;
      const beyond = high ? value > d.limit : value < d.limit;
      const clear = high ? value < d.limit - d.deadband : value > d.limit + d.deadband;
      if (st.active) this.set(d.id, !clear, value, now);
      else this.set(d.id, beyond, value, now);
    }
  }

  /**
   * Generic condition update with on-delay. `active` is the raw condition.
   */
  set(id, active, value, now) {
    const d = this.defs.get(id);
    const st = this.states.get(id);
    if (!d || !st) return;
    if (value !== undefined) st.value = value;
    if (!d.enabled) {
      st.active = false;
      st.acked = true;
      st.pending = null;
      return;
    }
    if (active && !st.active) {
      if (d.delay > 0) {
        if (st.pending === null) st.pending = now;
        if (now - st.pending < d.delay * 1000) return;
      }
      st.pending = null;
      st.active = true;
      st.acked = false;
      st.activeAt = now;
      st.clearedAt = null;
      this.floodWindow.push(now);
      if (!this.isShelved(st, now)) {
        this.log({ category: 'ALARM', priority: d.priority, tag: d.tag, alarmId: id, message: `${d.tag} ${d.type} ${this.describe(d, st)}` });
      }
    } else if (!active) {
      st.pending = null;
      if (st.active) {
        st.active = false;
        st.clearedAt = now;
        if (!this.isShelved(st, now)) this.log({ category: 'ALARM', tag: d.tag, alarmId: id, message: `${d.tag} ${d.type} returned to normal` });
      }
    }
  }

  describe(d, st) {
    if (d.limit !== undefined && Number.isFinite(st.value)) {
      const dec = d.decimals ?? 1;
      return `${d.message} – ${st.value.toFixed(dec)} ${d.units ?? ''} (limit ${d.limit} ${d.units ?? ''})`.trim();
    }
    return d.message;
  }

  isShelved(st, now) {
    return st.shelvedUntil !== null && now < st.shelvedUntil;
  }

  /** Housekeeping: auto-unshelve expired alarms, trim flood window. */
  housekeeping(now) {
    for (const [id, st] of this.states) {
      if (st.shelvedUntil !== null && now >= st.shelvedUntil) {
        st.shelvedUntil = null;
        st.shelvedBy = null;
        const d = this.defs.get(id);
        this.log({ category: 'ALARM', tag: d.tag, alarmId: id, message: `${d.tag} ${d.type} shelve time expired – alarm unshelved` });
      }
    }
    const tenMin = now - 600_000;
    while (this.floodWindow.length && this.floodWindow[0] < tenMin) this.floodWindow.shift();
  }

  ack(id, user) {
    const st = this.states.get(id);
    const d = this.defs.get(id);
    if (!st) return `Unknown alarm ${id}`;
    if (st.acked) return null;
    st.acked = true;
    this.log({ category: 'OPERATOR', tag: d.tag, user, alarmId: id, message: `Alarm ${d.tag} ${d.type} acknowledged` });
    return null;
  }

  ackAll(user, now) {
    let n = 0;
    for (const st of this.states.values()) {
      if (!st.acked && !this.isShelved(st, now)) {
        st.acked = true;
        n += 1;
      }
    }
    if (n) this.log({ category: 'OPERATOR', user, message: `${n} alarm(s) acknowledged (ACK ALL)` });
    return null;
  }

  shelve(id, minutes, user, now) {
    const st = this.states.get(id);
    const d = this.defs.get(id);
    if (!st) return `Unknown alarm ${id}`;
    if (d.priority === 'CRITICAL') return 'Critical alarms cannot be shelved';
    const m = Math.min(Math.max(Number(minutes) || 0, 1), 480);
    st.shelvedUntil = now + m * 60_000;
    st.shelvedBy = user;
    st.acked = true;
    this.log({ category: 'OPERATOR', tag: d.tag, user, alarmId: id, message: `Alarm ${d.tag} ${d.type} shelved for ${m} min` });
    return null;
  }

  unshelve(id, user) {
    const st = this.states.get(id);
    const d = this.defs.get(id);
    if (!st) return `Unknown alarm ${id}`;
    st.shelvedUntil = null;
    st.shelvedBy = null;
    if (st.active) st.acked = false;
    this.log({ category: 'OPERATOR', tag: d.tag, user, alarmId: id, message: `Alarm ${d.tag} ${d.type} unshelved` });
    return null;
  }

  setLimit(id, limit, user) {
    const d = this.defs.get(id);
    if (!d) return `Unknown alarm ${id}`;
    if (d.limit === undefined) return `${id} is not a limit alarm`;
    const v = Number(limit);
    if (!Number.isFinite(v)) return 'Limit must be a number';
    const old = d.limit;
    d.limit = v;
    this.log({ category: 'ENGINEER', tag: d.tag, user, alarmId: id, message: `Alarm limit ${d.tag} ${d.type} changed ${old} → ${v}` });
    return null;
  }

  setEnabled(id, enabled, user) {
    const d = this.defs.get(id);
    if (!d) return `Unknown alarm ${id}`;
    d.enabled = !!enabled;
    if (!d.enabled) Object.assign(this.states.get(id), { active: false, acked: true, pending: null });
    this.log({ category: 'ENGINEER', priority: enabled ? undefined : 'LOW', tag: d.tag, user, alarmId: id, message: `Alarm ${d.tag} ${d.type} ${enabled ? 'enabled' : 'DISABLED'}` });
    return null;
  }

  stateOf(st, now) {
    if (this.isShelved(st, now)) return 'SHELVED';
    if (st.active) return st.acked ? 'ACKED' : 'UNACK';
    return st.acked ? 'NORMAL' : 'RTN_UNACK';
  }

  /** Alarms to show on the alarm summary (active or unacknowledged, not shelved). */
  list(now) {
    const out = [];
    for (const [id, st] of this.states) {
      const d = this.defs.get(id);
      const state = this.stateOf(st, now);
      if (state === 'NORMAL') continue;
      out.push({
        id,
        tag: d.tag,
        type: d.type,
        priority: d.priority,
        message: d.message,
        text: this.describe(d, st),
        state,
        value: st.value,
        limit: d.limit,
        activeAt: st.activeAt,
        clearedAt: st.clearedAt,
        shelvedUntil: st.shelvedUntil,
        shelvedBy: st.shelvedBy,
      });
    }
    out.sort((a, b) => PRIORITIES[a.priority] - PRIORITIES[b.priority] || (b.activeAt ?? 0) - (a.activeAt ?? 0));
    return out;
  }

  /** Static alarm configuration for the client. */
  config() {
    return [...this.defs.values()].map(({ id, tag, type, priority, message, limit, deadband, delay, enabled, units }) => ({
      id, tag, type, priority, message, limit, deadband, delay, enabled, units,
    }));
  }

  summary(now) {
    const counts = { total: 0, unacked: 0, shelved: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const [id, st] of this.states) {
      const d = this.defs.get(id);
      const state = this.stateOf(st, now);
      if (state === 'SHELVED') counts.shelved += 1;
      if (state === 'UNACK' || state === 'ACKED') {
        counts.total += 1;
        counts[d.priority] += 1;
      }
      if (state === 'UNACK' || state === 'RTN_UNACK') counts.unacked += 1;
    }
    counts.rate10min = this.floodWindow.length;
    counts.flood = this.floodWindow.length > 10 * 10; // > 10 alarms per minute averaged over 10 min
    return counts;
  }

  /** Clear all alarm states (used when loading a snapshot). */
  resetAll() {
    for (const id of this.states.keys()) this.states.set(id, this.emptyState());
    this.floodWindow = [];
  }

  snapshotConfig() {
    return [...this.defs.values()].map(({ id, limit, enabled }) => ({ id, limit, enabled }));
  }

  restoreConfig(cfg) {
    for (const c of cfg ?? []) {
      const d = this.defs.get(c.id);
      if (d) {
        if (c.limit !== undefined) d.limit = c.limit;
        d.enabled = c.enabled;
      }
    }
  }
}
