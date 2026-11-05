/**
 * Client-side state store with a minimal publish/subscribe mechanism.
 */
const MAX_EVENTS = 1500;

class Store {
  constructor() {
    this.config = null;
    this.user = null;
    this.state = null;
    this.events = [];
    this.snapshots = [];
    this.connected = false;
    this.selection = null; // {kind, id}
    this.listeners = new Map();
    this.index = {};
  }

  on(topic, fn) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic).add(fn);
    return () => this.listeners.get(topic)?.delete(fn);
  }

  emit(topic, payload) {
    for (const fn of this.listeners.get(topic) ?? []) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[store] listener for ${topic} failed`, err);
      }
    }
  }

  init({ user, config, state, events, snapshots }) {
    this.user = user;
    this.config = config;
    this.state = state;
    this.events = events ?? [];
    this.snapshots = snapshots ?? [];
    this.buildIndex();
    this.emit('init', this);
    this.emit('state', state);
    this.emit('events', this.events);
    this.emit('snapshots', this.snapshots);
  }

  buildIndex() {
    const c = this.config;
    const points = new Map(c.points.map((p) => [p.tag, p]));
    const loops = new Map(c.controllers.map((l) => [l.tag, l]));
    const motors = new Map(c.motors.map((m) => [m.id, m]));
    const valves = new Map(c.valves.map((v) => [v.id, v]));
    const equipment = new Map(c.equipment.map((e) => [e.id, e]));
    const interlocks = new Map(c.interlocks.map((i) => [i.id, i]));
    const valveLoop = new Map();
    for (const l of c.controllers) if (l.output?.valve) valveLoop.set(l.output.valve, l.tag);
    const alarmsByTag = new Map();
    for (const a of c.alarms) {
      if (!alarmsByTag.has(a.tag)) alarmsByTag.set(a.tag, []);
      alarmsByTag.get(a.tag).push(a);
    }
    this.index = { points, loops, motors, valves, equipment, interlocks, valveLoop, alarmsByTag };
  }

  updateAlarmConfig(alarms) {
    this.config.alarms = alarms;
    this.buildIndex();
    this.emit('alarmConfig', alarms);
  }

  update(state, newEvents) {
    this.state = state;
    if (newEvents?.length) {
      this.events.push(...newEvents);
      if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
      this.emit('events', this.events);
      this.emit('newEvents', newEvents);
    }
    this.emit('state', state);
  }

  setSnapshots(items) {
    this.snapshots = items;
    this.emit('snapshots', items);
  }

  select(sel) {
    this.selection = sel;
    this.emit('select', sel);
  }

  can(permission) {
    return !!this.user?.permissions?.includes(permission);
  }

  /** Equipment id an alarm/point belongs to (for 3D highlighting). */
  equipmentOf(tag) {
    const { points, loops, motors, equipment } = this.index;
    if (equipment.has(tag) || motors.has(tag)) return tag;
    const p = points.get(tag);
    if (p) return p.equipment;
    const l = loops.get(tag);
    if (l?.output?.valve) return l.output.valve;
    return null;
  }
}

export const store = new Store();
