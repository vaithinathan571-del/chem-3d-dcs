/**
 * Safety Instrumented System (SIS) – latching trip logic with manual reset,
 * maintenance bypass and a manual emergency-shutdown pushbutton.
 */

const COMPARATORS = {
  '>=': (v, t) => v >= t,
  '<=': (v, t) => v <= t,
  '>': (v, t) => v > t,
  '<': (v, t) => v < t,
};

export class InterlockSystem {
  /**
   * @param {object[]} defs interlock definitions
   * @param {{motors: Map, valves: Map, control: import('../control/controlSystem.js').ControlSystem}} plant
   * @param {(entry: object) => void} log event logger
   */
  constructor(defs, plant, log) {
    this.plant = plant;
    this.log = log;
    this.items = new Map(
      defs.map((d) => [
        d.id,
        { ...d, tripped: false, condition: false, bypassed: false, value: null, trippedAt: null, tripCount: 0, firstOut: false },
      ]),
    );
  }

  get(id) {
    return this.items.get(id);
  }

  /** Evaluate all functions against the SIS sensor values. */
  evaluate(values, now) {
    for (const il of this.items.values()) {
      if (il.manual) continue;
      const v = values[il.sensor];
      il.value = v;
      il.condition = Number.isFinite(v) && COMPARATORS[il.compare](v, il.trip);
      if (il.condition && !il.tripped && !il.bypassed) {
        this.trip(il, now, `${il.sensorTag} = ${v.toFixed(2)} ${il.units} (trip ${il.compare} ${il.trip})`);
      }
    }
    // Keep enforcing actions of tripped functions (e.g. a motor restarted manually).
    for (const il of this.items.values()) if (il.tripped) this.enforce(il);
  }

  trip(il, now, reason) {
    // First-out indication: the first function to trip while no other is tripped.
    il.firstOut = ![...this.items.values()].some((o) => o !== il && o.tripped);
    il.tripped = true;
    il.trippedAt = now;
    il.tripCount += 1;
    this.enforce(il, true);
    this.log({ category: 'SIS', priority: 'CRITICAL', tag: il.id, message: `${il.id} TRIP – ${il.description}${reason ? `: ${reason}` : ''}` });
  }

  enforce(il, initial = false) {
    const { motors, valves, control } = this.plant;
    for (const a of il.actions) {
      if (a.motor) {
        const m = motors.get(a.motor);
        if (!m) continue;
        m.inhibits.add(il.id);
        if (m.running) m.trip(`${il.id} trip`);
      } else if (a.valve) {
        valves.get(a.valve)?.forces.set(il.id, a.position);
        if (a.loop) {
          const loop = control.get(a.loop);
          if (loop && (initial || !loop.interlocks.has(il.id))) loop.force(il.id, a.position);
        }
      }
    }
  }

  release(il) {
    const { motors, valves, control } = this.plant;
    for (const a of il.actions) {
      if (a.motor) motors.get(a.motor)?.inhibits.delete(il.id);
      else if (a.valve) {
        valves.get(a.valve)?.forces.delete(il.id);
        if (a.loop) control.get(a.loop)?.release(il.id);
      }
    }
  }

  /** Manual emergency shutdown pushbutton. */
  manualTrip(id, user, now) {
    const il = this.items.get(id);
    if (!il || !il.manual) return `Unknown ESD ${id}`;
    if (il.tripped) return `${id} already active`;
    this.trip(il, now, `manual pushbutton by ${user}`);
    return null;
  }

  reset(id, user) {
    const il = this.items.get(id);
    if (!il) return `Unknown interlock ${id}`;
    if (!il.tripped) return `${id} is not tripped`;
    if (il.condition && !il.bypassed) return `${id} cannot be reset – trip condition still present (${il.sensorTag} ${il.value?.toFixed(2)} ${il.units})`;
    il.tripped = false;
    il.firstOut = false;
    this.release(il);
    this.log({ category: 'SIS', tag: id, user, message: `${id} reset by ${user}` });
    return null;
  }

  bypass(id, user, on) {
    const il = this.items.get(id);
    if (!il) return `Unknown interlock ${id}`;
    if (il.manual) return 'Manual ESD cannot be bypassed';
    il.bypassed = !!on;
    this.log({ category: 'SIS', priority: on ? 'HIGH' : undefined, tag: id, user, message: `${id} ${on ? 'BYPASSED' : 'bypass removed'} by ${user}` });
    return null;
  }

  status() {
    return [...this.items.values()].map((il) => ({
      id: il.id,
      value: il.value,
      condition: il.condition,
      tripped: il.tripped,
      bypassed: il.bypassed,
      firstOut: il.firstOut,
      trippedAt: il.trippedAt,
      tripCount: il.tripCount,
    }));
  }

  snapshot() {
    return [...this.items.values()].map(({ id, tripped, bypassed, trippedAt, tripCount, firstOut }) => ({ id, tripped, bypassed, trippedAt, tripCount, firstOut }));
  }

  restore(snap) {
    for (const il of this.items.values()) {
      il.tripped = false;
      il.bypassed = false;
    }
    for (const s of snap) {
      const il = this.items.get(s.id);
      if (il) Object.assign(il, s);
    }
  }
}
